// Copies admin uploads from public/uploads into the configured S3-compatible
// bucket (UPLOAD_STORAGE=s3). Idempotent: files already in the bucket are
// skipped, so it can be re-run safely. Image URLs don't change, so no
// database rows need updating.
//
//   npm run uploads:migrate            copy missing files
//   npm run uploads:migrate -- --dry   only report what would be copied
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nextEnv from "@next/env";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

nextEnv.loadEnvConfig(process.cwd(), false, { error: () => {}, info: () => {} });

const env = (name) => process.env[name]?.trim() ?? "";
const dryRun = process.argv.includes("--dry");
const CONTENT_TYPES = { jpg: "image/jpeg", mp4: "video/mp4", png: "image/png", webm: "video/webm", webp: "image/webp" };
// Images, plus the product reels and seller videos saved alongside them.
const FILENAME = /^[a-f0-9-]+\.(jpg|mp4|png|webm|webp)$/i;

if (env("UPLOAD_STORAGE") !== "s3") {
	console.error("Set UPLOAD_STORAGE=s3 and the UPLOAD_S3_* variables first (see .env.example).");
	process.exit(1);
}
for (const name of ["UPLOAD_S3_BUCKET", "UPLOAD_S3_ACCESS_KEY_ID", "UPLOAD_S3_SECRET_ACCESS_KEY"]) {
	if (!env(name)) {
		console.error(`${name} is required.`);
		process.exit(1);
	}
}

const bucket = env("UPLOAD_S3_BUCKET");
const prefix = env("UPLOAD_S3_PREFIX") || "uploads/";
const client = new S3Client({
	credentials: {
		accessKeyId: env("UPLOAD_S3_ACCESS_KEY_ID"),
		secretAccessKey: env("UPLOAD_S3_SECRET_ACCESS_KEY"),
	},
	endpoint: env("UPLOAD_S3_ENDPOINT") || undefined,
	forcePathStyle: env("UPLOAD_S3_FORCE_PATH_STYLE") === "true",
	region: env("UPLOAD_S3_REGION") || "us-east-1",
});

const dir = path.join(process.cwd(), "public", "uploads");
const files = (await readdir(dir).catch(() => [])).filter((name) => FILENAME.test(name));
let copied = 0;
let skipped = 0;

for (const name of files) {
	const Key = `${prefix}${name}`;
	try {
		await client.send(new HeadObjectCommand({ Bucket: bucket, Key }));
		skipped += 1;
		continue;
	} catch (error) {
		if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
	}

	if (!dryRun) {
		await client.send(
			new PutObjectCommand({
				Body: await readFile(path.join(dir, name)),
				Bucket: bucket,
				CacheControl: "public, max-age=31536000, immutable",
				ContentType: CONTENT_TYPES[name.split(".").pop().toLowerCase()],
				Key,
			}),
		);
	}
	copied += 1;
	process.stdout.write(`${dryRun ? "would copy" : "copied"} ${name}\n`);
}

console.log(`${dryRun ? "Dry run: " : ""}${copied} ${dryRun ? "to copy" : "copied"}, ${skipped} already in the bucket, ${files.length} local files.`);
