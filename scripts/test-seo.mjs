import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";

function load(filename, imports, env) {
  const loadedModule = { exports: {} };
  const source = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  runInNewContext(compiled.outputText, { module: loadedModule, exports: loadedModule.exports, process: { env }, URL, URLSearchParams, TextEncoder, Headers,
    require(name) { if (!(name in imports)) throw new Error(`Unmocked dependency ${name}`); return imports[name]; },
  });
  return loadedModule.exports;
}

const env = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://shop.avokarto.com", SITE_INDEXABLE: "true" };
const routes = load("lib/seoRoutes.ts", {}, env);
const fields = load("lib/productSeoFields.ts", {}, env);
const verifiedRating = { average: 4.5, count: 2, reviews: [{ author: "Mila R.", body: "<b>Great</b> fit", datePublished: "2026-09-01", rating: 5 }] };
const product = { id: 123, slug: "cowboy-cat-shirt", title: "Cowboy Cat Shirt", price: 49.99, imgSrc: "/api/uploads/cat.webp", hoverImgSrc: "/api/uploads/cat.webp", shortSummary: "<p>Dress up &amp; have fun.</p>", inStock: true, availableQuantity: 4, sku: "CAT-123", rating: 4.5, reviewCount: 2, verifiedRating };
let routeProduct = product;
const seo = load("lib/seo.ts", {
  react: { cache: (fn) => fn },
  "@/lib/backend/db": { hasDatabaseConfig: () => true },
  "@/lib/backend/storefront-data": {
    getStorefrontProduct: async (id) => id === "missing" ? null : routeProduct,
    getProductSlugRedirect: async (id) => id === "old-cowboy" ? "cowboy-cat-shirt" : null,
  },
  "@/lib/productSeoFields": fields,
  "@/lib/seoRoutes": routes,
}, env);

test("canonical origins reject credentials, paths, and malformed launch settings", () => {
  for (const value of ["", "bad", "https://name:secret@shop.avokarto.com", "https://shop.avokarto.com/path", "https://shop.avokarto.com/?x=1"]) {
    env.NEXT_PUBLIC_SITE_URL = value;
    assert.equal(seo.siteUrl(), "http://localhost:3000");
  }
  env.NEXT_PUBLIC_SITE_URL = "https://shop.avokarto.com/";
  assert.equal(seo.siteUrl(), "https://shop.avokarto.com");
});

test("public/private metadata share social defaults and fail closed before launch", () => {
  const metadata = seo.pageMetadata({ title: "Shop", description: "Browse the collection.", path: "/shop" });
  assert.equal(metadata.alternates.canonical, "/shop");
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.openGraph.images[0].width, 1200);
  assert.equal(metadata.twitter.card, "summary_large_image");
  const paged = seo.pageMetadata({ title: "Shop - Page 2", description: "The next catalog page.", path: "/shop?page=2" });
  assert.equal(paged.robots.index, true);
  assert.equal(paged.alternates.canonical, "/shop?page=2");
  assert.equal(seo.pageMetadata({ title: "Cart", description: "Cart", noindex: true }).robots.index, false);
  env.SITE_INDEXABLE = "false";
  assert.equal(seo.publicRobots().index, false);
  env.SITE_INDEXABLE = "true";
});

test("product metadata uses the canonical slug and its real catalog image", async () => {
  const metadata = await seo.productMetadata("123");
  assert.equal(metadata.alternates.canonical, "/product/cowboy-cat-shirt");
  assert.equal(metadata.openGraph.images[0].url, "https://shop.avokarto.com/api/uploads/cat.webp");
  assert.equal(metadata.description, "Dress up & have fun.");
  assert.equal((await seo.productMetadata("missing")).robots.index, false);
  assert.equal(seo.productPath({ id: 1, slug: "cat & dog" }), "/product/cat%20%26%20dog");
});

test("search descriptions remove markup, scripts, and encoded entities", () => {
  assert.equal(seo.plainText('<p>Cat&nbsp;&amp; dog &#x1f43e;</p><script>bad()</script><style>.x{}</style>'), "Cat & dog 🐾");
  assert.ok(seo.productDescription({ ...product, shortSummary: "word ".repeat(100) }).length <= 158);
});

test("product JSON-LD has factual prices, stock, and only valid verified ratings", () => {
  const data = seo.productJsonLd(product);
  assert.equal(data.offers.price, "49.99");
  assert.equal(data.offers.priceCurrency, "USD");
  assert.equal(data.offers.availability, "https://schema.org/InStock");
  assert.equal(data.image.length, 1);
  assert.equal(data.aggregateRating.reviewCount, 2);
  assert.equal(seo.productJsonLd({ ...product, availableQuantity: 0 }).offers.availability, "https://schema.org/OutOfStock");
  assert.equal(seo.productJsonLd({ ...product, verifiedRating: { ...verifiedRating, average: 9 } }).aggregateRating, undefined);
  assert.equal(seo.productJsonLd({ ...product, verifiedRating: { ...verifiedRating, count: 0 } }).aggregateRating, undefined);
  // The stored products.rating can be typed by hand or come from generated
  // reviews - without a verified summary, no rating is published.
  assert.equal(seo.productJsonLd({ ...product, verifiedRating: undefined }).aggregateRating, undefined);
  assert.equal(seo.productJsonLd({ ...product, price: NaN }).offers, undefined);
  assert.equal(seo.productJsonLd({ ...product, imgSrc: "javascript:alert(1)", hoverImgSrc: undefined }).image, undefined);
  assert.equal(data.offers.shippingDetails, undefined, "do not invent destinations or delivery timelines");
});

test("breadcrumbs are absolute and JSON-LD cannot close its script element", () => {
  const data = seo.breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }]);
  assert.equal(data.itemListElement[1].position, 2);
  assert.equal(data.itemListElement[1].item, "https://shop.avokarto.com/shop");
  const serialized = seo.jsonLdString({ name: "</script><script>alert(1)</script>" });
  assert.equal(serialized.includes("<"), false);
  assert.equal(JSON.parse(serialized).name, "</script><script>alert(1)</script>");
});

const domainLookups = [];
const { proxy } = load("proxy.ts", {
  jose: { jwtVerify: async () => ({ payload: { role: "admin" } }) },
  "next/server": { NextResponse }, "@/lib/seoRoutes": routes,
  // One verified seller domain; every other host is "not a store".
  "@/lib/backend/store-domains": { resolveStoreDomain: async (host) => { domainLookups.push(host); return host === "shop.mybrand.com" ? "meeras" : null; } },
  "@/lib/storeDomainHeader": { STORE_DOMAIN_HEADER: "x-avokarto-store-domain" },
}, env);

test("response headers protect private, facet, preview, and unapproved pages", async () => {
  for (const path of ["/cart", "/checkout-payment", "/privacy-policy", "/shop?q=cat", "/unknown"]) {
    const response = await proxy(new NextRequest(`https://shop.avokarto.com${path}`));
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  }
  const production = await proxy(new NextRequest("https://shop.avokarto.com/shop?utm_source=test"));
  assert.equal(production.headers.get("X-Robots-Tag"), null);
  const preview = await proxy(new NextRequest("https://temporary.host.com/shop"));
  assert.match(preview.headers.get("X-Robots-Tag"), /noindex/);
  for (const path of ["/pricing", "/guides", "/guides/how-to-start-dropshipping", "/category/pets?page=2", "/shop?page=2"]) {
    assert.equal((await proxy(new NextRequest(`https://shop.avokarto.com${path}`))).headers.get("X-Robots-Tag"), null, path);
  }
  assert.match((await proxy(new NextRequest("https://shop.avokarto.com/category/pets?sort=price"))).headers.get("X-Robots-Tag"), /noindex/);
});

test("the www host alias permanently consolidates to the configured origin and preserves the URL", async () => {
  const response = await proxy(new NextRequest("https://www.shop.avokarto.com/shop?page=2&utm_source=mail"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://shop.avokarto.com/shop?page=2&utm_source=mail");
  const forwarded = await proxy(new NextRequest("http://internal.host/shop", { headers: { "x-forwarded-host": "shop.avokarto.com" } }));
  assert.equal(forwarded.headers.get("X-Robots-Tag"), null, "trusted proxy host drives canonical host checks");
});

test("custom-domain crawl files never advertise the platform sitemap", async () => {
  const robots = await proxy(new NextRequest("https://shop.mybrand.com/robots.txt"));
  assert.equal(robots.status, 200);
  assert.doesNotMatch(await robots.text(), /Sitemap:/);
  const sitemap = await proxy(new NextRequest("https://shop.mybrand.com/sitemap.xml"));
  assert.equal(sitemap.status, 200);
  assert.doesNotMatch(await sitemap.text(), /<loc>/);
  const guide = await proxy(new NextRequest("https://shop.mybrand.com/guides"));
  assert.equal(guide.headers.get("location"), "https://shop.avokarto.com/guides");
});

test("legacy product and homepage URLs redirect to their canonical counterparts", async () => {
  for (const [path, canonical] of [["/home-fashion", "/marketplace"], ["/product-single-default/cowboy-cat-shirt", "/product/cowboy-cat-shirt"]]) {
    const response = await proxy(new NextRequest(`https://shop.avokarto.com${path}`));
    assert.equal(response.status, 308);
    assert.equal(new URL(response.headers.get("location")).pathname, canonical);
  }
  const admin = await proxy(new NextRequest("https://shop.avokarto.com/admin"));
  assert.equal(admin.status, 307);
  assert.equal(new URL(admin.headers.get("location")).pathname, "/admin/signin");
});

test("a verified custom domain serves its store and sends everything else to Avokarto", async () => {
  const at = (path, headers = {}) => proxy(new NextRequest(`https://shop.mybrand.com${path}`, { headers: { host: "shop.mybrand.com", ...headers } }));

  const home = await at("/");
  assert.equal(new URL(home.headers.get("x-middleware-rewrite")).pathname, "/store/meeras");
  const product = await at("/cosy-hoodie");
  assert.equal(new URL(product.headers.get("x-middleware-rewrite")).pathname, "/store/meeras/cosy-hoodie");

  const old = await at("/store/meeras/cosy-hoodie");
  assert.equal(old.status, 308);
  assert.equal(new URL(old.headers.get("location"), "https://shop.mybrand.com").pathname, "/cosy-hoodie");

  // Admin, accounts, the main shop and other stores live on Avokarto - absolute, so no loop on the seller's domain.
  for (const path of ["/admin", "/account-info", "/shop", "/store/someone-else"]) {
    const response = await at(path);
    assert.equal(response.status, 307, path);
    assert.equal(response.headers.get("location"), `https://shop.avokarto.com${path}`, path);
  }

  // Cart and checkout run on the store's domain, where its cart lives - as the store's own pages.
  for (const path of ["/cart", "/checkout", "/checkout/complete"]) {
    const response = await at(path);
    assert.equal(new URL(response.headers.get("x-middleware-rewrite")).pathname, `/store/meeras${path}`, path);
    assert.equal(response.headers.get("location"), null, path);
  }
  // Avokarto's multi-step checkout URLs move to the store's, on the same domain (thank-you keeps its order).
  const legacy = await at("/checkout-shipping");
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get("location"), "https://shop.mybrand.com/checkout");
  const thanks = await at("/checkout-thankyou?order=AVO-1-ABC");
  assert.equal(thanks.headers.get("location"), "https://shop.mybrand.com/checkout/complete?order=AVO-1-ABC");
});

test("Avokarto's own host skips the domain lookup and can't spoof the store-domain header", async () => {
  domainLookups.length = 0;
  const response = await proxy(new NextRequest("https://shop.avokarto.com/store/meeras", { headers: { host: "shop.avokarto.com", "x-avokarto-store-domain": "meeras" } }));
  assert.equal(domainLookups.length, 0);
  assert.equal(response.headers.get("x-middleware-override-headers")?.includes("x-avokarto-store-domain") ?? false, false);
  assert.match(response.headers.get("x-middleware-request-x-avokarto-store-domain") ?? "absent", /absent/);
});

test("GTINs need a valid GS1 check digit and map to the right schema.org property", () => {
  for (const [value, property] of [["4006381333931", "gtin13"], ["036000291452", "gtin12"], ["96385074", "gtin8"], ["10614141000415", "gtin14"], ["978-0-306-40615-7", "gtin13"]]) {
    assert.equal(fields.isValidGtin(value), true, value);
    assert.equal(fields.gtinProperty(value), property, value);
  }
  for (const value of ["4006381333932", "12345", "abcdefghijklm", "", "123456789"]) {
    assert.equal(fields.isValidGtin(value), false, value);
  }
});

test("handles, keywords, and alt text are normalised consistently", () => {
  assert.equal(fields.slugifyHandle("  Cozy Café Hoodie & Carrier!! "), "cozy-cafe-hoodie-and-carrier");
  assert.equal(fields.slugifyHandle("x".repeat(200)).length, fields.SEO_SLUG_MAX);
  assert.deepEqual([...fields.parseKeywords("cat carrier, Cat Carrier , ,dog bag")], ["cat carrier", "dog bag"]);
  assert.deepEqual({ ...fields.parseImageAlts('{"/a.webp":"  A cat ","/b.webp":"","/c.webp":5,"/gone.webp":"x"}', ["/a.webp", "/b.webp", "/c.webp"]) }, { "/a.webp": "A cat" });
  assert.deepEqual({ ...fields.parseImageAlts("not json") }, {});
  assert.deepEqual({ ...fields.parseImageAlts(["/a.webp"]) }, {});
});

test("SEO tab overrides drive titles, descriptions, keywords, robots, and social images", async () => {
  routeProduct = {
    ...product,
    seoTitle: "Cowboy Cat Shirt for Cats",
    seoDescription: "<p>A western shirt for cats.</p>",
    seoKeywords: ["cat shirt", "cowboy cat"],
    imageAlts: { "/api/uploads/cat.webp": "Orange cat in a cowboy shirt" },
    variants: [{ src: "/api/uploads/cat.webp" }, { src: "/api/uploads/cat-back.webp" }],
    brand: "Avokarto Pets",
  };
  const metadata = await seo.productMetadata("cowboy-cat-shirt");
  assert.equal(metadata.title, "Cowboy Cat Shirt for Cats");
  assert.equal(metadata.openGraph.title, "Cowboy Cat Shirt for Cats | Avokarto");
  assert.equal(metadata.description, "A western shirt for cats.");
  assert.deepEqual([...metadata.keywords], ["cat shirt", "cowboy cat"]);
  assert.equal(metadata.robots.index, true);
  assert.equal(metadata.openGraph.images.length, 2);
  assert.equal(metadata.openGraph.images[0].alt, "Orange cat in a cowboy shirt");
  assert.equal(metadata.openGraph.images[1].alt, "Cowboy Cat Shirt – view 2");
  const ogTags = Object.fromEntries(seo.productOpenGraphTags(routeProduct));
  assert.equal(ogTags["product:price:amount"], "49.99");
  assert.equal(ogTags["product:availability"], "in stock");
  assert.equal(ogTags["product:brand"], "Avokarto Pets");
  assert.equal(seo.productOpenGraphTags({ ...product, price: NaN }).length, 0);

  routeProduct = { ...product, seoTitle: "Cowboy Cat Shirt – Avokarto", seoNoindex: true };
  const branded = await seo.productMetadata("cowboy-cat-shirt");
  assert.equal(branded.title.absolute, "Cowboy Cat Shirt – Avokarto", "no duplicated store suffix");
  assert.equal(branded.robots.index, false);
  routeProduct = product;
});

test("product JSON-LD lists the gallery, identifiers, sale price, and verified reviews", () => {
  const data = seo.productJsonLd({
    ...product,
    oldPrice: 59.99,
    gtin: "4006381333931",
    mpn: "CC-01",
    variants: [{ src: "/api/uploads/cat.webp" }, { src: "/api/uploads/cat-2.webp" }, { src: "javascript:alert(1)" }],
  });
  assert.deepEqual([...data.image], ["https://shop.avokarto.com/api/uploads/cat.webp", "https://shop.avokarto.com/api/uploads/cat-2.webp"]);
  assert.equal(data.gtin13, "4006381333931");
  assert.equal(data.mpn, "CC-01");
  assert.equal(data.offers.priceSpecification.priceType, "https://schema.org/StrikethroughPrice");
  assert.equal(data.offers.priceSpecification.price, "59.99");
  assert.equal(data.aggregateRating.ratingValue, "4.5");
  assert.equal(data.review[0].reviewBody, "Great fit");
  assert.equal(data.review[0].author.name, "Mila R.");
  assert.equal(seo.productJsonLd({ ...product, oldPrice: 40 }).offers.priceSpecification, undefined, "no fake 'was' price");
  assert.equal(seo.productJsonLd({ ...product, gtin: "4006381333932" }).gtin13, undefined, "invalid GTINs are dropped");
  assert.equal(seo.productJsonLd({ ...product, oldPrice: 59.99 }).offers.hasMerchantReturnPolicy, undefined, "no invented return policy");
});

test("renamed products resolve their retired URL handle to the current page", async () => {
  assert.equal(await seo.getRouteProductRedirect("old-cowboy"), "/product/cowboy-cat-shirt");
  assert.equal(await seo.getRouteProductRedirect("never-existed"), null);
});

test("collection schema describes only the current page and keeps absolute product URLs and positions", () => {
  const data = seo.collectionJsonLd({ name: "Pet costumes", description: "Browse costumes.", path: "/category/pets?page=2", products: [product], offset: 24 });
  assert.equal(data.url, "https://shop.avokarto.com/category/pets?page=2");
  assert.equal(data.mainEntity.numberOfItems, 1);
  assert.equal(data.mainEntity.itemListElement[0].position, 25);
  assert.equal(data.mainEntity.itemListElement[0].url, "https://shop.avokarto.com/product/cowboy-cat-shirt");
});

test("landing FAQ structured data and subscription offers come from the same visible content and plan prices", () => {
  const plans = load("lib/billing/plans.ts", {}, env);
  const faq = load("lib/seller-faq.ts", { "@/lib/billing/plans": plans }, env);
  const platform = load("lib/seo-platform.ts", { "@/lib/billing/plans": plans, "@/lib/seller-faq": faq, "@/lib/seo": seo }, env);
  const settings = { maxMarginPercent: 40, platformFeePercent: 10, holdDays: 14, minPayout: 50 };
  const graph = platform.landingJsonLd({ settings });
  const schemaFaq = graph["@graph"].find((entry) => entry["@type"] === "FAQPage");
  const actual = schemaFaq.mainEntity.map((question) => [question.name, question.acceptedAnswer.text]);
  assert.equal(JSON.stringify(actual), JSON.stringify(faq.sellerFaqs(settings)));
  const application = graph["@graph"].find((entry) => entry["@type"] === "WebApplication");
  // Each plan offers monthly then yearly billing, at the listed prices.
  assert.deepEqual([...application.offers.map((offer) => Number(offer.price))], [...plans.PLAN_KEYS.flatMap((key) => [plans.PLANS[key].price, plans.PLANS[key].yearlyPrice])]);
  assert.deepEqual([...new Set(application.offers.map((offer) => offer.priceSpecification.billingDuration))], ["P1M", "P1Y"]);
  assert.equal(application.aggregateRating, undefined, "no invented software reviews");
  assert.match(actual.flat().join(" "), /7-day free trial/);
  assert.doesNotMatch(actual.flat().join(" "), /no subscription|guaranteed income/i);
});
