import Link from "next/link";
import { notFound } from "next/navigation";
import Banner from "@/components/products/Banner";
import Breadcrumb from "@/components/products/Breadcrumb";
import LiveShopDefault from "@/components/products/LiveShopDefault";
import { CatalogPagination, CatalogProductGrid } from "@/components/seo/CatalogNavigation";
import s from "@/components/seo/catalog.module.css";
import { CATALOG_PAGE_SIZE, getCatalogCategories, getCatalogWindow } from "@/lib/backend/catalog-seo";
import { breadcrumbJsonLd, collectionJsonLd, jsonLdString, pageMetadata } from "@/lib/seo";
import { catalogPageNumber, catalogPagePath, isFacetedShopQuery } from "@/lib/seoRoutes";
import { categoryShopHref, normalizeCategoryNames } from "@/lib/storefront-categories";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SearchParams> };
const title = "Shop Pet Costumes, Gadgets & Novelty Finds";
const description = "Browse pet costumes, care essentials, gadgets, and novelty finds. Compare current prices, product details, and available stock at Avokarto.";

async function catalogData(query: SearchParams) {
  const page = catalogPageNumber(query.page);
  if (page === null) notFound();
  const search = (Array.isArray(query.q) ? query.q[0] : query.q)?.trim() ?? "";
  const categories = normalizeCategoryNames(Array.isArray(query.category) ? query.category : [query.category ?? ""]);
  const window = await getCatalogWindow(page, search, JSON.stringify(categories));
  if (page > 1 && !window?.products.length) notFound();
  return { page, search, categories, window };
}

export async function generateMetadata({ searchParams }: Props) {
  const query = await searchParams;
  const { page, window } = await catalogData(query);
  const faceted = isFacetedShopQuery(query);
  return pageMetadata({
    title: `${title}${page > 1 ? ` - Page ${page}` : ""}`,
    description: `${description}${page > 1 ? ` Page ${page}.` : ""}`,
    path: faceted ? "/shop" : catalogPagePath("/shop", page),
    noindex: faceted || !window?.products.length,
  });
}

export default async function ShopPage({ searchParams }: Props) {
  const query = await searchParams;
  const { page, search, categories, window } = await catalogData(query);
  const [allCategories, bannerWindow] = await Promise.all([
    getCatalogCategories(),
    search || categories.length ? getCatalogWindow(1) : window,
  ]);
  const path = catalogPagePath("/shop", page);
  const heading = search ? `Search results for “${search}”` : categories.join(", ") || "Shop pet costumes, gadgets & novelty finds";
  const filters = { ...(search ? { q: search } : {}), ...(categories.length ? { category: categories } : {}) };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({
      "@context": "https://schema.org", "@graph": [
        breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Shop", path: "/shop" }, ...(page > 1 ? [{ name: `Page ${page}`, path }] : [])]),
        collectionJsonLd({ name: heading, description, path, products: window?.products ?? [], offset: (page - 1) * CATALOG_PAGE_SIZE }),
      ],
    }) }} />
    <Breadcrumb title="Shop" />
    <div className="container mb--24">
      <h1 className="h2 mb--8">{heading}{page > 1 ? ` — Page ${page}` : ""}</h1>
      <p className="mb--0">Explore our products, compare details, and find your next favourite.</p>
      <nav aria-label="Product categories" className={s.categories}>{allCategories.filter((category) => category.count > 0).map((category) => <Link key={category.id} href={categoryShopHref(category.name, category.slug)}>{category.name}</Link>)}</nav>
    </div>
    {page === 1 ? <><Banner initialProducts={bannerWindow?.products} /><LiveShopDefault key={JSON.stringify([search, categories])} detailsPageUrl="/product" initialSearch={search} initialProducts={window?.products} defaultFilterCategory={categories} /></> : <div className="container"><CatalogProductGrid products={window?.products ?? []} /></div>}
    <div className="container"><CatalogPagination path="/shop" page={page} hasMore={window?.hasMore ?? false} filters={filters} /></div>
  </>;
}
