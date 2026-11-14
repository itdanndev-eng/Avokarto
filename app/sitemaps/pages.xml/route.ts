import { siteUrl } from "@/lib/seo";
import { INDEXABLE_STATIC_PATHS, isSiteIndexable } from "@/lib/seoRoutes";
import { SELLER_GUIDES } from "@/lib/seo-guides";
import { serveSitemap, sitemapUrlset } from "@/lib/seo-sitemaps";

export const dynamic = "force-dynamic";

// Actual content edits, never the request/build date. Undated pages stay undated.
const PAGE_LAST_MODIFIED: Partial<Record<(typeof INDEXABLE_STATIC_PATHS)[number], string>> = {
  "/": "2026-11-14",
  "/about": "2026-11-14",
};

export function GET() {
  return serveSitemap(isSiteIndexable(), () => sitemapUrlset([
    ...INDEXABLE_STATIC_PATHS.map((path) => ({
      url: `${siteUrl()}${path === "/" ? "" : path}`,
      lastModified: PAGE_LAST_MODIFIED[path],
    })),
    ...SELLER_GUIDES.map((guide) => ({ url: `${siteUrl()}/guides/${guide.slug}`, lastModified: guide.updated })),
  ]));
}
