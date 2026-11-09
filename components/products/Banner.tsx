"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo } from "react";
import { useCurrency } from "@/lib/currency";
import { useLiveProducts } from "@/hooks/use-live-products";
import type { Product } from "@/types/product";

// Pass the first catalog page the server already loaded so the banner renders
// with the page instead of appearing later and pushing the shop down.
export default function Banner({ containerFull = false, initialProducts }: { containerFull?: boolean; initialProducts?: Product[] }) {
  const { formatPrice } = useCurrency();
  const { products, hasData } = useLiveProducts({ limit: 24, initialProducts });

  // Lead with a real on-sale product when one exists (the natural "banner"
  // moment), otherwise fall back to whatever is first in the live catalog -
  // never a static demo product with a fabricated headline.
  const bannerProduct = useMemo(() => {
    if (!products.length) return null;
    return (
      products.find(
        (product) => product.oldPrice != null && product.oldPrice > product.price,
      ) ?? products[0]
    );
  }, [products]);

  if (!hasData || !bannerProduct) return null;

  const detailsHref = `/product/${bannerProduct.slug ?? bannerProduct.id}`;

  return (
    <div className="rbt-component-area rbt-page-banner-content">
      <div
        className={`${containerFull ? "rbt-full-width-wrapper" : "container"}`}
      >
        <div className="row">
          <div className="col-lg-12">
            <div className="rbt-component-banner radius-8 rbt-scroll-trigger fade_in animation-order-1">
              <div className="mega-top-banner bg-three">
                <div className="rbt-banner-inner w-100">
                  <div className="rbt-banner-content">
                    <h5 className="title">{bannerProduct.title}</h5>
                    {bannerProduct.shortSummary ? (
                      <p className="b3 desc">{bannerProduct.shortSummary}</p>
                    ) : null}
                  </div>
                  <div className="pricing-action d-flex align-items-center rbt-gap--8">
                    <div className="rbt-pricing-part d-flex">
                      <span className="rbt-price-text offer-price">
                        {formatPrice(bannerProduct.price)}
                      </span>
                      {bannerProduct.oldPrice ? (
                        <del className="rbt-dis-price-text">
                          {formatPrice(bannerProduct.oldPrice)}
                        </del>
                      ) : null}
                    </div>
                    <Link
                      className="rbt-btn rbt-btn-sm rbt-btn-black"
                      href={detailsHref}
                    >
                      View Details
                    </Link>
                  </div>
                  <Link
                    href={detailsHref}
                    className="product-img position-bottom"
                  >
                    <Image
                      alt={bannerProduct.title}
                      src={bannerProduct.imgSrc}
                      width={278}
                      height={280}
                    />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
