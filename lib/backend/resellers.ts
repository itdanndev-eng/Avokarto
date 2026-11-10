import type { PoolClient } from "pg";
import { z } from "zod";
import { cache } from "react";
import { dbQuery, withTransaction } from "@/lib/backend/db";
import { assertListingAllowed, syncStoreBilling } from "@/lib/backend/billing";
import { HttpError } from "@/lib/backend/http";
import { UPLOAD_URL_PATTERN } from "@/lib/backend/image-upload";
import { getStoreDomain, removeStoreDomain } from "@/lib/backend/store-domains";
import { customCssProblem } from "@/lib/storeCustomCss";
import { DEFAULT_STORE_FONT, STORE_FONTS, type StoreFont } from "@/lib/storeFonts";
import { DEFAULT_STORE_THEME, STORE_THEMES, type StoreTheme } from "@/lib/storeThemes";
import {
	handleProblem,
	marginProblem,
	resellerPrice,
	type MarginType,
} from "@/lib/resellerPricing";

/* ------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------- */

export type ResellerSettings = {
	/** Product count the /sell homepage advertises; null shows the live count. */
	advertisedProducts: number | null;
	holdDays: number;
	maxMarginPercent: number;
	minPayout: number;
	platformFeePercent: number;
	signupsOpen: boolean;
	/** Sellers need a Kelviq plan (lib/backend/billing.ts) for their store to be live. */
	subscriptionsRequired: boolean;
};

export type PayoutDetails =
	| { method: "upi"; upiId: string; accountName: string }
	| { method: "bank"; accountName: string; accountNumber: string; ifsc: string; bankName: string }
	| Record<string, never>;

export { STORE_THEMES, type StoreTheme };
export type StoreSocials = Partial<Record<"facebook" | "instagram" | "website" | "youtube", string>>;

export type ResellerStore = {
	about: string;
	accentColor: string;
	announcement: string;
	bannerUrl: string;
	contactEmail: string;
	/** Seller's "Additional CSS" (validated; never applied on checkout). */
	customCss: string;
	font: StoreFont;
	logoUrl: string;
	socials: StoreSocials;
	theme: StoreTheme;
	createdAt: string;
	defaultMarginPercent: number;
	handle: string;
	id: string;
	name: string;
	payoutDetails: PayoutDetails;
	payoutsBlocked: boolean;
	status: "active" | "suspended" | "unpaid";
	suspendedReason: string;
	tagline: string;
	whatsapp: string;
};

export type ResellerListing = {
	baseOldPrice: number | null;
	/** How the cart identifies the product (legacy numeric id when present). */
	cartId: number | string;
	basePrice: number;
	category: string;
	createdAt: string;
	featured: boolean;
	id: string;
	imageUrl: string;
	isActive: boolean;
	margin: number;
	marginType: MarginType;
	marginValue: number;
	net: number;
	productId: string;
	productName: string;
	productSlug: string;
	/** False when the product itself is no longer for sale. */
	purchasable: boolean;
	salePrice: number;
	stock: number;
};

export type ResellerBalances = {
	available: number;
	lifetime: number;
	paid: number;
	pending: number;
	requested: number;
	withdrawable: number;
};

/**
 * Validate input, reporting the first problem in plain words along with the
 * field it belongs to, so the seller/admin UI can point at it.
 */
function parseInput<T>(schema: z.ZodType<T>, body: unknown): T {
	const result = schema.safeParse(body);
	if (result.success) return result.data;
	const issue = result.error.issues[0];
	const field = issue?.path.map(String).join(".") || undefined;
	const message = issue?.code === "custom" || /[A-Z].*\.$/.test(issue?.message ?? "")
		? issue.message
		: `Check ${field ?? "your input"}: ${issue?.message ?? "invalid value"}.`;
	throw new HttpError(400, message, "INVALID_FIELD", { field });
}

/* ------------------------------------------------------------------------
 * Settings
 * --------------------------------------------------------------------- */

type SettingsRow = {
	advertised_products: number | null;
	hold_days: number;
	max_margin_percent: string;
	min_payout: string;
	platform_fee_percent: string;
	signups_open: boolean;
	subscriptions_required: boolean;
};

function toSettings(row: SettingsRow): ResellerSettings {
	return {
		advertisedProducts: row.advertised_products,
		holdDays: row.hold_days,
		maxMarginPercent: Number(row.max_margin_percent),
		minPayout: Number(row.min_payout),
		platformFeePercent: Number(row.platform_fee_percent),
		signupsOpen: row.signups_open,
		subscriptionsRequired: row.subscriptions_required,
	};
}

// Rules change rarely but are read on almost every seller request, so
// reads outside a transaction share a short-lived per-process copy. An
// admin save clears it here; other instances pick it up within the TTL.
const SETTINGS_TTL_MS = 15_000;
let cachedSettings: { expires: number; value: Promise<ResellerSettings> } | null = null;

async function readSettings(query: Pick<PoolClient, "query"> | null) {
	const sql = `SELECT advertised_products, hold_days, max_margin_percent, min_payout, platform_fee_percent, signups_open, subscriptions_required FROM reseller_settings WHERE id`;
	const result = query ? await query.query<SettingsRow>(sql) : await dbQuery<SettingsRow>(sql);
	const row = result.rows[0];
	if (!row) {
		throw new HttpError(503, "Reseller program isn't set up yet.", "RESELLERS_NOT_CONFIGURED");
	}
	return toSettings(row);
}

/** Marketplace rules. Pass the transaction client to read them uncached (checkout, payouts). */
export async function getResellerSettings(
	query: Pick<PoolClient, "query"> | null = null,
): Promise<ResellerSettings> {
	if (query) return readSettings(query);
	if (!cachedSettings || cachedSettings.expires < Date.now()) {
		const value = readSettings(null);
		cachedSettings = { expires: Date.now() + SETTINGS_TTL_MS, value };
		// A failed read must not be cached.
		value.catch(() => {
			if (cachedSettings?.value === value) cachedSettings = null;
		});
	}
	return cachedSettings.value;
}

const settingsSchema = z.object({
	// Blank or missing clears it, so the homepage falls back to the live count.
	advertisedProducts: z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().int().min(1).max(10_000_000).nullable()),
	holdDays: z.coerce.number().int().min(0).max(90),
	maxMarginPercent: z.coerce.number().min(0).max(500),
	minPayout: z.coerce.number().min(0).max(1_000_000),
	platformFeePercent: z.coerce.number().min(0).max(100),
	signupsOpen: z.boolean(),
	// Optional so an older admin form can't switch billing off by omission.
	subscriptionsRequired: z.boolean().optional(),
});

export async function updateResellerSettings(body: unknown) {
	const input = parseInput(settingsSchema, body);
	await dbQuery(
		`
			UPDATE reseller_settings
			SET hold_days = $1, max_margin_percent = $2, min_payout = $3,
				platform_fee_percent = $4, signups_open = $5, advertised_products = $6,
				subscriptions_required = COALESCE($7, subscriptions_required), updated_at = now()
			WHERE id
		`,
		[input.holdDays, input.maxMarginPercent, input.minPayout, input.platformFeePercent, input.signupsOpen, input.advertisedProducts, input.subscriptionsRequired ?? null],
	);
	cachedSettings = null;
	const settings = await getResellerSettings();
	// Turning billing on or off opens or closes every store to match.
	await syncStoreBilling(null, settings.subscriptionsRequired);
	return settings;
}

/* ------------------------------------------------------------------------
 * Stores
 * --------------------------------------------------------------------- */

type StoreRow = {
	about: string;
	accent_color: string;
	announcement: string;
	banner_url: string;
	contact_email: string;
	custom_css: string;
	font: StoreFont;
	logo_url: string;
	socials: StoreSocials | null;
	theme: StoreTheme;
	created_at: Date;
	default_margin_percent: string;
	handle: string;
	id: string;
	name: string;
	payout_details: PayoutDetails;
	payouts_blocked: boolean;
	status: "active" | "suspended" | "unpaid";
	suspended_reason: string;
	tagline: string;
	whatsapp: string;
};

const STORE_COLUMNS = `s.id::text, s.handle, s.name, s.tagline, s.accent_color, s.whatsapp,
	s.default_margin_percent, s.status, s.suspended_reason, s.payouts_blocked,
	s.payout_details, s.created_at, s.logo_url, s.banner_url, s.theme, s.about,
	s.announcement, s.contact_email, s.socials, s.font, s.custom_css`;

function toStore(row: StoreRow): ResellerStore {
	return {
		about: row.about ?? "",
		accentColor: row.accent_color,
		announcement: row.announcement ?? "",
		bannerUrl: row.banner_url ?? "",
		contactEmail: row.contact_email ?? "",
		customCss: row.custom_css ?? "",
		font: STORE_FONTS.includes(row.font) ? row.font : DEFAULT_STORE_FONT,
		logoUrl: row.logo_url ?? "",
		socials: row.socials ?? {},
		theme: STORE_THEMES.includes(row.theme) ? row.theme : DEFAULT_STORE_THEME,
		createdAt: row.created_at.toISOString(),
		defaultMarginPercent: Number(row.default_margin_percent),
		handle: row.handle,
		id: row.id,
		name: row.name,
		payoutDetails: row.payout_details ?? {},
		payoutsBlocked: row.payouts_blocked,
		status: row.status,
		suspendedReason: row.suspended_reason,
		tagline: row.tagline,
		whatsapp: row.whatsapp,
	};
}

/** The public view of a store: no payout details or moderation notes. */
export function publicStore(store: ResellerStore) {
	return {
		about: store.about,
		accentColor: store.accentColor,
		announcement: store.announcement,
		bannerUrl: store.bannerUrl,
		contactEmail: store.contactEmail,
		customCss: store.customCss,
		font: store.font,
		handle: store.handle,
		logoUrl: store.logoUrl,
		name: store.name,
		since: store.createdAt,
		socials: store.socials,
		tagline: store.tagline,
		theme: store.theme,
		whatsapp: store.whatsapp,
	};
}

export type PublicStore = ReturnType<typeof publicStore>;

const uploadUrl = z
	.string()
	.trim()
	.refine((value) => value === "" || UPLOAD_URL_PATTERN.test(value), "Upload the image again.");

// Only well-known profile hosts, so a store can't link shoppers anywhere.
const SOCIAL_HOSTS: Record<keyof StoreSocials, RegExp | null> = {
	facebook: /(^|\.)facebook\.com$|(^|\.)fb\.com$/i,
	instagram: /(^|\.)instagram\.com$/i,
	website: null,
	youtube: /(^|\.)youtube\.com$|^youtu\.be$/i,
};

function socialUrl(key: keyof StoreSocials) {
	return z
		.string()
		.trim()
		.max(200)
		.refine((value) => {
			if (!value) return true;
			try {
				const url = new URL(value);
				const host = SOCIAL_HOSTS[key];
				return url.protocol === "https:" && (!host || host.test(url.hostname));
			} catch {
				return false;
			}
		}, key === "website" ? "Use a full https:// link." : `Use your ${key} profile link (https://${key}.com/…).`);
}

const brandingSchema = z.object({
	accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a valid colour.").optional(),
	about: z.string().trim().max(1000, "Keep About under 1000 characters.").optional(),
	announcement: z.string().trim().max(140, "Keep the announcement under 140 characters.").optional(),
	bannerUrl: uploadUrl.optional(),
	contactEmail: z.union([z.literal(""), z.email("Enter a valid email address.")]).optional(),
	customCss: z
		.string()
		.superRefine((value, context) => {
			const problem = customCssProblem(value);
			if (problem) context.addIssue({ code: "custom", message: `Custom CSS: ${problem}` });
		})
		.optional(),
	font: z.enum(STORE_FONTS).optional(),
	logoUrl: uploadUrl.optional(),
	socials: z
		.object({
			facebook: socialUrl("facebook").optional(),
			instagram: socialUrl("instagram").optional(),
			website: socialUrl("website").optional(),
			youtube: socialUrl("youtube").optional(),
		})
		.optional(),
	theme: z.enum(STORE_THEMES).optional(),
});

/** Logo, banner, theme, colour and storefront content - everything that makes the store look like its own site. */
export async function updateStoreBranding(customerId: string, body: unknown) {
	const store = await requireStoreForCustomer(customerId);
	const input = parseInput(brandingSchema, body);
	const socials = input.socials
		? Object.fromEntries(Object.entries(input.socials).filter(([, value]) => value))
		: store.socials;
	const result = await dbQuery<StoreRow>(
		`
			UPDATE reseller_stores s
			SET logo_url = $2, banner_url = $3, theme = $4, about = $5, announcement = $6,
				contact_email = $7, socials = $8, accent_color = $9, font = $10, custom_css = $11
			WHERE s.id = $1
			RETURNING ${STORE_COLUMNS}
		`,
		[
			store.id,
			input.logoUrl ?? store.logoUrl,
			input.bannerUrl ?? store.bannerUrl,
			input.theme ?? store.theme,
			input.about ?? store.about,
			input.announcement ?? store.announcement,
			input.contactEmail ?? store.contactEmail,
			JSON.stringify(socials),
			input.accentColor ?? store.accentColor,
			input.font ?? store.font,
			input.customCss ?? store.customCss,
		],
	);
	return toStore(result.rows[0]);
}

const storeInputSchema = z.object({
	accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a valid colour.").optional(),
	defaultMarginPercent: z.coerce.number().min(0).max(500).optional(),
	handle: z.string().trim().toLowerCase(),
	name: z.string().trim().min(2, "Store name needs at least 2 characters.").max(60),
	tagline: z.string().trim().max(140).optional(),
	whatsapp: z
		.string()
		.trim()
		.regex(/^\+?[0-9 ]{0,20}$/, "Use digits only, with an optional leading +.")
		.optional(),
});

function storeConflict(error: unknown) {
	const pgError = error as { code?: string; constraint?: string };
	if (pgError?.code === "23505" && pgError.constraint === "reseller_stores_handle_key") {
		return new HttpError(409, "That store link is taken. Try another.", "HANDLE_TAKEN", { field: "handle" });
	}
	if (pgError?.code === "23505" && pgError.constraint === "reseller_stores_customer_id_key") {
		return new HttpError(409, "You already have a store.", "STORE_EXISTS");
	}
	return error;
}

function validateStoreInput(body: unknown, settings: ResellerSettings) {
	const input = parseInput(storeInputSchema, body);
	const problem = handleProblem(input.handle);
	if (problem) throw new HttpError(400, problem, "INVALID_HANDLE", { field: "handle" });
	if (input.defaultMarginPercent !== undefined && input.defaultMarginPercent > settings.maxMarginPercent) {
		throw new HttpError(
			400,
			`Default margin can be at most ${settings.maxMarginPercent}%.`,
			"INVALID_MARGIN",
			{ field: "defaultMarginPercent" },
		);
	}
	return input;
}

export async function getStoreForCustomer(customerId: string) {
	const result = await dbQuery<StoreRow>(
		`SELECT ${STORE_COLUMNS} FROM reseller_stores s WHERE s.customer_id = $1`,
		[customerId],
	);
	return result.rows[0] ? toStore(result.rows[0]) : null;
}

export async function requireStoreForCustomer(customerId: string) {
	const store = await getStoreForCustomer(customerId);
	if (!store) throw new HttpError(404, "Open your store first.", "NO_STORE");
	return store;
}

export async function isHandleAvailable(handle: string, exceptStoreId?: string) {
	const normalized = handle.trim().toLowerCase();
	const problem = handleProblem(normalized);
	if (problem) return { available: false, reason: problem };
	const taken = await dbQuery(
		`SELECT 1 FROM reseller_stores WHERE handle = $1 AND id::text <> $2`,
		[normalized, exceptStoreId ?? ""],
	);
	return taken.rowCount
		? { available: false, reason: "That store link is taken." }
		: { available: true, reason: null };
}

/**
 * Of these candidate links, the ones that can't be used: invalid or reserved,
 * or already another store's. One query for a whole list of name ideas.
 */
export async function unavailableHandles(handles: string[], exceptStoreId?: string) {
	const unique = [...new Set(handles.map((handle) => handle.trim().toLowerCase()).filter(Boolean))];
	const blocked = new Set(unique.filter((handle) => handleProblem(handle)));
	const valid = unique.filter((handle) => !blocked.has(handle));
	if (valid.length) {
		const taken = await dbQuery<{ handle: string }>(
			`SELECT handle FROM reseller_stores WHERE handle = ANY($1::text[]) AND id::text <> $2`,
			[valid, exceptStoreId ?? ""],
		);
		for (const row of taken.rows) blocked.add(row.handle);
	}
	return [...blocked];
}

export async function createStore(customerId: string, body: unknown) {
	const settings = await getResellerSettings();
	if (!settings.signupsOpen) {
		throw new HttpError(403, "New stores are paused right now. Please check back soon.", "SIGNUPS_CLOSED");
	}
	const input = validateStoreInput(body, settings);

	try {
		const result = await dbQuery<StoreRow>(
			`
				INSERT INTO reseller_stores (customer_id, handle, name, tagline, accent_color, whatsapp, default_margin_percent)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING ${STORE_COLUMNS.replaceAll("s.", "")}
			`,
			[
				customerId,
				input.handle,
				input.name,
				input.tagline ?? "",
				input.accentColor ?? "#3E8315",
				input.whatsapp ?? "",
				Math.min(input.defaultMarginPercent ?? 15, settings.maxMarginPercent),
			],
		);
		// Without a plan (when one is required) the new store waits, unpaid, until the trial starts.
		await syncStoreBilling(customerId, settings.subscriptionsRequired);
		return (await getStoreForCustomer(customerId)) ?? toStore(result.rows[0]);
	} catch (error) {
		throw storeConflict(error);
	}
}

export async function updateStore(customerId: string, body: unknown) {
	const store = await requireStoreForCustomer(customerId);
	const input = validateStoreInput(body, await getResellerSettings());

	try {
		const result = await dbQuery<StoreRow>(
			`
				UPDATE reseller_stores
				SET handle = $2, name = $3, tagline = $4, accent_color = $5, whatsapp = $6,
					default_margin_percent = $7
				WHERE id = $1
				RETURNING ${STORE_COLUMNS.replaceAll("s.", "")}
			`,
			[
				store.id,
				input.handle,
				input.name,
				input.tagline ?? store.tagline,
				input.accentColor ?? store.accentColor,
				input.whatsapp ?? store.whatsapp,
				input.defaultMarginPercent ?? store.defaultMarginPercent,
			],
		);
		return toStore(result.rows[0]);
	} catch (error) {
		throw storeConflict(error);
	}
}

const payoutDetailsSchema = z.discriminatedUnion("method", [
	z.object({
		accountName: z.string().trim().min(2, "Enter the account holder's name.").max(80),
		method: z.literal("upi"),
		upiId: z.string().trim().regex(/^[\w.-]{2,64}@[A-Za-z]{2,32}$/, "Enter a valid UPI ID, like name@bank."),
	}),
	z.object({
		accountName: z.string().trim().min(2, "Enter the account holder's name.").max(80),
		accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Account numbers are 6-20 digits."),
		bankName: z.string().trim().min(2, "Enter the bank's name.").max(80),
		ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC code."),
		method: z.literal("bank"),
	}),
]);

export async function updatePayoutDetails(customerId: string, body: unknown) {
	const store = await requireStoreForCustomer(customerId);
	const details = parseInput(payoutDetailsSchema, body);
	await dbQuery(`UPDATE reseller_stores SET payout_details = $2 WHERE id = $1`, [
		store.id,
		JSON.stringify(details),
	]);
	return details;
}

/** Account numbers are shown masked everywhere except the admin payout queue. */
export function maskPayoutDetails(details: PayoutDetails): PayoutDetails {
	if ("method" in details && details.method === "bank") {
		return { ...details, accountNumber: `••••${details.accountNumber.slice(-4)}` };
	}
	return details;
}

/* ------------------------------------------------------------------------
 * Listings
 * --------------------------------------------------------------------- */

type ListingRow = {
	category_name: string | null;
	legacy_id: number | null;
	created_at: Date;
	featured: boolean;
	id: string;
	image_url: string;
	is_active: boolean;
	margin_type: MarginType;
	margin_value: string;
	old_price: string | null;
	price: string;
	product_id: string;
	product_name: string;
	product_status: string;
	slug: string;
	stock: number;
};

const LISTING_SELECT = `
	SELECT l.id::text, l.product_id::text, l.margin_type, l.margin_value, l.is_active,
		l.featured, l.created_at, p.name AS product_name, p.slug, p.image_url, p.price,
		p.old_price, p.stock, p.status AS product_status, c.name AS category_name, p.legacy_id
	FROM reseller_listings l
	JOIN products p ON p.id = l.product_id
	LEFT JOIN categories c ON c.id = p.category_id
`;

function toListing(row: ListingRow, settings: ResellerSettings): ResellerListing {
	const basePrice = Number(row.price);
	const price = resellerPrice(basePrice, row.margin_type, Number(row.margin_value), settings);
	return {
		baseOldPrice: row.old_price === null ? null : Number(row.old_price),
		basePrice,
		cartId: row.legacy_id ?? row.product_id,
		category: row.category_name ?? "",
		createdAt: row.created_at.toISOString(),
		featured: row.featured,
		id: row.id,
		imageUrl: row.image_url,
		isActive: row.is_active,
		margin: price.margin,
		marginType: row.margin_type,
		marginValue: Number(row.margin_value),
		net: price.net,
		productId: row.product_id,
		productName: row.product_name,
		productSlug: row.slug,
		purchasable: ["published", "low stock"].includes(row.product_status) && row.stock > 0,
		salePrice: price.salePrice,
		stock: row.stock,
	};
}

export async function listStoreListings(storeId: string, { onlyVisible = false } = {}) {
	const settings = await getResellerSettings();
	const result = await dbQuery<ListingRow>(
		`${LISTING_SELECT}
		WHERE l.store_id = $1 ${onlyVisible ? "AND l.is_active AND p.status IN ('published', 'low stock')" : ""}
		ORDER BY l.featured DESC, l.created_at DESC`,
		[storeId],
	);
	return result.rows.map((row) => toListing(row, settings));
}

const listingInputSchema = z.object({
	featured: z.boolean().optional(),
	isActive: z.boolean().optional(),
	marginType: z.enum(["percent", "fixed"]),
	marginValue: z.coerce.number().min(0).max(1_000_000),
});

async function resellableProduct(productId: string) {
	const result = await dbQuery<{ id: string; price: string; status: string }>(
		`SELECT id::text, price, status FROM products WHERE id::text = $1`,
		[productId],
	);
	const product = result.rows[0];
	if (!product || !["published", "low stock"].includes(product.status)) {
		throw new HttpError(404, "That product isn't available to resell.", "PRODUCT_UNAVAILABLE");
	}
	return { id: product.id, price: Number(product.price) };
}

function assertMargin(basePrice: number, marginType: MarginType, marginValue: number, settings: ResellerSettings) {
	const problem = marginProblem(basePrice, marginType, marginValue, settings.maxMarginPercent);
	if (problem) throw new HttpError(400, problem, "INVALID_MARGIN", { field: "marginValue" });
}

const MAX_LISTINGS_PER_STORE = 500;

/** Add a product to the store, or update its margin if it's already there. */
export async function saveListing(customerId: string, productId: string, body: unknown) {
	const store = await requireStoreForCustomer(customerId);
	const settings = await getResellerSettings();
	const input = parseInput(listingInputSchema, body);
	const product = await resellableProduct(productId);
	assertMargin(product.price, input.marginType, input.marginValue, settings);

	const count = await dbQuery<{ total: number }>(
		`SELECT count(*)::int AS total FROM reseller_listings WHERE store_id = $1 AND product_id::text <> $2`,
		[store.id, product.id],
	);
	if (count.rows[0].total >= MAX_LISTINGS_PER_STORE) {
		throw new HttpError(400, `A store can resell up to ${MAX_LISTINGS_PER_STORE} products.`, "LISTING_LIMIT");
	}
	await assertListingAllowed(customerId, settings.subscriptionsRequired, count.rows[0].total);

	await dbQuery(
		`
			INSERT INTO reseller_listings (store_id, product_id, margin_type, margin_value, is_active, featured)
			VALUES ($1, $2, $3, $4, COALESCE($5, true), COALESCE($6, false))
			ON CONFLICT (store_id, product_id) DO UPDATE SET
				margin_type = EXCLUDED.margin_type,
				margin_value = EXCLUDED.margin_value,
				is_active = COALESCE($5, reseller_listings.is_active),
				featured = COALESCE($6, reseller_listings.featured)
		`,
		[store.id, product.id, input.marginType, input.marginValue, input.isActive ?? null, input.featured ?? null],
	);

	const listing = await dbQuery<ListingRow>(`${LISTING_SELECT} WHERE l.store_id = $1 AND l.product_id = $2`, [
		store.id,
		product.id,
	]);
	return toListing(listing.rows[0], settings);
}

const listingPatchSchema = z.object({
	featured: z.boolean().optional(),
	isActive: z.boolean().optional(),
	marginType: z.enum(["percent", "fixed"]).optional(),
	marginValue: z.coerce.number().min(0).max(1_000_000).optional(),
});

export async function updateListing(customerId: string, listingId: string, body: unknown) {
	const store = await requireStoreForCustomer(customerId);
	const settings = await getResellerSettings();
	const input = parseInput(listingPatchSchema, body);
	const current = await dbQuery<ListingRow>(`${LISTING_SELECT} WHERE l.id::text = $1 AND l.store_id = $2`, [
		listingId,
		store.id,
	]);
	const row = current.rows[0];
	if (!row) throw new HttpError(404, "That product isn't in your store.", "LISTING_NOT_FOUND");

	const marginType = input.marginType ?? row.margin_type;
	const marginValue = input.marginValue ?? Number(row.margin_value);
	assertMargin(Number(row.price), marginType, marginValue, settings);

	await dbQuery(
		`
			UPDATE reseller_listings
			SET margin_type = $2, margin_value = $3, is_active = COALESCE($4, is_active), featured = COALESCE($5, featured)
			WHERE id = $1
		`,
		[row.id, marginType, marginValue, input.isActive ?? null, input.featured ?? null],
	);
	const updated = await dbQuery<ListingRow>(`${LISTING_SELECT} WHERE l.id = $1`, [row.id]);
	return toListing(updated.rows[0], settings);
}

export async function deleteListing(customerId: string, listingId: string) {
	const store = await requireStoreForCustomer(customerId);
	const result = await dbQuery(`DELETE FROM reseller_listings WHERE id::text = $1 AND store_id = $2`, [
		listingId,
		store.id,
	]);
	if (!result.rowCount) throw new HttpError(404, "That product isn't in your store.", "LISTING_NOT_FOUND");
}

/**
 * The catalog a reseller picks from: sellable products, with whether each
 * is already in their store and what it would earn at their default margin.
 */
/** How the "Add products" catalog can be ordered. */
export const CATALOG_SORTS = ["winning", "profit", "newest", "rating", "price-low"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

const CATALOG_ORDER: Record<CatalogSort, string> = {
	// Demand first: units sold across Avokarto in the last 30 days.
	winning: "COALESCE(s.units_30, 0) DESC, p.review_count DESC, p.created_at DESC, p.id",
	// Margins are a percentage of price, so the priciest products earn the most per sale.
	profit: "p.price DESC, p.id",
	newest: "p.created_at DESC, p.id",
	rating: "p.rating DESC, p.review_count DESC, p.id",
	"price-low": "p.price ASC, p.id",
};

export async function browseResellerCatalog(
	customerId: string,
	{
		category,
		hideAdded = false,
		limit = 24,
		offset = 0,
		search,
		sort = "winning",
	}: { category?: string; hideAdded?: boolean; limit?: number; offset?: number; search?: string; sort?: CatalogSort },
) {
	const [store, settings] = await Promise.all([requireStoreForCustomer(customerId), getResellerSettings()]);
	const params: unknown[] = [store.id];
	const where = ["p.status IN ('published', 'low stock')", "p.stock > 0"];
	if (search?.trim()) {
		params.push(`%${search.trim().replace(/[\\%_]/g, "\\$&")}%`);
		where.push(`(p.name ILIKE $${params.length} OR c.name ILIKE $${params.length} OR b.name ILIKE $${params.length})`);
	}
	if (category?.trim()) {
		params.push(category.trim());
		where.push(`c.id::text = $${params.length}`);
	}
	if (hideAdded) where.push("l.id IS NULL");
	const safeLimit = Math.min(Math.max(1, Math.trunc(limit) || 24), 48);
	params.push(safeLimit + 1, Math.max(0, Math.trunc(offset) || 0));

	const result = await dbQuery<{
		category_name: string | null;
		created_at: Date;
		id: string;
		image_url: string;
		listing_id: string | null;
		listing_margin_type: MarginType | null;
		listing_margin_value: string | null;
		name: string;
		old_price: string | null;
		other_stores: number;
		price: string;
		rating: string;
		review_count: number;
		slug: string;
		stock: number;
		units_30: number;
		units_prev: number;
	}>(
		`
			WITH s AS (
				-- Platform-wide demand: last 30 days, and the 30 before for the trend.
				SELECT oi.product_id,
					COALESCE(SUM(oi.qty) FILTER (WHERE o.created_at >= now() - interval '30 days'), 0)::int AS units_30,
					COALESCE(SUM(oi.qty) FILTER (WHERE o.created_at < now() - interval '30 days'), 0)::int AS units_prev
				FROM order_items oi
				JOIN orders o ON o.id = oi.order_id
				WHERE o.created_at >= now() - interval '60 days'
					AND o.status NOT IN ('cancelled', 'failed')
					AND oi.product_id IS NOT NULL
				GROUP BY oi.product_id
			), rivals AS (
				-- Competition: other live stores already selling it.
				SELECT rl.product_id, count(*)::int AS other_stores
				FROM reseller_listings rl
				JOIN reseller_stores rs ON rs.id = rl.store_id AND rs.status = 'active'
				WHERE rl.is_active AND rl.store_id <> $1
				GROUP BY rl.product_id
			)
			SELECT p.id::text, p.name, p.slug, p.image_url, p.price, p.old_price, p.stock,
				p.rating, p.review_count, p.created_at, c.name AS category_name, l.id::text AS listing_id,
				l.margin_type AS listing_margin_type, l.margin_value AS listing_margin_value,
				COALESCE(s.units_30, 0) AS units_30, COALESCE(s.units_prev, 0) AS units_prev,
				COALESCE(r.other_stores, 0) AS other_stores
			FROM products p
			LEFT JOIN categories c ON c.id = p.category_id
			LEFT JOIN brands b ON b.id = p.brand_id
			LEFT JOIN reseller_listings l ON l.product_id = p.id AND l.store_id = $1
			LEFT JOIN s ON s.product_id = p.id
			LEFT JOIN rivals r ON r.product_id = p.id
			WHERE ${where.join(" AND ")}
			ORDER BY ${CATALOG_ORDER[sort]}
			LIMIT $${params.length - 1} OFFSET $${params.length}
		`,
		params,
	);

	const newSince = Date.now() - 14 * 24 * 60 * 60 * 1000;
	const rows = result.rows.slice(0, safeLimit);
	return {
		hasMore: result.rows.length > safeLimit,
		items: rows.map((row) => {
			const basePrice = Number(row.price);
			// Already in the store: its real price. Otherwise: at the default margin.
			const atDefault = row.listing_margin_type
				? resellerPrice(basePrice, row.listing_margin_type, Number(row.listing_margin_value), settings)
				: resellerPrice(basePrice, "percent", store.defaultMarginPercent, settings);
			return {
				basePrice,
				category: row.category_name ?? "",
				id: row.id,
				imageUrl: row.image_url,
				inStore: Boolean(row.listing_id),
				isNew: new Date(row.created_at).getTime() >= newSince,
				listingId: row.listing_id,
				maxNet: resellerPrice(basePrice, "percent", settings.maxMarginPercent, settings).net,
				name: row.name,
				oldPrice: row.old_price === null ? null : Number(row.old_price),
				otherStores: row.other_stores,
				rating: Number(row.rating),
				reviewCount: row.review_count,
				slug: row.slug,
				stock: row.stock,
				suggested: atDefault,
				// Rising: sold more this month than last (and enough to mean something).
				trending: row.units_30 >= 3 && row.units_30 > row.units_prev,
				unitsSold30: row.units_30,
			};
		}),
	};
}

/* ------------------------------------------------------------------------
 * Public storefront
 * --------------------------------------------------------------------- */

async function activeStoreByHandle(handle: string) {
	const result = await dbQuery<StoreRow>(
		`SELECT ${STORE_COLUMNS} FROM reseller_stores s WHERE s.handle = $1 AND s.status = 'active'`,
		[handle.toLowerCase()],
	);
	return result.rows[0] ? toStore(result.rows[0]) : null;
}

export const getPublicStorefront = cache(async (handle: string) => {
	const store = await activeStoreByHandle(handle);
	if (!store) return null;
	const listings = (await listStoreListings(store.id, { onlyVisible: true })).map(publicListing);
	return { listings, store: publicStore(store) };
});

/** Just the store's branding, for the store website's header and footer. */
export const getPublicStoreBranding = cache(async (handle: string) => {
	const store = await activeStoreByHandle(handle);
	return store ? publicStore(store) : null;
});

/** What shoppers may see of a listing (never the reseller's margin). */
function publicListing(listing: ResellerListing) {
	return {
		cartId: listing.cartId,
		category: listing.category,
		featured: listing.featured,
		id: listing.id,
		imageUrl: listing.imageUrl,
		inStock: listing.purchasable,
		price: listing.salePrice,
		productId: listing.productId,
		productName: listing.productName,
		productSlug: listing.productSlug,
		stock: listing.stock,
	};
}

export const getPublicStoreProduct = cache(async (handle: string, productSlug: string) => {
	const store = await activeStoreByHandle(handle);
	if (!store) return null;
	const settings = await getResellerSettings();
	const result = await dbQuery<ListingRow & {
		description: string;
		gallery_image_urls: string[] | null;
		key_highlights: string[] | null;
		rating: string;
		review_count: number;
		short_summary: string;
	}>(
		`
			SELECT l.id::text, l.product_id::text, l.margin_type, l.margin_value, l.is_active,
				l.featured, l.created_at, p.name AS product_name, p.slug, p.image_url, p.price,
				p.old_price, p.stock, p.status AS product_status, c.name AS category_name,
				p.description, p.gallery_image_urls, p.key_highlights, p.short_summary,
				p.rating, p.review_count, p.legacy_id
			FROM reseller_listings l
			JOIN products p ON p.id = l.product_id
			LEFT JOIN categories c ON c.id = p.category_id
			WHERE l.store_id = $1 AND p.slug = $2 AND l.is_active
				AND p.status IN ('published', 'low stock')
		`,
		[store.id, productSlug],
	);
	const row = result.rows[0];
	if (!row) return null;
	const listing = toListing(row, settings);
	return {
		product: {
			...publicListing(listing),
			description: row.description,
			highlights: row.key_highlights ?? [],
			images: row.gallery_image_urls?.length ? row.gallery_image_urls : [row.image_url],
			rating: Number(row.rating),
			reviewCount: row.review_count,
			shortSummary: row.short_summary ?? "",
		},
		store: publicStore(store),
	};
});

/**
 * Current prices for cart lines bought through a store. A listing that's
 * gone, inactive, out of stock or in a suspended store returns null, and the
 * cart falls back to the regular Avokarto price.
 */
export async function getListingPrices(listingIds: string[]) {
	const ids = [...new Set(listingIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
	if (!ids.length) return [];
	const settings = await getResellerSettings();
	const result = await dbQuery<ListingRow & { store_handle: string; store_name: string; store_active: boolean }>(
		`
			SELECT l.id::text, l.product_id::text, l.margin_type, l.margin_value, l.is_active,
				l.featured, l.created_at, p.name AS product_name, p.slug, p.image_url, p.price,
				p.old_price, p.stock, p.status AS product_status, NULL AS category_name, p.legacy_id,
				s.handle AS store_handle, s.name AS store_name, s.status = 'active' AS store_active
			FROM reseller_listings l
			JOIN products p ON p.id = l.product_id
			JOIN reseller_stores s ON s.id = l.store_id
			WHERE l.id::text = ANY($1::text[])
		`,
		[ids],
	);
	const found = new Map(result.rows.map((row) => [row.id, row]));
	return ids.map((id) => {
		const row = found.get(id);
		if (!row || !row.is_active || !row.store_active) return { listingId: id, price: null };
		return {
			listingId: id,
			price: toListing(row, settings).salePrice,
			storeHandle: row.store_handle,
			storeName: row.store_name,
		};
	});
}

/* ------------------------------------------------------------------------
 * Checkout integration
 * --------------------------------------------------------------------- */

export type CheckoutListing = {
	listingId: string;
	productId: string;
	salePrice: number;
	storeId: string;
};

/**
 * Resolve the store listings an order's lines were bought through, inside
 * the checkout transaction. Lines whose listing is no longer valid are
 * reported so checkout can ask the shopper to review prices.
 */
export async function resolveCheckoutListings(client: PoolClient, listingIds: string[]) {
	const ids = [...new Set(listingIds)];
	const resolved = new Map<string, CheckoutListing>();
	if (!ids.length) return resolved;

	const settings = await getResellerSettings(client);
	const result = await client.query<{
		id: string;
		margin_type: MarginType;
		margin_value: string;
		price: string;
		product_id: string;
		store_id: string;
	}>(
		`
			SELECT l.id::text, l.product_id::text, l.store_id::text, l.margin_type, l.margin_value, p.price
			FROM reseller_listings l
			JOIN reseller_stores s ON s.id = l.store_id
			JOIN products p ON p.id = l.product_id
			WHERE l.id::text = ANY($1::text[]) AND l.is_active AND s.status = 'active'
		`,
		[ids],
	);
	for (const row of result.rows) {
		resolved.set(row.id, {
			listingId: row.id,
			productId: row.product_id,
			salePrice: resellerPrice(Number(row.price), row.margin_type, Number(row.margin_value), settings).salePrice,
			storeId: row.store_id,
		});
	}
	return resolved;
}

/** What the order confirmation email needs to look like the store's own. */
export type OrderEmailStore = {
	accentColor: string;
	contactEmail: string;
	/** The store's live custom domain, if it has one. */
	domain: string | null;
	handle: string;
	name: string;
	theme: StoreTheme;
	whatsapp: string;
};

/** Branding for a store's order email, read inside the checkout transaction. */
export async function getOrderEmailStore(client: PoolClient, storeId: string): Promise<OrderEmailStore | null> {
	const result = await client.query<{
		accent_color: string;
		contact_email: string;
		domain: string | null;
		handle: string;
		name: string;
		theme: StoreTheme;
		whatsapp: string;
	}>(
		`
			SELECT s.name, s.handle, s.accent_color, s.theme, s.whatsapp, s.contact_email, d.domain
			FROM reseller_stores s
			LEFT JOIN reseller_store_domains d ON d.store_id = s.id AND d.status = 'active'
			WHERE s.id = $1
		`,
		[storeId],
	);
	const row = result.rows[0];
	if (!row) return null;
	return {
		accentColor: row.accent_color,
		contactEmail: row.contact_email ?? "",
		domain: row.domain,
		handle: row.handle,
		name: row.name,
		theme: STORE_THEMES.includes(row.theme) ? row.theme : DEFAULT_STORE_THEME,
		whatsapp: row.whatsapp ?? "",
	};
}

/** Record what a reseller earns on one order line (called from checkout). */
export async function recordResellerEarning(
	client: PoolClient,
	{
		basePrice,
		chargedUnitPrice,
		orderId,
		orderItemId,
		productId,
		productName,
		quantity,
		storeId,
	}: {
		basePrice: number;
		chargedUnitPrice: number;
		orderId: string;
		orderItemId: string;
		productId: string;
		productName: string;
		quantity: number;
		storeId: string;
	},
) {
	const settings = await getResellerSettings(client);
	// A bundle discount can eat into the margin; the reseller never owes money.
	const perUnit = Math.max(0, Math.round((chargedUnitPrice - basePrice) * 100) / 100);
	const margin = Math.round(perUnit * quantity * 100) / 100;
	if (margin <= 0) return;
	const fee = Math.round(margin * (settings.platformFeePercent / 100) * 100) / 100;

	await client.query(
		`
			INSERT INTO reseller_earnings (
				store_id, order_id, order_item_id, product_id, product_name, quantity,
				base_unit_price, sale_unit_price, margin_amount, platform_fee, net_amount
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`,
		[storeId, orderId, orderItemId, productId, productName, quantity, basePrice, chargedUnitPrice, margin, fee, Math.round((margin - fee) * 100) / 100],
	);
}

/* ------------------------------------------------------------------------
 * Earnings, orders and payouts (seller)
 * --------------------------------------------------------------------- */

// Concurrent callers share one in-flight refresh: parallel UPDATEs of the
// same earnings rows would only queue behind each other's row locks.
let refreshing: Promise<void> | null = null;
export function refreshEarnings() {
	refreshing ??= dbQuery(`SELECT refresh_reseller_earnings()`)
		.then(() => undefined)
		.finally(() => {
			refreshing = null;
		});
	return refreshing;
}

export async function getStoreBalances(storeId: string): Promise<ResellerBalances> {
	const result = await dbQuery<{
		available: string;
		lifetime: string;
		paid: string;
		pending: string;
		requested: string;
	}>(
		`
			SELECT
				COALESCE((SELECT sum(net_amount) FROM reseller_earnings WHERE store_id = $1 AND status = 'pending'), 0)::text AS pending,
				COALESCE((SELECT sum(net_amount) FROM reseller_earnings WHERE store_id = $1 AND status = 'available'), 0)::text AS available,
				COALESCE((SELECT sum(net_amount) FROM reseller_earnings WHERE store_id = $1 AND status <> 'cancelled'), 0)::text AS lifetime,
				COALESCE((SELECT sum(amount) FROM reseller_payouts WHERE store_id = $1 AND status = 'paid'), 0)::text AS paid,
				COALESCE((SELECT sum(amount) FROM reseller_payouts WHERE store_id = $1 AND status = 'requested'), 0)::text AS requested
		`,
		[storeId],
	);
	const row = result.rows[0];
	const available = Number(row.available);
	const paid = Number(row.paid);
	const requested = Number(row.requested);
	return {
		available,
		lifetime: Number(row.lifetime),
		paid,
		pending: Number(row.pending),
		requested,
		withdrawable: Math.max(0, Math.round((available - paid - requested) * 100) / 100),
	};
}

export async function getSellerOverview(customerId: string) {
	const [store] = await Promise.all([requireStoreForCustomer(customerId), refreshEarnings()]);
	const [settings, balances, stats, daily, listingCount, customDomain] = await Promise.all([
		getResellerSettings(),
		getStoreBalances(store.id),
		dbQuery<{ orders: number; sales: string; units: number }>(
			`
				SELECT count(DISTINCT e.order_id)::int AS orders,
					COALESCE(sum(e.sale_unit_price * e.quantity), 0)::text AS sales,
					COALESCE(sum(e.quantity), 0)::int AS units
				FROM reseller_earnings e
				WHERE e.store_id = $1 AND e.status <> 'cancelled' AND e.created_at >= now() - interval '30 days'
			`,
			[store.id],
		),
		dbQuery<{ day: string; earned: string; orders: number }>(
			`
				SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
					COALESCE(sum(e.net_amount), 0)::text AS earned,
					count(DISTINCT e.order_id)::int AS orders
				FROM generate_series(current_date - 13, current_date, interval '1 day') AS d(day)
				LEFT JOIN reseller_earnings e
					ON e.store_id = $1 AND e.status <> 'cancelled'
					AND e.created_at >= d.day AND e.created_at < d.day + interval '1 day'
				GROUP BY d.day ORDER BY d.day
			`,
			[store.id],
		),
		dbQuery<{ active: number; total: number }>(
			`SELECT count(*) FILTER (WHERE is_active)::int AS active, count(*)::int AS total FROM reseller_listings WHERE store_id = $1`,
			[store.id],
		),
		getStoreDomain(store.id),
	]);

	return {
		balances,
		// Only the status matters to the dashboard; the token stays server-side here.
		customDomain: customDomain ? { domain: customDomain.domain, status: customDomain.status } : null,
		daily: daily.rows.map((row) => ({ date: row.day, earned: Number(row.earned), orders: row.orders })),
		last30Days: {
			orders: stats.rows[0].orders,
			sales: Number(stats.rows[0].sales),
			units: stats.rows[0].units,
		},
		listings: listingCount.rows[0],
		settings,
		store: { ...store, payoutDetails: maskPayoutDetails(store.payoutDetails) },
	};
}

export async function listSellerOrders(customerId: string) {
	const [store] = await Promise.all([requireStoreForCustomer(customerId), refreshEarnings()]);
	const result = await dbQuery<{
		available_at: Date | null;
		created_at: Date;
		customer_city: string | null;
		customer_first_name: string;
		earning: string;
		earning_status: "available" | "cancelled" | "pending";
		items: { name: string; quantity: number; salePrice: number }[];
		order_number: string;
		order_status: string;
		sales: string;
	}>(
		`
			SELECT o.order_number, o.status AS order_status, o.created_at,
				split_part(o.customer_name, ' ', 1) AS customer_first_name,
				o.shipping_address->>'city' AS customer_city,
				sum(e.net_amount)::text AS earning,
				sum(e.sale_unit_price * e.quantity)::text AS sales,
				-- An order's lines share a status; the "worst" one wins if not.
				(array_agg(e.status ORDER BY CASE e.status WHEN 'cancelled' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END))[1] AS earning_status,
				max(e.available_at) AS available_at,
				json_agg(json_build_object('name', e.product_name, 'quantity', e.quantity, 'salePrice', e.sale_unit_price)) AS items
			FROM reseller_earnings e
			JOIN orders o ON o.id = e.order_id
			WHERE e.store_id = $1
			GROUP BY o.id
			ORDER BY o.created_at DESC
			LIMIT 200
		`,
		[store.id],
	);
	return result.rows.map((row) => ({
		availableAt: row.available_at?.toISOString() ?? null,
		// Resellers see who to follow up with, not full contact details.
		customer: [row.customer_first_name, row.customer_city].filter(Boolean).join(", "),
		createdAt: row.created_at.toISOString(),
		earning: Number(row.earning),
		earningStatus: row.earning_status,
		items: row.items,
		orderNumber: row.order_number,
		orderStatus: row.order_status,
		sales: Number(row.sales),
	}));
}

export async function listSellerPayouts(customerId: string) {
	const store = await requireStoreForCustomer(customerId);
	return listPayoutsForStore(store.id, { mask: true });
}

type PayoutRow = {
	admin_note: string;
	amount: string;
	id: string;
	payout_details: PayoutDetails;
	processed_at: Date | null;
	reference: string;
	requested_at: Date;
	status: "paid" | "rejected" | "requested";
};

function toPayout(row: PayoutRow, mask: boolean) {
	return {
		adminNote: row.admin_note,
		amount: Number(row.amount),
		id: row.id,
		payoutDetails: mask ? maskPayoutDetails(row.payout_details) : row.payout_details,
		processedAt: row.processed_at?.toISOString() ?? null,
		reference: row.reference,
		requestedAt: row.requested_at.toISOString(),
		status: row.status,
	};
}

async function listPayoutsForStore(storeId: string, { mask }: { mask: boolean }) {
	const result = await dbQuery<PayoutRow>(
		`
			SELECT id::text, amount, status, payout_details, reference, admin_note, requested_at, processed_at
			FROM reseller_payouts WHERE store_id = $1 ORDER BY requested_at DESC LIMIT 100
		`,
		[storeId],
	);
	return result.rows.map((row) => toPayout(row, mask));
}

const payoutRequestSchema = z.object({ amount: z.coerce.number().positive().max(10_000_000) });

export async function requestPayout(customerId: string, body: unknown) {
	const { amount } = parseInput(payoutRequestSchema, body);
	const roundedAmount = Math.round(amount * 100) / 100;
	await refreshEarnings();

	return withTransaction(async (client) => {
		// Serialise payout requests per store so two tabs can't both withdraw.
		const storeResult = await client.query<StoreRow>(
			`SELECT ${STORE_COLUMNS} FROM reseller_stores s WHERE s.customer_id = $1 FOR UPDATE`,
			[customerId],
		);
		if (!storeResult.rows[0]) throw new HttpError(404, "Open your store first.", "NO_STORE");
		const store = toStore(storeResult.rows[0]);
		const settings = await getResellerSettings(client);

		// A lapsed plan takes the store offline, but money already earned can still be withdrawn.
		if (store.status === "suspended") {
			throw new HttpError(403, "Payouts are unavailable while your store is suspended.", "STORE_SUSPENDED");
		}
		if (store.payoutsBlocked) {
			throw new HttpError(403, "Payouts are on hold for your store. Contact support for details.", "PAYOUTS_BLOCKED");
		}
		if (!("method" in store.payoutDetails)) {
			throw new HttpError(400, "Add your UPI or bank details first.", "NO_PAYOUT_DETAILS");
		}
		const open = await client.query(`SELECT 1 FROM reseller_payouts WHERE store_id = $1 AND status = 'requested'`, [store.id]);
		if (open.rowCount) {
			throw new HttpError(409, "You already have a payout request in progress.", "PAYOUT_PENDING");
		}
		if (roundedAmount < settings.minPayout) {
			throw new HttpError(400, `The minimum payout is ${settings.minPayout.toFixed(2)}.`, "BELOW_MINIMUM", { field: "amount" });
		}

		const balance = await client.query<{ available: string; paid: string }>(
			`
				SELECT
					COALESCE((SELECT sum(net_amount) FROM reseller_earnings WHERE store_id = $1 AND status = 'available'), 0)::text AS available,
					COALESCE((SELECT sum(amount) FROM reseller_payouts WHERE store_id = $1 AND status = 'paid'), 0)::text AS paid
			`,
			[store.id],
		);
		const withdrawable = Math.round((Number(balance.rows[0].available) - Number(balance.rows[0].paid)) * 100) / 100;
		if (roundedAmount > withdrawable) {
			throw new HttpError(400, `You can withdraw up to ${withdrawable.toFixed(2)} right now.`, "INSUFFICIENT_BALANCE", { field: "amount" });
		}

		const inserted = await client.query<PayoutRow>(
			`
				INSERT INTO reseller_payouts (store_id, amount, payout_details)
				VALUES ($1, $2, $3)
				RETURNING id::text, amount, status, payout_details, reference, admin_note, requested_at, processed_at
			`,
			[store.id, roundedAmount, JSON.stringify(store.payoutDetails)],
		);
		return toPayout(inserted.rows[0], true);
	});
}

/* ------------------------------------------------------------------------
 * Admin
 * --------------------------------------------------------------------- */

/** Marketplace totals. Call refreshEarnings() first for up-to-date balances. */
export async function getAdminResellerOverview() {
	const result = await dbQuery<{
		active_stores: number;
		gmv_30d: string;
		open_payouts: number;
		open_payouts_amount: string;
		owed: string;
		suspended_stores: number;
		total_stores: number;
	}>(`
		SELECT
			(SELECT count(*)::int FROM reseller_stores) AS total_stores,
			(SELECT count(*)::int FROM reseller_stores WHERE status = 'active') AS active_stores,
			(SELECT count(*)::int FROM reseller_stores WHERE status = 'suspended') AS suspended_stores,
			(SELECT COALESCE(sum(sale_unit_price * quantity), 0)::text FROM reseller_earnings
				WHERE status <> 'cancelled' AND created_at >= now() - interval '30 days') AS gmv_30d,
			(SELECT count(*)::int FROM reseller_payouts WHERE status = 'requested') AS open_payouts,
			(SELECT COALESCE(sum(amount), 0)::text FROM reseller_payouts WHERE status = 'requested') AS open_payouts_amount,
			(SELECT COALESCE(sum(net_amount), 0) FROM reseller_earnings WHERE status IN ('pending', 'available'))
				- (SELECT COALESCE(sum(amount), 0) FROM reseller_payouts WHERE status = 'paid') AS owed
	`);
	const row = result.rows[0];
	return {
		activeStores: row.active_stores,
		gmv30d: Number(row.gmv_30d),
		openPayouts: row.open_payouts,
		openPayoutsAmount: Number(row.open_payouts_amount),
		owed: Math.max(0, Number(row.owed)),
		suspendedStores: row.suspended_stores,
		totalStores: row.total_stores,
	};
}

/** All stores with sales and balances. Call refreshEarnings() first. */
export async function listAdminStores() {
	const result = await dbQuery<StoreRow & {
		customer_email: string;
		customer_name: string;
		earned: string;
		listings: number;
		orders: number;
		sales: string;
		withdrawable: string;
	}>(`
		SELECT ${STORE_COLUMNS}, cu.name AS customer_name, cu.email AS customer_email,
			(SELECT count(*)::int FROM reseller_listings l WHERE l.store_id = s.id AND l.is_active) AS listings,
			(SELECT count(DISTINCT e.order_id)::int FROM reseller_earnings e WHERE e.store_id = s.id AND e.status <> 'cancelled') AS orders,
			(SELECT COALESCE(sum(e.sale_unit_price * e.quantity), 0)::text FROM reseller_earnings e WHERE e.store_id = s.id AND e.status <> 'cancelled') AS sales,
			(SELECT COALESCE(sum(e.net_amount), 0)::text FROM reseller_earnings e WHERE e.store_id = s.id AND e.status <> 'cancelled') AS earned,
			((SELECT COALESCE(sum(e.net_amount), 0) FROM reseller_earnings e WHERE e.store_id = s.id AND e.status = 'available')
				- (SELECT COALESCE(sum(p.amount), 0) FROM reseller_payouts p WHERE p.store_id = s.id AND p.status IN ('paid', 'requested')))::text AS withdrawable
		FROM reseller_stores s
		JOIN customers cu ON cu.id = s.customer_id
		ORDER BY s.created_at DESC
	`);
	return result.rows.map((row) => ({
		...toStore(row),
		customerEmail: row.customer_email,
		customerName: row.customer_name,
		earned: Number(row.earned),
		listings: row.listings,
		orders: row.orders,
		payoutDetails: maskPayoutDetails(row.payout_details ?? {}),
		sales: Number(row.sales),
		withdrawable: Math.max(0, Number(row.withdrawable)),
	}));
}

export async function getAdminStore(storeId: string) {
	await refreshEarnings();
	const result = await dbQuery<StoreRow & { customer_email: string; customer_name: string; customer_phone: string }>(
		`
			SELECT ${STORE_COLUMNS}, cu.name AS customer_name, cu.email AS customer_email, cu.phone AS customer_phone
			FROM reseller_stores s JOIN customers cu ON cu.id = s.customer_id
			WHERE s.id::text = $1
		`,
		[storeId],
	);
	const row = result.rows[0];
	if (!row) return null;
	const store = toStore(row);
	const [balances, listings, payouts, orders, customDomain] = await Promise.all([
		getStoreBalances(store.id),
		listStoreListings(store.id),
		listPayoutsForStore(store.id, { mask: false }),
		dbQuery<{ created_at: Date; earning: string; order_number: string; order_status: string; sales: string; status: string }>(
			`
				SELECT o.order_number, o.status AS order_status, o.created_at,
					sum(e.net_amount)::text AS earning, sum(e.sale_unit_price * e.quantity)::text AS sales,
					min(e.status) AS status
				FROM reseller_earnings e JOIN orders o ON o.id = e.order_id
				WHERE e.store_id = $1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100
			`,
			[store.id],
		),
		getStoreDomain(store.id),
	]);
	return {
		balances,
		customDomain: customDomain
			? { domain: customDomain.domain, lastError: customDomain.lastError, status: customDomain.status, verifiedAt: customDomain.verifiedAt }
			: null,
		customer: { email: row.customer_email, name: row.customer_name, phone: row.customer_phone },
		listings,
		orders: orders.rows.map((order) => ({
			createdAt: order.created_at.toISOString(),
			earning: Number(order.earning),
			earningStatus: order.status,
			orderNumber: order.order_number,
			orderStatus: order.order_status,
			sales: Number(order.sales),
		})),
		payouts,
		store,
	};
}

const moderationSchema = z.object({
	// Clears an inappropriate logo / banner / about text.
	clearBranding: z.boolean().optional(),
	// Disconnects the store's custom domain.
	removeDomain: z.boolean().optional(),
	payoutsBlocked: z.boolean().optional(),
	reason: z.string().trim().max(300).optional(),
	status: z.enum(["active", "suspended"]).optional(),
});

export async function moderateStore(storeId: string, body: unknown) {
	const input = parseInput(moderationSchema, body);
	if (input.status === "suspended" && !input.reason) {
		throw new HttpError(400, "Give a reason - the seller will see it.", "REASON_REQUIRED", { field: "reason" });
	}
	const result = await dbQuery<{ customer_id: string }>(
		`
			UPDATE reseller_stores SET
				status = COALESCE($2, status),
				suspended_reason = CASE
					WHEN $2 = 'suspended' THEN $3
					WHEN $2 = 'active' THEN ''
					ELSE suspended_reason END,
				payouts_blocked = COALESCE($4, payouts_blocked),
				logo_url = CASE WHEN $5 THEN '' ELSE logo_url END,
				banner_url = CASE WHEN $5 THEN '' ELSE banner_url END,
				about = CASE WHEN $5 THEN '' ELSE about END,
				announcement = CASE WHEN $5 THEN '' ELSE announcement END
			WHERE id::text = $1
			RETURNING customer_id
		`,
		[storeId, input.status ?? null, input.reason ?? "", input.payoutsBlocked ?? null, input.clearBranding === true],
	);
	if (!result.rowCount) throw new HttpError(404, "Store not found.", "STORE_NOT_FOUND");
	// Reactivating doesn't skip billing: without a plan (when one is required) it lands on 'unpaid'.
	await syncStoreBilling(result.rows[0].customer_id, (await getResellerSettings()).subscriptionsRequired);
	if (input.removeDomain) await removeStoreDomain(storeId);
	return getAdminStore(storeId);
}

export async function listAdminPayouts(status?: string) {
	const filter = ["requested", "paid", "rejected"].includes(status ?? "") ? status : null;
	const result = await dbQuery<PayoutRow & { store_handle: string; store_id: string; store_name: string }>(
		`
			SELECT p.id::text, p.amount, p.status, p.payout_details, p.reference, p.admin_note,
				p.requested_at, p.processed_at, s.id::text AS store_id, s.handle AS store_handle, s.name AS store_name
			FROM reseller_payouts p JOIN reseller_stores s ON s.id = p.store_id
			WHERE ($1::text IS NULL OR p.status = $1)
			ORDER BY (p.status = 'requested') DESC, p.requested_at DESC
			LIMIT 200
		`,
		[filter],
	);
	return result.rows.map((row) => ({
		...toPayout(row, false),
		store: { handle: row.store_handle, id: row.store_id, name: row.store_name },
	}));
}

const processPayoutSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("paid"),
		note: z.string().trim().max(300).optional(),
		reference: z.string().trim().min(3, "Enter the transfer reference (UTR / transaction ID).").max(80),
	}),
	z.object({
		action: z.literal("rejected"),
		note: z.string().trim().min(3, "Tell the seller why.").max(300),
	}),
]);

export async function processPayout(payoutId: string, body: unknown) {
	const input = parseInput(processPayoutSchema, body);
	return withTransaction(async (client) => {
		const current = await client.query<{ status: string }>(
			`SELECT status FROM reseller_payouts WHERE id::text = $1 FOR UPDATE`,
			[payoutId],
		);
		if (!current.rows[0]) throw new HttpError(404, "Payout not found.", "PAYOUT_NOT_FOUND");
		if (current.rows[0].status !== "requested") {
			throw new HttpError(409, "This payout was already processed.", "PAYOUT_PROCESSED");
		}
		const updated = await client.query<PayoutRow>(
			`
				UPDATE reseller_payouts
				SET status = $2, reference = $3, admin_note = $4, processed_at = now()
				WHERE id::text = $1
				RETURNING id::text, amount, status, payout_details, reference, admin_note, requested_at, processed_at
			`,
			[payoutId, input.action, input.action === "paid" ? input.reference : "", input.note ?? ""],
		);
		return toPayout(updated.rows[0], false);
	});
}

/** Store(s) an order was sold through and what they earn, for the admin order page. */
export async function getOrderResellerSummary(orderNumber: string) {
	const result = await dbQuery<{ earning: string; handle: string; id: string; name: string; status: string }>(
		`
			SELECT s.id::text, s.handle, s.name, sum(e.net_amount)::text AS earning, min(e.status) AS status
			FROM reseller_earnings e
			JOIN reseller_stores s ON s.id = e.store_id
			JOIN orders o ON o.id = e.order_id
			WHERE o.order_number = $1
			GROUP BY s.id
		`,
		[orderNumber],
	);
	return result.rows.map((row) => ({
		earning: Number(row.earning),
		handle: row.handle,
		id: row.id,
		name: row.name,
		status: row.status,
	}));
}
