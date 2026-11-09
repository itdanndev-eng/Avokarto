import Banner from "@/components/products/Banner";
import { pageMetadata } from "@/lib/seo";
import Breadcrumb from "@/components/products/Breadcrumb";
import Categories from "@/components/products/Categories";
import LiveShopDefault from "@/components/products/LiveShopDefault";

import { Metadata } from "next";
import { getCatalogCategories, getCatalogWindow } from "@/lib/backend/catalog-seo";
import { breadcrumbJsonLd, jsonLdString } from "@/lib/seo";

// Served from cache and rebuilt in the background; the product grid refreshes live in the browser.
export const revalidate = 120;

export const metadata: Metadata = pageMetadata({
  title: "Shop by Category",
  description:
    "Browse Avokarto by category: pet costumes, carriers, care essentials, and playful seasonal finds for cats, dogs, and your home.",
  path: "/shop-by-categories",
});

export default async function page() {
  const [categories, window] = await Promise.all([getCatalogCategories(), getCatalogWindow(1)]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Categories", path: "/shop-by-categories" }])) }} />
      <Breadcrumb title="Shop By Categories" />
      <div className="container mt--24">
        <h1 className="h2 mb--12">Shop by category</h1>
        <p>Explore pet accessories, costumes, gadgets, and novelty finds.</p>
      </div>
      <Banner initialProducts={window?.products} />
      <Categories initialCategories={categories} showCounts />
      <div className="rbt-component-area ptb--32 ptb_sm--12">
        <div className="container">
          <div className="rbt-separator rbt-separator-gray200" />
        </div>
      </div>
      <LiveShopDefault column={3} detailsPageUrl="/product" initialProducts={window?.products} />
    </>
  );
}
