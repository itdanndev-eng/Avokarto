import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
	GetObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { BackendConfigurationError } from "@/lib/backend/db";

/*
 * Where admin-uploaded images (and promo reel videos) live. Selected by UPLOAD_STORAGE:
 *
 *   local (default)  public/uploads on this server's disk. Fine for one
 *                    server with a persistent, backed-up volume.
 *   s3               Any S3-compatible bucket - AWS S3, Supabase Storage,
 *                    Cloudflare R2, MinIO. Survives redeploys and is shared
 *                    by every instance.
 *
 * Either way images keep their /api/uploads/<file> URL (served by
 * app/api/uploads/[filename]/route.ts), so switching drivers never rewrites
 * product data. The s3 driver also falls back to local disk on a miss, so
 * the site keeps working while `npm run uploads:migrate` copies files over.
 */

export type StoredUpload = {
	body: ReadableStream<Uint8Array> | Uint8Array;
	contentLength?: number;
	/** Set when a byte range was requested: what was returned, and the whole file's size. */
	range?: { end: number; start: number; total: number };
};

/** A byte range request - `end` is inclusive; omitted means "to the end of the file". */
export type ByteRange = { end?: number; start: number };

/** The requested range clipped to the file, or null when it can't be satisfied. */
function clampRange(range: ByteRange, total: number) {
	if (range.start >= total || (range.end !== undefined && range.end < range.start)) return null;
	return { end: Math.min(range.end ?? total - 1, total - 1), start: range.start, total };
}

/** Thrown for a range past the end of the file (the route answers 416). */
export class RangeNotSatisfiableError extends Error {
	constructor(readonly total: number) {
		super("Requested range not satisfiable.");
	}
}

const localDir = path.join(process.cwd(), "public", "uploads");

function env(name: string) {
	return process.env[name]?.trim() ?? "";
}

export function uploadStorageDriver() {
	// Case-insensitive: "S3" in a hosting dashboard means the same as "s3".
	return env("UPLOAD_STORAGE").toLowerCase() === "s3" ? "s3" : "local";
}

let client: S3Client | null = null;

function s3() {
	const bucket = env("UPLOAD_S3_BUCKET");
	const accessKeyId = env("UPLOAD_S3_ACCESS_KEY_ID");
	const secretAccessKey = env("UPLOAD_S3_SECRET_ACCESS_KEY");

	if (!bucket || !accessKeyId || !secretAccessKey) {
		throw new BackendConfigurationError(
			"UPLOAD_STORAGE=s3 needs UPLOAD_S3_BUCKET, UPLOAD_S3_ACCESS_KEY_ID and UPLOAD_S3_SECRET_ACCESS_KEY.",
		);
	}

	client ??= new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint: env("UPLOAD_S3_ENDPOINT") || undefined,
		// Supabase Storage and MinIO address buckets by path, not subdomain.
		forcePathStyle: env("UPLOAD_S3_FORCE_PATH_STYLE") === "true",
		region: env("UPLOAD_S3_REGION") || "us-east-1",
	});

	return { bucket, client, prefix: env("UPLOAD_S3_PREFIX") || "uploads/" };
}

async function readLocal(filename: string, range?: ByteRange): Promise<StoredUpload | null> {
	const file = path.join(localDir, filename);
	try {
		if (range) {
			// Videos: stream just the requested bytes instead of reading the file.
			const { size } = await stat(file);
			const clamped = clampRange(range, size);
			if (!clamped) throw new RangeNotSatisfiableError(size);
			const stream = createReadStream(file, { end: clamped.end, start: clamped.start });
			return {
				body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
				contentLength: clamped.end - clamped.start + 1,
				range: clamped,
			};
		}
		const bytes = await readFile(file);
		return { body: new Uint8Array(bytes), contentLength: bytes.byteLength };
	} catch (error) {
		if ((error as { code?: string })?.code === "ENOENT") return null;
		throw error;
	}
}

/** Store a validated upload under a server-generated file name. */
export async function saveUpload(filename: string, bytes: Uint8Array, contentType: string) {
	if (uploadStorageDriver() === "s3") {
		const { bucket, client, prefix } = s3();
		await client.send(
			new PutObjectCommand({
				Body: bytes,
				Bucket: bucket,
				// File names are random and never reused, so caches may keep them forever.
				CacheControl: "public, max-age=31536000, immutable",
				ContentType: contentType,
				Key: `${prefix}${filename}`,
			}),
		);
		return;
	}

	await mkdir(localDir, { recursive: true });
	await writeFile(path.join(localDir, filename), bytes);
}

/**
 * Read an upload (or just a byte range of it - how browsers stream and seek
 * videos), or null when it doesn't exist. Throws RangeNotSatisfiableError
 * for a range past the end of the file.
 */
export async function readUpload(filename: string, range?: ByteRange): Promise<StoredUpload | null> {
	if (uploadStorageDriver() === "s3") {
		const { bucket, client, prefix } = s3();
		try {
			const object = await client.send(
				new GetObjectCommand({
					Bucket: bucket,
					Key: `${prefix}${filename}`,
					Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
				}),
			);
			if (object.Body) {
				// "bytes 0-1023/52428800"
				const match = range ? /bytes (\d+)-(\d+)\/(\d+)/.exec(object.ContentRange ?? "") : null;
				return {
					body: object.Body.transformToWebStream(),
					contentLength: object.ContentLength,
					range: match ? { end: Number(match[2]), start: Number(match[1]), total: Number(match[3]) } : undefined,
				};
			}
		} catch (error) {
			const name = (error as { name?: string })?.name;
			if (name === "InvalidRange") {
				const head = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${filename}`, Range: "bytes=0-0" }));
				throw new RangeNotSatisfiableError(Number(/\/(\d+)$/.exec(head.ContentRange ?? "")?.[1] ?? 0));
			}
			if (!(error instanceof NoSuchKey) && name !== "NotFound") {
				throw error;
			}
		}
		// Not migrated yet - serve the copy still on this server's disk.
		return readLocal(filename, range);
	}

	return readLocal(filename, range);
}
