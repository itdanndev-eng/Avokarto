import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Store, Truck, Users } from "lucide-react";
import { SellerCard } from "@/components/sellers/SellerBits";
import SellerDirectoryControls from "@/components/sellers/SellerDirectoryControls";
import styles from "@/components/sellers/sellers.module.css";
import { hasDatabaseConfig } from "@/lib/backend/db";
import { listSellers, SELLER_SORTS, type SellerSort } from "@/lib/backend/seller-profiles";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Sellers",
  description: "Discover independent sellers on Avokarto - follow their profiles and shop their own themed stores, with Avokarto delivery.",
  path: "/sellers",
});

const PER_PAGE = 24;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function SellersPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = one(params.q).slice(0, 60);
  const sort = (SELLER_SORTS as string[]).includes(one(params.sort)) ? (one(params.sort) as SellerSort) : "popular";
  const page = Math.max(1, Math.min(500, Number.parseInt(one(params.page), 10) || 1));

  let result: Awaited<ReturnType<typeof listSellers>> = { sellers: [], total: 0 };
  let failed = false;
  if (hasDatabaseConfig()) {
    try {
      result = await listSellers({ page, perPage: PER_PAGE, q, sort });
    } catch (error) {
      failed = true;
      console.error("Unable to load sellers.", error);
    }
  }
  const pages = Math.ceil(result.total / PER_PAGE);
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (sort !== "popular") next.set("sort", sort);
    if (target > 1) next.set("page", String(target));
    return next.size ? `/sellers?${next}` : "/sellers";
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <section className={styles.dirHero}>
          <div className={styles.dirHeroText}>
            <p className={styles.eyebrow}><Users aria-hidden="true" size={14} /> Avokarto sellers</p>
            <h1>Shop from independent sellers</h1>
            <p>
              Follow the curators you love. Every seller runs their own themed store, while
              Avokarto packs, ships and protects every order.
            </p>
            <ul className={styles.dirPerks}>
              <li><Store aria-hidden="true" size={16} /> Their own store &amp; style</li>
              <li><Truck aria-hidden="true" size={16} /> Avokarto delivery &amp; returns</li>
            </ul>
          </div>
          <Link className={styles.dirHeroCta} href="/">
            <span>Become a seller</span>
            <small>Open a free store in minutes</small>
            <ArrowRight aria-hidden="true" size={20} />
          </Link>
        </section>

        <SellerDirectoryControls q={q} sort={sort} />

        <p aria-live="polite" className={styles.resultCount}>
          {failed
            ? "Sellers couldn't be loaded right now. Please try again shortly."
            : q
              ? `${result.total} ${result.total === 1 ? "seller" : "sellers"} matching "${q}"`
              : `${result.total} ${result.total === 1 ? "seller" : "sellers"}`}
        </p>

        {result.sellers.length ? (
          <div className={styles.cardGrid}>
            {result.sellers.map((seller) => <SellerCard key={seller.id} seller={seller} />)}
          </div>
        ) : !failed ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Users aria-hidden="true" size={26} /></span>
            <h3>{q ? "No sellers match that search" : "No sellers yet"}</h3>
            <p>{q ? "Try a shorter name or another niche." : "Be the first - open your own store on Avokarto."}</p>
            <Link className={styles.btnPrimary} href={q ? "/sellers" : "/"}>{q ? "Clear search" : "Open a store"}</Link>
          </div>
        ) : null}

        {pages > 1 ? (
          <nav aria-label="Seller pages" className={styles.pager}>
            {page > 1 ? <Link href={pageHref(page - 1)} rel="prev">← Previous</Link> : <span />}
            <span>Page {page} of {pages}</span>
            {page < pages ? <Link href={pageHref(page + 1)} rel="next">Next →</Link> : <span />}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
