// Render the actual production build without a listening socket or a live DB.
// The fixture is confined to this process, rejects writes, and never changes
// application data. Next's request mocks are tied to the installed Next version.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const builtPricing = readFileSync(new URL("../.next/server/app/pricing.html", import.meta.url), "utf8");
const origin = new URL(builtPricing.match(/rel="canonical" href="([^"]+)"/)[1]).origin;
process.env.NODE_ENV = "production";
process.env.NEXT_PUBLIC_SITE_URL = origin;
process.env.SITE_INDEXABLE = "false";
process.env.DATABASE_URL = "postgresql://fixture:fixture@localhost:5432/seo_fixture";
process.env.DATABASE_SESSION_URL = "";
process.env.DATABASE_SSL = "false";

const createServer = require("next");
const { createRequestResponseMocks } = require("next/dist/server/lib/mock-request.js");
const products = Array.from({ length: 31 }, (_, index) => ({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name: `Fixture pet product ${index + 1}`, slug: `fixture-pet-${index + 1}`, sku: `SEO-${index + 1}`, legacy_id: null,
  description: "A product fixture for isolated render verification.", short_summary: "Product fixture details.",
  image_url: "/assets/images/logo/avokarto-logo-mark.webp", hover_image_url: null, gallery_image_urls: [],
  price: "20.00", old_price: null, stock: 5, status: "published", rating: 0, review_count: 0,
  category_name: "Pet Accessories", category_slug: "pet-accessories", brand_name: null,
  seo_title: "", seo_description: "", seo_noindex: false,
  verified_rating_avg: 0, verified_rating_count: 0, verified_reviews: [], updated_at: new Date("2026-11-07T00:00:00Z"),
}));
const categories = [
  { id: "category-a", name: "Pet Accessories", slug: "pet-accessories", status: "published", sortOrder: 0, count: 31, image: null },
  { id: "category-b", name: "Empty Category", slug: "empty-category", status: "published", sortOrder: 1, count: 0, image: null },
];

globalThis.__unimartDatabasePool = { async query(sql, params = []) {
  assert.match(sql, /^\s*SELECT\b/i, "render verification permits SELECT only");
  if (sql.includes("FROM reseller_settings")) return { rows: [{ advertised_products: null, hold_days: 14, max_margin_percent: "50", min_payout: "20", platform_fee_percent: "0", signups_open: true, subscriptions_required: true }] };
  if (sql.includes("FROM categories c") && sql.includes("COUNT(p.id)")) return { rows: categories };
  if (sql.includes("FROM product_slug_redirects")) return { rows: [] };
  if (sql.includes("FROM products p")) {
    if (sql.includes("p.id::text = $1") || sql.includes("p.slug = $1")) {
      const row = products.find((product) => [product.id, product.slug, product.sku].includes(params[0]));
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("JOIN order_items") || sql.includes("JOIN orders")) return { rows: [] };
    const names = params.find(Array.isArray);
    const offset = Number(params.at(-1)) || 0;
    const limit = Number(params.at(-2)) || 24;
    return { rows: names?.some((name) => String(name).toLowerCase() === "empty category") ? [] : products.slice(offset, offset + limit) };
  }
  if (sql.includes("AS products") && sql.includes("AS stores")) return { rows: [{ products: "31", stores: "1", categories: "2" }] };
  return { rows: [] };
} };

const host = new URL(origin);
const app = createServer({ dir: root, dev: false, hostname: host.hostname, port: Number(host.port || (host.protocol === "https:" ? 443 : 80)), webpack: true });
const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
function schema(html) {
  return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(([, value]) => {
    const data = JSON.parse(value);
    return data["@graph"] || [data];
  });
}
async function render(url, userAgent = "Mozilla/5.0 SEO render verification") {
  const chunks = [];
  const { req, res } = createRequestResponseMocks({ url, socket: new Socket(), headers: { host: host.host, "user-agent": userAgent }, resWriter: (chunk) => { chunks.push(Buffer.from(chunk)); return true; } });
  // Next's mock stores headers in Web Headers, collapsing arrays into a single
  // comma-joined value. Preserve Node's real header semantics so repeated
  // redirects from metadata/page rendering are deduplicated as in production.
  const headerResponse = new ServerResponse(req);
  for (const method of ["setHeader", "appendHeader", "getHeader", "getHeaders", "getHeaderNames", "hasHeader", "removeHeader"]) {
    res[method] = headerResponse[method].bind(headerResponse);
  }
  await app.getRequestHandler()(req, res);
  await res.hasStreamed;
  const bytes = Buffer.concat(chunks);
  return { status: res.statusCode, headers: res.getHeaders(), bytes, html: bytes.toString() };
}

try {
  await app.prepare();
  for (const path of ["/", "/about", "/pricing", "/how-it-works", "/dropshipping-store-builder", "/guides", "/guides/how-to-start-dropshipping", "/guides/choose-dropshipping-products", "/guides/price-dropshipping-products", "/shop", "/shop?page=2", "/category/pet-accessories", "/category/pet-accessories?page=2", "/category/empty-category", "/product/fixture-pet-1"]) {
    const result = await render(path);
    assert.equal(result.status, 200, path);
    const body = stripScripts(result.html);
    assert.equal((body.match(/<h1\b/g) || []).length, 1, `${path} has one heading`);
    const canonical = body.match(/rel="canonical" href="([^"]+)"/)?.[1];
    assert.ok(canonical, `${path} canonical exists`);
    assert.equal(new URL(canonical).href, new URL(path, origin).href, `${path} canonical`);
    assert.match(body, /<meta name="description" content="[^"]+"/, `${path} description`);
    if (path.includes("page=2")) {
      assert.match(body, /Fixture pet product 25/);
      assert.doesNotMatch(body, />Fixture pet product 1</);
      assert.match(body, /rel="prev"/);
      assert.match(result.html, /"position":25/);
    }
    if (path === "/shop" || path === "/category/pet-accessories") {
      assert.match(body, /href="\/product\/fixture-pet-1"/, `${path} products are crawlable before JavaScript`);
    }
    if (path === "/shop") {
      assert.match(body, /href="\/shop\?page=2"/);
      assert.match(body, /href="\/category\/pet-accessories"/);
    }
    if (path.startsWith("/guides/")) assert.ok(schema(result.html).some((entry) => entry["@type"] === "Article"));
    if (path === "/") {
      const faq = schema(result.html).find((entry) => entry["@type"] === "FAQPage");
      assert.equal(faq.mainEntity.length, (body.match(/<summary\b/g) || []).length);
      for (const question of faq.mainEntity) assert.ok(body.includes(question.name), `visible FAQ: ${question.name}`);
      assert.match(body, /Avokarto is a dropshipping platform/);
    }
    if (path === "/about") {
      const entries = schema(result.html);
      const about = entries.find((entry) => entry["@type"] === "AboutPage");
      const organization = entries.find((entry) => entry["@type"] === "Organization");
      assert.equal(about.mainEntity["@id"], organization["@id"]);
      assert.equal(organization.mainEntityOfPage["@id"], about["@id"]);
      assert.match(body, /Avokarto is a dropshipping platform/);
    }
    console.log(`PASS ${path}: rendered heading, canonical, metadata and content`);
  }
  for (const path of ["/shop?page=0", "/shop?page=999999", "/category/missing", "/category/pet-accessories?page=999999", "/guides/unknown-guide", "/product/unknown-product"]) {
    for (const agent of ["Mozilla/5.0", "Googlebot"]) assert.equal((await render(path, agent)).status, 404, `${path} (${agent})`);
    console.log(`PASS ${path}: real 404 for visitors and crawlers`);
  }
  for (const [alias, target] of [["/categories-list", "/shop-by-categories"], ["/shop-by-category", "/shop-by-categories"], ["/product/SEO-1", "/product/fixture-pet-1"]]) {
    const result = await render(alias);
    assert.equal(result.status, 308, alias);
    // Node outgoing headers can be arrays; every emitted destination must agree.
    const locations = Array.isArray(result.headers.location) ? result.headers.location : [result.headers.location];
    assert.equal(new Set(locations).size, 1, `${alias} has a single redirect destination`);
    assert.equal(new URL(locations[0], origin).pathname, target);
  }
  const search = await render("/shop?q=cat");
  assert.match(stripScripts(search.html), /<meta name="robots" content="noindex/);
  assert.equal((await render("/sitemap.xml")).status, 200);
  assert.doesNotMatch((await render("/sitemap.xml")).html, /<loc>/);
  const image = await render("/social-image");
  assert.equal(image.status, 200);
  assert.equal(image.bytes.readUInt32BE(16), 1200);
  assert.equal(image.bytes.readUInt32BE(20), 630);
  console.log("PASS aliases, search exclusion, preview sitemap and 1200×630 social image");
} catch (error) {
  // Next installs an uncaught-error handler; retain a failing exit code in CI.
  process.exitCode = 1;
  throw error;
} finally {
  await app.close();
}
