import type { Product, ProductSellerPreview } from "@/types/product";
import { dbQuery } from "@/lib/backend/db";
import { isValidGtin, parseImageAlts } from "@/lib/productSeoFields";

type StorefrontProductRow = {
	brand_name: string | null;
	category_name: string | null;
	category_slug?: string | null;
	color_variants: unknown;
	demo_tab: string[] | null;
	description: string;
	faqs: unknown;
	filter_color: string[] | null;
	filter_sizes: string[] | null;
	gallery_image_urls: string[] | null;
	hover_image_url: string | null;
	id: string;
	image_url: string;
	key_highlights: string[] | null;
	legacy_id: number | null;
	name: string;
	old_price: number | string | null;
	price: number | string;
	rating: number | string;
	review_count: number;
	short_summary: string | null;
	short_summary_image: string | null;
	short_summary_image_height: number | null;
	short_summary_image_width: number | null;
	slug: string;
	services: string[] | null;
	specifications: string | null;
	sku: string;
	status: string;
	stock: number;
	storefront_badge: string | null;
	tags: string[] | null;
	// Detail query only (STOREFRONT_PRODUCT_SEO_COLUMNS) - listings skip them.
	gtin?: string;
	image_alts?: unknown;
	mpn?: string;
	seo_description?: string;
	seo_keywords?: string[] | null;
	seo_noindex?: boolean;
	seo_title?: string;
	verified_rating_avg?: number | string | null;
	verified_rating_count?: number | null;
	verified_reviews?: unknown;
	seller_count?: number;
	seller_preview?: ProductSellerPreview["top"] | null;
};

type StorefrontProductQuery = {
	catalogIds?: readonly string[];
	productIds?: readonly string[];
	categories?: readonly string[];
	limit?: number;
	offset?: number;
	search?: string;
};

function arrayValue(value: string[] | null | undefined) {
	return value ?? [];
}

// color_variants is stored as jsonb, so pg hands it back already parsed -
// but as `unknown`, since nothing constrains its shape at the DB layer.
// Validate defensively rather than trusting it matches ColorVariant.
function colorVariantsValue(value: unknown) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (
			!item ||
			typeof item !== "object" ||
			typeof (item as { color?: unknown }).color !== "string" ||
			typeof (item as { src?: unknown }).src !== "string"
		) {
			return [];
		}

		const { color, src, tooltip } = item as {
			color: string;
			src: string;
			tooltip?: unknown;
		};

		return color.trim() && src.trim()
			? [{ color, src, tooltip: typeof tooltip === "string" ? tooltip : color }]
			: [];
	});
}

// faqs is stored as jsonb, so pg hands it back already parsed - but as
// `unknown`, since nothing constrains its shape at the DB layer.
function faqsValue(value: unknown) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (
			!item ||
			typeof item !== "object" ||
			typeof (item as { question?: unknown }).question !== "string" ||
			typeof (item as { answer?: unknown }).answer !== "string"
		) {
			return [];
		}

		const { question, answer } = item as { question: string; answer: string };
		return question.trim() && answer.trim() ? [{ question, answer }] : [];
	});
}

function verifiedReviewsValue(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const { author, body, datePublished, rating } = item as Record<string, unknown>;
		return typeof author === "string" && typeof body === "string" &&
			typeof datePublished === "string" && typeof rating === "number"
			? [{ author, body, datePublished, rating }]
			: [];
	});
}

function productDiscount(
	price: number,
	oldPrice: number | null,
) {
	if (!oldPrice || oldPrice <= price) {
		return null;
	}

	return Number((((oldPrice - price) / oldPrice) * 100).toFixed(1));
}

function badge(text: string | null) {
	if (!text) {
		return null;
	}

	return {
		bg: text.toLowerCase().includes("stock") ? "bg-red" : "bg-green",
		text,
	};
}

export function toStorefrontProduct(row: StorefrontProductRow): Product {
	const price = Number(row.price);
	const oldPrice = row.old_price === null ? null : Number(row.old_price);
	const category = row.category_name ? [row.category_name] : [];
	const brand = row.brand_name ? [row.brand_name] : [];

	return {
		availableQuantity: row.stock,
		badge: badge(row.storefront_badge),
		brand: row.brand_name ?? undefined,
		catalogId: row.id,
		category,
		categorySlug: row.category_slug ?? undefined,
		colorVariants: colorVariantsValue(row.color_variants),
		demoTab: arrayValue(row.demo_tab),
		description: row.description,
		detailsPageUrl: "/product",
		discount: productDiscount(price, oldPrice),
		faqs: faqsValue(row.faqs),
		filterBrands: brand,
		filterCategory: category,
		filterColor: arrayValue(row.filter_color),
		filterSizes: arrayValue(row.filter_sizes),
		hoverImgSrc: row.hover_image_url,
		id: row.legacy_id ?? row.id,
		imgSrc: row.image_url,
		inStock: row.stock > 0,
		keyHighlights: arrayValue(row.key_highlights),
		oldPrice,
		price,
		rating: Number(row.rating),
		reviewCount: row.review_count,
		services: arrayValue(row.services),
		shortSummary: row.short_summary ?? "",
		shortSummaryImage: row.short_summary_image ?? "",
		shortSummaryImageHeight: row.short_summary_image_height,
		shortSummaryImageWidth: row.short_summary_image_width,
		sku: row.sku,
		slug: row.slug,
		specifications: row.specifications ?? "",
		tags: arrayValue(row.tags),
		title: row.name,
		...(row.seo_title !== undefined
			? {
					gtin: row.gtin && isValidGtin(row.gtin) ? row.gtin : "",
					imageAlts: parseImageAlts(row.image_alts),
					mpn: row.mpn ?? "",
					seoDescription: row.seo_description ?? "",
					seoKeywords: arrayValue(row.seo_keywords),
					seoNoindex: Boolean(row.seo_noindex),
					seoTitle: row.seo_title,
				}
			: {}),
		...(row.seller_count
			? { sellers: { count: row.seller_count, top: row.seller_preview ?? [] } }
			: {}),
		...(row.verified_rating_count !== undefined
			? {
					verifiedRating: {
						average: Number(row.verified_rating_avg ?? 0),
						count: row.verified_rating_count ?? 0,
						reviews: verifiedReviewsValue(row.verified_reviews),
					},
				}
			: {}),
		// The admin gallery can hold any number of images (add/pin/remove) -
		// carry all of them through so the product detail page can show more
		// than just the thumbnail + one hover image. Older rows that predate
		// gallery_image_urls fall back to the original 2-image behavior.
		variants: row.gallery_image_urls?.length
			? row.gallery_image_urls.map((src) => ({ src }))
			: [
					{ src: row.image_url },
					...(row.hover_image_url ? [{ src: row.hover_image_url }] : []),
				],
	};
}

// Independent sellers carrying each product (active stores, active
// listings): how many, and the three with the most fulfilled orders for the
// shop card's avatar stack. Uses the indexed reseller_listings.product_id.
const SELLER_PREVIEW_JOIN = `
	LEFT JOIN LATERAL (
		SELECT
			(SELECT count(*)::int FROM reseller_listings l
				JOIN reseller_stores s ON s.id = l.store_id
				WHERE l.product_id = p.id AND l.is_active AND s.status = 'active') AS seller_count,
			(SELECT json_agg(top) FROM (
				SELECT s.handle, s.name, s.logo_url AS "logoUrl", s.accent_color AS "accentColor"
				FROM reseller_listings l
				JOIN reseller_stores s ON s.id = l.store_id
				WHERE l.product_id = p.id AND l.is_active AND s.status = 'active'
				ORDER BY (
					SELECT count(DISTINCT e.order_id) FROM reseller_earnings e
					WHERE e.store_id = s.id AND e.status <> 'cancelled'
				) DESC, s.created_at
				LIMIT 3
			) top) AS seller_preview
	) sl ON true
`;

export async function listStorefrontProducts({
	catalogIds,
	productIds,
	categories,
	limit = 24,
	offset = 0,
	search,
}: StorefrontProductQuery = {}) {
	const params: unknown[] = [];
	const where = ["p.status IN ('published', 'low stock')"];
	const requestedCatalogIds = [
		...new Set(catalogIds?.map((id) => id.trim()).filter(Boolean) ?? []),
	].slice(0, 24);
	let catalogOrderParam = 0;

	if (search?.trim()) {
		params.push(`%${search.trim()}%`);
		where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
	}

	if (requestedCatalogIds.length) {
		params.push(requestedCatalogIds);
		catalogOrderParam = params.length;
		where.push(`p.id = ANY($${catalogOrderParam}::uuid[])`);
	}

	if (productIds?.length) {
		params.push([...new Set(productIds)].slice(0, 24));
		where.push(`(p.id::text = ANY($${params.length}::text[]) OR p.legacy_id::text = ANY($${params.length}::text[]))`);
	}

	const categoryNames = [...new Set(categories?.map((name) => name.trim().toLowerCase()).filter(Boolean) ?? [])];
	if (categoryNames.length) {
		params.push(categoryNames);
		where.push(`c.status = 'published' AND lower(btrim(c.name)) = ANY($${params.length}::text[])`);
	}

	params.push(Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 100)) : 24);
	const limitParam = params.length;
	params.push(Number.isSafeInteger(offset) && offset > 0 ? offset : 0);

	const result = await dbQuery<StorefrontProductRow>(
		`
			SELECT
				p.id::text,
				p.legacy_id,
				p.sku,
				p.name,
				p.slug,
				p.description,
				p.image_url,
				p.hover_image_url,
				p.gallery_image_urls,
				p.price,
				p.old_price,
				p.stock,
				p.status,
				p.rating,
				p.review_count,
				p.storefront_badge,
				p.tags,
				p.filter_color,
				p.filter_sizes,
				p.services,
				p.demo_tab,
				p.color_variants,
				p.specifications,
				p.short_summary,
				p.short_summary_image,
				p.short_summary_image_width,
				p.short_summary_image_height,
				p.key_highlights,
				p.faqs,
				c.name AS category_name,
				CASE WHEN c.status = 'published' THEN c.slug END AS category_slug,
				b.name AS brand_name,
				sl.seller_count,
				sl.seller_preview
			FROM products p
			LEFT JOIN categories c ON c.id = p.category_id
			LEFT JOIN brands b ON b.id = p.brand_id
			${SELLER_PREVIEW_JOIN}
			WHERE ${where.join(" AND ")}
			ORDER BY ${catalogOrderParam ? `array_position($${catalogOrderParam}::uuid[], p.id) ASC,` : ""}
				p.updated_at DESC, p.name ASC, p.id ASC
			LIMIT $${limitParam} OFFSET $${params.length}
		`,
		params,
	);

	return result.rows.map(toStorefrontProduct);
}

export type TopSellingPeriod = "all-time" | "this-month" | "this-week" | "this-year";
export type TopSellingBasis = "rating" | "sales";
export type TopSellingProduct = Product & { unitsSold: number };
export type TopSellingResult = {
	basis: TopSellingBasis;
	items: TopSellingProduct[];
};

const TOP_SELLING_WINDOW_DAYS: Record<TopSellingPeriod, number | null> = {
	"all-time": null,
	"this-month": 30,
	"this-week": 7,
	"this-year": 365,
};

const TOP_SELLING_PRODUCT_COLUMNS = `
	p.id::text,
	p.legacy_id,
	p.sku,
	p.name,
	p.slug,
	p.description,
	p.image_url,
	p.hover_image_url,
	p.gallery_image_urls,
	p.price,
	p.old_price,
	p.stock,
	p.status,
	p.rating,
	p.review_count,
	p.storefront_badge,
	p.tags,
	p.filter_color,
	p.filter_sizes,
	p.services,
	p.demo_tab,
	p.color_variants,
	p.specifications,
	p.short_summary,
	p.short_summary_image,
	p.short_summary_image_width,
	p.short_summary_image_height,
	p.key_highlights,
	p.faqs,
	c.name AS category_name,
	CASE WHEN c.status = 'published' THEN c.slug END AS category_slug,
	b.name AS brand_name
`;

// days=null means "no lower bound" (all-time). Cancelled/failed orders never
// counted as a sale. Ranks products actually sold in the window - the
// legacy behavior of hand-tagging products with a static demoTab array
// couldn't reflect real demand and left every admin-added product invisible
// to every tab (see Products3.tsx history).
async function queryTopSellingByWindow(days: number | null, limit: number) {
	const result = await dbQuery<StorefrontProductRow & { units_sold: number }>(
		`
			SELECT
				${TOP_SELLING_PRODUCT_COLUMNS},
				SUM(oi.qty)::int AS units_sold
			FROM products p
			JOIN order_items oi ON oi.product_id = p.id
			JOIN orders o ON o.id = oi.order_id
			LEFT JOIN categories c ON c.id = p.category_id
			LEFT JOIN brands b ON b.id = p.brand_id
			WHERE p.status IN ('published', 'low stock')
				AND o.status NOT IN ('cancelled', 'failed')
				AND ($1::int IS NULL OR o.created_at >= now() - ($1::int * interval '1 day'))
			GROUP BY p.id, c.id, b.id
			HAVING SUM(oi.qty) > 0
			ORDER BY units_sold DESC, p.updated_at DESC
			LIMIT $2
		`,
		[days, limit],
	);

	return result.rows.map((row) => ({
		...toStorefrontProduct(row),
		unitsSold: row.units_sold,
	}));
}

// Covers two cold-start cases a "top selling" section otherwise can't
// survive: a fresh store with zero orders yet, and a real store mid a slow
// stretch where nothing sold in the selected window. Highest-rated catalog
// items are the closest honest stand-in for "what's popular" until sales
// data exists - callers use the returned `basis` to label these
// differently (e.g. "Highly rated" instead of "N sold").
async function queryTopRatedFallback(limit: number) {
	const result = await dbQuery<StorefrontProductRow>(
		`
			SELECT ${TOP_SELLING_PRODUCT_COLUMNS}
			FROM products p
			LEFT JOIN categories c ON c.id = p.category_id
			LEFT JOIN brands b ON b.id = p.brand_id
			WHERE p.status IN ('published', 'low stock')
			ORDER BY p.rating DESC, p.review_count DESC, p.updated_at DESC
			LIMIT $1
		`,
		[limit],
	);

	return result.rows.map((row) => ({ ...toStorefrontProduct(row), unitsSold: 0 }));
}

export async function getTopSellingProducts({
	limit = 8,
	period,
}: {
	limit?: number;
	period: TopSellingPeriod;
}): Promise<TopSellingResult> {
	const safeLimit = Math.max(1, Math.min(limit, 24));
	const days = TOP_SELLING_WINDOW_DAYS[period];

	const windowed = await queryTopSellingByWindow(days, safeLimit);
	if (windowed.length) {
		return { basis: "sales", items: windowed };
	}

	if (days !== null) {
		const allTime = await queryTopSellingByWindow(null, safeLimit);
		if (allTime.length) {
			return { basis: "sales", items: allTime };
		}
	}

	return { basis: "rating", items: await queryTopRatedFallback(safeLimit) };
}

const STOREFRONT_PRODUCT_COLUMNS = `
	p.id::text,
	p.legacy_id,
	p.sku,
	p.name,
	p.slug,
	p.description,
	p.image_url,
	p.hover_image_url,
	p.gallery_image_urls,
	p.price,
	p.old_price,
	p.stock,
	p.status,
	p.rating,
	p.review_count,
	p.storefront_badge,
	p.tags,
	p.filter_color,
	p.filter_sizes,
	p.services,
	p.demo_tab,
	p.color_variants,
	p.specifications,
	p.short_summary,
	p.short_summary_image,
	p.short_summary_image_width,
	p.short_summary_image_height,
	p.key_highlights,
	p.faqs,
	c.name AS category_name,
	CASE WHEN c.status = 'published' THEN c.slug END AS category_slug,
	b.name AS brand_name
`;
// Detail page only: search settings plus a rating summary built from
// approved reviews by real customer accounts (customer_id set). Admin-typed
// and generated reviews have no customer_id and are excluded here, so
// structured data never publishes ratings that weren't written by shoppers.
const STOREFRONT_PRODUCT_SEO_COLUMNS = `
	p.seo_title,
	p.seo_description,
	p.seo_keywords,
	p.seo_noindex,
	p.image_alts,
	p.gtin,
	p.mpn,
	vr.verified_rating_avg,
	vr.verified_rating_count,
	vr.verified_reviews
`;
const STOREFRONT_VERIFIED_REVIEWS_JOIN = `
	LEFT JOIN LATERAL (
		SELECT
			ROUND(AVG(r.rating)::numeric, 2) AS verified_rating_avg,
			COUNT(*)::int AS verified_rating_count,
			COALESCE(
				(
					SELECT json_agg(recent ORDER BY recent."datePublished" DESC)
					FROM (
						SELECT
							r2.customer_name AS author,
							left(r2.review, 1000) AS body,
							to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "datePublished",
							r2.rating
						FROM product_reviews r2
						WHERE r2.product_id = p.id
						AND r2.status = 'approved'
						AND r2.customer_id IS NOT NULL
						AND btrim(r2.review) <> ''
						ORDER BY r2.created_at DESC
						LIMIT 5
					) recent
				),
				'[]'::json
			) AS verified_reviews
		FROM product_reviews r
		WHERE r.product_id = p.id
		AND r.status = 'approved'
		AND r.customer_id IS NOT NULL
	) vr ON true
`;
const STOREFRONT_PRODUCT_FROM = `
	FROM products p
	LEFT JOIN categories c ON c.id = p.category_id
	LEFT JOIN brands b ON b.id = p.brand_id
`;

export async function getStorefrontProduct(id: string) {
	const result = await dbQuery<StorefrontProductRow>(
		`
			SELECT ${STOREFRONT_PRODUCT_COLUMNS}, ${STOREFRONT_PRODUCT_SEO_COLUMNS}
			${STOREFRONT_PRODUCT_FROM}
			${STOREFRONT_VERIFIED_REVIEWS_JOIN}
			WHERE p.status IN ('published', 'low stock')
			AND (
				p.id::text = $1
				OR p.sku = $1
				OR p.slug = $1
				OR p.legacy_id::text = $1
			)
			LIMIT 1
		`,
		[id],
	);

	return result.rows[0] ? toStorefrontProduct(result.rows[0]) : null;
}

/**
 * Current URL handle for a retired one (see product_slug_redirects), or null.
 * Only resolves to products that are still publicly visible.
 */
export async function getProductSlugRedirect(oldSlug: string) {
	const result = await dbQuery<{ slug: string }>(
		`
			SELECT p.slug
			FROM product_slug_redirects r
			JOIN products p ON p.id = r.product_id
			WHERE r.old_slug = $1
			AND p.status IN ('published', 'low stock')
			AND p.slug <> $1
			LIMIT 1
		`,
		[oldSlug],
	);

	return result.rows[0]?.slug ?? null;
}

// The breadcrumb's prev/next product nav used to browse a hardcoded static
// demo catalog (data/products/*) via `product.id - 1` / `+ 1` arithmetic -
// meaningless for real catalog rows, whose id is a UUID, so it always fell
// through to the same fixed array boundary product regardless of which real
// product was open. This resolves real neighbors by a stable, total order
// (created_at, then id as a tiebreaker) and wraps around at either end so
// the nav never dead-ends.
export async function getAdjacentProducts(catalogId: string) {
	// The current row's created_at is compared entirely inside SQL via this
	// CTE, rather than being read into JS and passed back as a parameter -
	// pg's timestamptz -> JS Date conversion truncates to millisecond
	// precision, so a round-tripped value could compare as *earlier* than
	// the true, more-precise value still stored in the table, making the
	// current product satisfy its own "greater than" check and show up as
	// its own neighbor.
	// Resolve both directions and their wraparound fallbacks in one database
	// round trip. COALESCE only evaluates a wrap lookup when that direction
	// has no neighbor; all lookups keep the same precise tuple ordering.
	const result = await dbQuery<StorefrontProductRow & { direction: "next" | "prev" }>(
		`
			WITH current_row AS (
				SELECT created_at, id FROM products WHERE id = $1::uuid
			), neighbor_ids AS (
				SELECT 'next' AS direction, COALESCE(
					(SELECT p.id FROM products p
					 WHERE p.status IN ('published', 'low stock')
					 AND (p.created_at, p.id) > (current_row.created_at, current_row.id)
					 ORDER BY p.created_at ASC, p.id ASC LIMIT 1),
					(SELECT p.id FROM products p
					 WHERE p.status IN ('published', 'low stock') AND p.id != current_row.id
					 ORDER BY p.created_at ASC, p.id ASC LIMIT 1)
				) AS id
				FROM current_row
				UNION ALL
				SELECT 'prev' AS direction, COALESCE(
					(SELECT p.id FROM products p
					 WHERE p.status IN ('published', 'low stock')
					 AND (p.created_at, p.id) < (current_row.created_at, current_row.id)
					 ORDER BY p.created_at DESC, p.id DESC LIMIT 1),
					(SELECT p.id FROM products p
					 WHERE p.status IN ('published', 'low stock') AND p.id != current_row.id
					 ORDER BY p.created_at DESC, p.id DESC LIMIT 1)
				) AS id
				FROM current_row
			)
			SELECT ${STOREFRONT_PRODUCT_COLUMNS}, neighbor_ids.direction
			${STOREFRONT_PRODUCT_FROM}
			JOIN neighbor_ids ON neighbor_ids.id = p.id
		`,
		[catalogId],
	);

	const nextRow = result.rows.find((row) => row.direction === "next");
	const prevRow = result.rows.find((row) => row.direction === "prev");

	return {
		next: nextRow ? toStorefrontProduct(nextRow) : null,
		prev: prevRow ? toStorefrontProduct(prevRow) : null,
	};
}

type PublicProductReviewRow = {
	created_at: Date | string;
	customer_name: string;
	id: string;
	rating: number;
	review: string;
};

export type PublicProductReview = {
	createdAt: string;
	customerName: string;
	id: string;
	rating: number;
	review: string;
};

export type PublicProductReviewSummary = {
	average: number;
	breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
	reviews: PublicProductReview[];
	total: number;
};

// Only 'approved' reviews are public - 'pending'/'draft' are moderation
// states an admin hasn't signed off on yet (see product_reviews.status
// CHECK constraint). Resolves the product by any real identifier the
// storefront might have on hand, mirroring getStorefrontProduct above.
export async function getPublicProductReviews(
	id: string,
): Promise<PublicProductReviewSummary> {
	const result = await dbQuery<PublicProductReviewRow>(
		`
			SELECT pr.id::text, pr.customer_name, pr.rating, pr.review, pr.created_at
			FROM product_reviews pr
			JOIN products p ON p.id = pr.product_id
			WHERE pr.status = 'approved'
			AND (
				p.id::text = $1
				OR p.sku = $1
				OR p.slug = $1
				OR p.legacy_id::text = $1
			)
			ORDER BY pr.created_at DESC
		`,
		[id],
	);

	const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = {
		1: 0,
		2: 0,
		3: 0,
		4: 0,
		5: 0,
	};
	let ratingSum = 0;

	for (const row of result.rows) {
		const bucket = Math.min(5, Math.max(1, Math.round(row.rating))) as
			| 1
			| 2
			| 3
			| 4
			| 5;
		breakdown[bucket] += 1;
		ratingSum += row.rating;
	}

	const total = result.rows.length;

	return {
		average: total ? Number((ratingSum / total).toFixed(2)) : 0,
		breakdown,
		reviews: result.rows.map((row) => ({
			createdAt: new Date(row.created_at).toLocaleDateString("en-US", {
				day: "numeric",
				month: "short",
				year: "numeric",
			}),
			customerName: row.customer_name,
			id: row.id,
			rating: row.rating,
			review: row.review,
		})),
		total,
	};
}

export type PublicStoreSettings = {
	address: string;
	chatLink: string;
	storeName: string;
	supportEmail: string;
	supportPhone: string;
};

type StoreSettingsRow = {
	address: string;
	chat_link: string;
	store_name: string;
	support_email: string;
	support_phone: string;
};

// A blank field means the admin hasn't set it - the /contact page hides that
// channel entirely rather than showing an empty label, same "no placeholder"
// rule as everywhere else real data is optional.
export async function getPublicStoreSettings(): Promise<PublicStoreSettings> {
	const result = await dbQuery<StoreSettingsRow>(`
		SELECT store_name, support_email, support_phone, address, chat_link
		FROM store_settings
		WHERE id = 1
	`);
	const row = result.rows[0];

	return {
		address: row?.address ?? "",
		chatLink: row?.chat_link ?? "",
		storeName: row?.store_name ?? "",
		supportEmail: row?.support_email ?? "",
		supportPhone: row?.support_phone ?? "",
	};
}

export type PublicCoupon = {
	code: string;
	discountValue: number;
	endsAt: string | null;
	minimumOrder: number;
	startsAt: string | null;
	subtitle: string;
	title: string;
	type: "fixed" | "percentage" | "shipping";
};

type PublicCouponRow = {
	code: string;
	discount_value: number | string;
	ends_at: Date | string | null;
	minimum_order: number | string;
	starts_at: Date | string | null;
	type: "fixed" | "percentage" | "shipping";
};

function couponTitle(type: PublicCouponRow["type"], discountValue: number) {
	if (type === "shipping") {
		return "Free Shipping";
	}

	if (type === "percentage") {
		return `${discountValue % 1 === 0 ? discountValue : discountValue.toFixed(1)}% Off`;
	}

	return `$${discountValue % 1 === 0 ? discountValue : discountValue.toFixed(2)} Off`;
}

function formatCouponDate(value: Date | string | null) {
	if (!value) {
		return null;
	}

	return new Date(value).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

// Admin sets `status` by hand when scheduling a coupon (see mutateCoupon in
// admin-mutations.ts) - it doesn't auto-flip to 'expired' the moment
// `ends_at` passes, so a coupon left marked 'active' after its window closes
// is a real, seen-in-production state, not a hypothetical. The storefront
// widget re-derives "actually usable right now" from the dates directly
// rather than trusting status alone, so an admin forgetting to update a
// stale coupon's status never leaks a dead code to customers.
export async function getPublicCoupons(): Promise<PublicCoupon[]> {
	const result = await dbQuery<PublicCouponRow>(`
		SELECT code, type, discount_value, minimum_order, starts_at, ends_at
		FROM coupons
		WHERE status = 'active'
			AND (starts_at IS NULL OR starts_at <= CURRENT_DATE)
			AND (ends_at IS NULL OR ends_at >= CURRENT_DATE)
		ORDER BY discount_value DESC, updated_at DESC
		LIMIT 12
	`);

	return result.rows.map((row) => {
		const discountValue = Number(row.discount_value);
		const minimumOrder = Number(row.minimum_order);

		return {
			code: row.code,
			discountValue,
			endsAt: formatCouponDate(row.ends_at),
			minimumOrder,
			startsAt: formatCouponDate(row.starts_at),
			subtitle:
				minimumOrder > 0
					? `For orders over $${minimumOrder % 1 === 0 ? minimumOrder : minimumOrder.toFixed(2)}`
					: "No minimum order",
			title: couponTitle(row.type, discountValue),
			type: row.type,
		};
	});
}
