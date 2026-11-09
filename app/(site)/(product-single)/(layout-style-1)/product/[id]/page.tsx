import Footer10 from "@/components/footers/Footer10";

import BottomStickyProduct from "@/components/product-details/others/BottomStickyProduct";
import FrequentlyBoughtTogether from "@/components/product-details/others/FrequentlyBoughtTogether";

import DetailsFashion from "@/components/product-details/details/DetailsFashion";

import Description2 from "@/components/product-details/descriptions/Description2";
import FashionProductDeferredSections from "@/components/product-details/FashionProductDeferredSections";
import ProductNavigationFallback from "@/components/product-details/ProductNavigationFallback";
import {
  apparelCompareProducts,
  recentlyViewed4,
  recommendedProducts4,
  singleStyleProducts2,
} from "@/data/products/others";
import {
  allFashionProducts,
  fashionShopProducts,
} from "@/data/products/fashion";
import { allProducts } from "@/data/products";
import BreadCrumb from "@/components/product-details/BreadCrumb";
import {
  createProductLookup,
  getProductByRouteId,
} from "@/lib/productRouteStatic";
import { hasDatabaseConfig } from "@/lib/backend/db";
import {
  generateProductRouteMetadata,
  breadcrumbJsonLd,
  getRouteProduct,
  getRouteProductRedirect,
  jsonLdString,
  productJsonLd,
  productOpenGraphTags,
  productPath,
} from "@/lib/seo";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import ProductSellers from "@/components/sellers/ProductSellers";
import type { Product } from "@/types";
import { categoryShopHref } from "@/lib/storefront-categories";

const fashionDetailProducts = [
  ...allFashionProducts,
  ...fashionShopProducts,
  ...singleStyleProducts2,
  ...apparelCompareProducts,
  ...recentlyViewed4,
  ...recommendedProducts4,
];
const fashionProductsById = createProductLookup(fashionDetailProducts);

// /product is the single, universal product details route (it replaced the
// old /product-single-default page). In template-preview mode (no database)
// any demo product id from any catalog must resolve here, not just fashion
// ones. createProductLookup lets later entries win, so the list is reversed
// to make the *first* match win: fashion entries (richer fashion-specific
// data) take precedence, then catalog order - same as the old route's
// first-match lookup.
const previewProductsById = createProductLookup(
  [...fashionDetailProducts, ...allProducts].reverse(),
);

// Built on first visit, then served from cache and rebuilt in the background
// at most once a minute. Price and stock refresh live in the browser
// (useLiveProduct), so a cached page never sells at a stale price.
export const revalidate = 60;

// No pages are built ahead of time; returning a list (even empty) is what
// lets each product page be cached after its first visit.
export async function generateStaticParams() {
  return [];
}

// Per-product title, description, social image, and canonical URL.
export async function generateMetadata({ params }: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (hasDatabaseConfig()) {
    let product: Product | null;
    try {
      product = await getRouteProduct(id);
    } catch {
      // The shared metadata helper returns a non-indexable retry state.
      return generateProductRouteMetadata({ params });
    }
    if (!product) await redirectRetiredSlug(id);
    if (!product) notFound();
    if (product.slug && id !== product.slug) permanentRedirect(productPath(product));
  }
  return generateProductRouteMetadata({ params });
}

// A renamed product's old URL handle 308s to its current page, so links and
// search rankings pointing at the old address keep working.
async function redirectRetiredSlug(id: string) {
  let target: string | null = null;
  try {
    target = await getRouteProductRedirect(id);
  } catch {
    // Redirect lookup is best-effort; fall through to the normal 404.
  }
  if (target) permanentRedirect(target);
}

function ProductPageContent({ product }: { product: Product }) {
  const breadcrumbProducts =
    fashionProductsById.get(String(product.id))
      ? fashionDetailProducts
      : [
          product,
          ...fashionDetailProducts.filter(
            (item) => String(item.id) !== String(product.id),
          ),
        ];

  return (
    <>
      {productOpenGraphTags(product).map(([property, content]) => (
        <meta key={property} property={property} content={content} />
      ))}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString({
            "@context": "https://schema.org",
            "@graph": [
              productJsonLd(product),
              breadcrumbJsonLd([
                { name: "Home", path: "/" },
                { name: "Products", path: "/shop" },
                ...(product.category?.[0] ? [{
                  name: product.category[0],
                  path: categoryShopHref(product.category[0], product.categorySlug),
                }] : []),
                { name: product.title, path: productPath(product) },
              ]),
            ],
          }),
        }}
      />
      <BreadCrumb
        product={product}
        products={breadcrumbProducts}
        detailsPageUrl="/product"
      />
      <DetailsFashion product={product} />
      {/* Avokarto's offer plus the independent sellers carrying this product,
          linked to their profiles and themed stores. Streams in after the
          details so it never delays the product itself. */}
      <Suspense fallback={null}>
        <ProductSellers price={product.price} productId={product.catalogId} productSlug={product.slug} />
      </Suspense>
      {/* Ranked, stock-aware bundle builder anchored on this product. */}
      <FrequentlyBoughtTogether product={product} />
      <Description2 product={product} />
      <FashionProductDeferredSections product={product} />
      <BottomStickyProduct
        product={product}
        detailsPageUrl="/product"
      />

      <Footer10 />
    </>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A configured database is the real catalog - once it's reachable, a
  // missing id is a real 404, never a silent swap to the static demo
  // catalog (that previously let URLs like /product/793 - a fake id that
  // only exists in data/products/others.ts - render a completely fake
  // "Green Stripe Relaxed Fit Shirt Dress" product page as if it were
  // real). The static catalog is only a legitimate stand-in when there's
  // no database configured at all (local template preview).
  if (!hasDatabaseConfig()) {
    const staticProduct = getProductByRouteId(previewProductsById, id);
    if (!staticProduct) notFound();
    return <ProductPageContent product={staticProduct} />;
  }

  let liveProduct: Product | null = null;
  let lookupFailed = false;
  try {
    // Shared with generateMetadata - one database read per request.
    liveProduct = await getRouteProduct(id);
  } catch (error) {
    lookupFailed = true;
    console.error("Unable to load live product detail.", error);
  }

  // A transient DB failure is not "this product doesn't exist" - surface
  // the retry UI instead of guessing with static demo content.
  if (lookupFailed) {
    return <ProductNavigationFallback routeId={id} complete unavailable />;
  }

  if (!liveProduct) await redirectRetiredSlug(id);
  if (!liveProduct) notFound();
  if (liveProduct.slug && id !== liveProduct.slug) {
    permanentRedirect(productPath(liveProduct));
  }

  return <ProductPageContent product={liveProduct} />;
}
