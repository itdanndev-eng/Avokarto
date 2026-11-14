import { cache } from "react";
import type { Metadata } from "next";
import { hasDatabaseConfig } from "@/lib/backend/db";
import { getProductSlugRedirect, getStorefrontProduct } from "@/lib/backend/storefront-data";
import type { Product } from "@/types";
import { isIndexablePath, isSiteIndexable } from "@/lib/seoRoutes";
import { gtinProperty, SEO_DESCRIPTION_MAX } from "@/lib/productSeoFields";

export const SITE_NAME = "Avokarto";
export const SITE_TAGLINE = "Dropshipping Store Builder & Product Reels";
export const SITE_DESCRIPTION =
  "Avokarto is a dropshipping platform with a store builder, product catalog and ready-made reels. Launch your branded store; we pack and ship your orders.";
// The shop behind the platform keeps its own pitch (/marketplace, shop pages).
export const MARKETPLACE_TAGLINE = "Pet Accessories, Gadgets & Novelty Finds";
export const MARKETPLACE_DESCRIPTION =
  "Discover pet costumes and accessories, clever gadgets, and playful novelty finds on the Avokarto marketplace. Free shipping on orders of $100 USD or more after discounts.";

/** Absolute site origin for canonical URLs, Open Graph, and structured data. */
export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password &&
          url.pathname === "/" && !url.search && !url.hash) return url.origin;
    } catch { /* Invalid launch settings are reported by deploy:env. */ }
  }
  return "http://localhost:3000";
}

// Local, code-rendered preview: no remote font/image requests at build time.
export const DEFAULT_SOCIAL_IMAGE = { url: "/social-image", width: 1200, height: 630, alt: `${SITE_NAME} — ${SITE_TAGLINE}` };

export function publicRobots(noindex = false): Metadata["robots"] {
  return {
    index: !noindex && isSiteIndexable(),
    follow: true,
    googleBot: { index: !noindex && isSiteIndexable(), follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  };
}

type PageMetadataInput = {
  // Page title without the brand - the root layout's template adds " | Avokarto".
  title: string;
  description: string;
  // Canonical path (e.g. "/about"). Omit for pages that shouldn't declare one.
  path?: string;
  // Private or transactional pages (cart, checkout, account, auth) have no
  // search value and shouldn't be indexed.
  noindex?: boolean;
};

/** Consistent title/description/canonical/Open Graph for a static page. */
export function pageMetadata({
  title,
  description,
  path,
  noindex = false,
}: PageMetadataInput): Metadata {
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    robots: publicRobots(noindex || Boolean(path && !isIndexablePath(path.split("?")[0]))),
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      images: [DEFAULT_SOCIAL_IMAGE],
      ...(path ? { url: path } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [DEFAULT_SOCIAL_IMAGE.url],
    },
  };
}

/**
 * One database read per request for a product route: generateMetadata and
 * the page body both call this, and React's cache() shares the result.
 * Errors propagate (a database outage is not "product not found") - callers
 * decide how to degrade.
 */
export const getRouteProduct = cache(
  (id: string): Promise<Product | null> => getStorefrontProduct(id),
);

/**
 * Where a retired product URL handle now lives (e.g. after a rename), or
 * null. Shared by generateMetadata and the page body via cache().
 */
export const getRouteProductRedirect = cache(
  async (id: string): Promise<string | null> => {
    const slug = await getProductSlugRedirect(id);
    return slug ? productPath({ slug, id: slug }) : null;
  },
);

export function plainText(value: string | undefined | null) {
  return (value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[entity.toLowerCase()] ?? entity)
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export function absoluteUrl(src: string | undefined) {
  if (!src) return undefined;
  try {
    const url = new URL(src, `${siteUrl()}/`);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/**
 * Search-friendly product name for titles: merchant names typed in ALL CAPS
 * ("COZYCARRY | CATS & DOGS") read as shouting in results, and an internal
 * "|" collides with the " | Avokarto" suffix. On-page names stay as entered.
 */
export function productSeoTitle(title: string) {
  let name = title.replace(/\s*\|\s*/g, " – ").replace(/\s+/g, " ").trim();
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    name = name
      .toLowerCase()
      .replace(/\b([a-z])/g, (match) => match.toUpperCase())
      .replace(/\b(And|Or|Of|For|The|A|An|In|On|With|To)\b/g, (word, _w, offset) =>
        offset === 0 ? word : word.toLowerCase(),
      );
  }
  return name;
}

export function productPath(product: Pick<Product, "slug" | "id">) {
  return `/product/${encodeURIComponent(product.slug || String(product.id))}`;
}

/** Search/social description: the SEO tab's text, else real catalog copy. */
export function productDescription(product: Product) {
  const custom = plainText(product.seoDescription);
  if (custom) return truncate(custom, SEO_DESCRIPTION_MAX);
  const own = plainText(product.shortSummary) || plainText(product.description);
  const category = product.category?.[0];
  const name = productSeoTitle(product.title);
  // Factual fallback only - no promises the store hasn't made.
  const fallback = `Shop ${name}${category ? ` from our ${category} collection` : ""} at ${SITE_NAME}. See photos, reviews, current price, and live stock.`;
  return truncate(own || fallback, 158);
}

/**
 * Every distinct gallery image as an absolute URL, primary first. Google
 * recommends several images per product; the gallery is the source of truth,
 * with imgSrc/hoverImgSrc as the fallback for rows that predate it.
 */
export function productImageUrls(product: Product, limit = 10) {
  const sources = [
    product.imgSrc,
    ...(product.variants ?? []).map((variant) => variant.src),
    product.hoverImgSrc,
  ];
  const urls: string[] = [];
  for (const src of sources) {
    const url = absoluteUrl(src ?? undefined);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length === limit) break;
  }
  return urls;
}

/**
 * Alt text for one product image: the merchant's own text from the SEO tab,
 * else a descriptive fallback. Accepts the stored (relative) or absolute URL.
 */
export function productImageAlt(product: Product, src: string, index = 0) {
  const alts = product.imageAlts ?? {};
  const own = alts[src] ?? Object.entries(alts).find(([key]) => absoluteUrl(key) === absoluteUrl(src))?.[1];
  if (own) return own;
  return index === 0 ? product.title : `${product.title} – view ${index + 1}`;
}

/**
 * Metadata for any product detail route. Every alternative product layout
 * (/product-single-*) declares the main /product/[slug] URL as canonical so
 * search engines index one page per product instead of dozens of duplicates.
 */
export async function productMetadata(id: string): Promise<Metadata> {
  let product: Product | null = null;
  if (hasDatabaseConfig()) {
    try {
      product = await getRouteProduct(id);
    } catch {
      // Transient DB failure: the page renders its own retry state; keep
      // metadata generic rather than failing the whole response.
      return { title: "Product", robots: { index: false, follow: true } };
    }
  }
  if (!product) {
    return {
      title: "Product not found",
      description: SITE_DESCRIPTION,
      robots: { index: false, follow: true },
    };
  }

  const description = productDescription(product);
  const path = productPath(product);
  const customTitle = product.seoTitle?.replace(/\s+/g, " ").trim();
  const name = customTitle || productSeoTitle(product.title);
  // A custom title that already names the store skips the " | Avokarto"
  // template suffix instead of repeating it.
  const brandedTitle = new RegExp(`\\b${SITE_NAME}\\s*$`, "i").test(name);
  const fullTitle = brandedTitle ? name : `${name} | ${SITE_NAME}`;
  const images = productImageUrls(product, 4).map((url, index) => ({
    url,
    alt: productImageAlt(product, url, index),
  }));

  return {
    title: brandedTitle ? { absolute: name } : name,
    description,
    ...(product.seoKeywords?.length ? { keywords: product.seoKeywords } : {}),
    alternates: { canonical: path },
    robots: publicRobots(Boolean(product.seoNoindex)),
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      images: images.length ? images : [DEFAULT_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: images.length ? [images[0]] : [DEFAULT_SOCIAL_IMAGE.url],
    },
  };
}

/**
 * Open Graph product tags (Facebook/Pinterest product pins). These need
 * `property=` attributes, which Metadata's `other` can't emit, so the page
 * renders them as <meta> elements and React hoists them into <head>.
 */
export function productOpenGraphTags(product: Product): Array<[property: string, content: string]> {
  const offer = productOffer(product);
  if (!offer) return [];
  return [
    ["product:price:amount", offer.price],
    ["product:price:currency", "USD"],
    ["product:availability", offer.inStock ? "in stock" : "out of stock"],
    ["product:condition", "new"],
    ...(product.brand ? [["product:brand", product.brand] as [string, string]] : []),
    ...(product.sku ? [["product:retailer_item_id", product.sku] as [string, string]] : []),
  ];
}

function productOffer(product: Product) {
  if (!Number.isFinite(product.price) || product.price < 0) return null;
  const inStock =
    product.inStock !== false &&
    !product.isStockOut &&
    (typeof product.availableQuantity !== "number" || product.availableQuantity > 0);
  const oldPrice =
    typeof product.oldPrice === "number" && Number.isFinite(product.oldPrice) && product.oldPrice > product.price
      ? product.oldPrice.toFixed(2)
      : null;
  return { inStock, oldPrice, price: product.price.toFixed(2) };
}

/** generateMetadata for product routes shaped /…/[id]. */
export async function generateProductRouteMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return productMetadata(id);
}

/**
 * schema.org Product structured data (Google product rich results and
 * merchant listings: images, price, sale price, stock, identifiers, rating).
 * Only fields backed by real catalog data are emitted - no invented
 * shipping, return policy or review data.
 */
export function productJsonLd(product: Product) {
  const url = `${siteUrl()}${productPath(product)}`;
  const images = productImageUrls(product);
  const offer = productOffer(product);
  const gtinKey = product.gtin ? gtinProperty(product.gtin) : null;
  const mpn = product.mpn?.trim();
  const rating = product.verifiedRating;
  const hasRating =
    rating && Number.isInteger(rating.count) && rating.count > 0 &&
    Number.isFinite(rating.average) && rating.average >= 1 && rating.average <= 5;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.title,
    description: productDescription(product),
    url,
    ...(images.length ? { image: images } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(gtinKey ? { [gtinKey]: product.gtin } : {}),
    ...(mpn ? { mpn } : {}),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
    ...(product.category?.[0] ? { category: product.category[0] } : {}),
    ...(offer ? { offers: {
      "@type": "Offer",
      url,
      priceCurrency: "USD",
      price: offer.price,
      // A real previous price shows as a strikethrough "was" price.
      ...(offer.oldPrice ? {
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          priceType: "https://schema.org/StrikethroughPrice",
          price: offer.oldPrice,
          priceCurrency: "USD",
        },
      } : {}),
      availability: offer.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": `${siteUrl()}/#organization` },
    } } : {}),
    ...(hasRating ? {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: rating.average.toFixed(1),
        reviewCount: rating.count,
        bestRating: 5,
        worstRating: 1,
      },
      ...(rating.reviews.length ? {
        review: rating.reviews.map((review) => ({
          "@type": "Review",
          author: { "@type": "Person", name: review.author },
          datePublished: review.datePublished,
          reviewBody: plainText(review.body),
          reviewRating: {
            "@type": "Rating",
            ratingValue: review.rating,
            bestRating: 5,
            worstRating: 1,
          },
        })),
      } : {}),
    } : {}),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem", position: index + 1, name: item.name,
      item: new URL(item.path, `${siteUrl()}/`).href,
    })),
  };
}

export function collectionJsonLd({ name, description, path, products, offset = 0 }: {
  name: string;
  description: string;
  path: string;
  products: Product[];
  offset?: number;
}) {
  const url = new URL(path, siteUrl()).href;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    name, description, url,
    isPartOf: { "@id": `${siteUrl()}/#website` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.map((product, index) => ({
        "@type": "ListItem",
        position: offset + index + 1,
        name: product.title,
        url: new URL(productPath(product), siteUrl()).href,
      })),
    },
  };
}

/** Safe <script type="application/ld+json"> payload (escapes "</"). */
export function jsonLdString(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
