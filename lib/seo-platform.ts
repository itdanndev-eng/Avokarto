import { PLAN_KEYS, PLANS } from "@/lib/billing/plans";
import { sellerFaqs } from "@/lib/seller-faq";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/seo";
import type { SellLandingData } from "@/lib/backend/sell-landing";

export function platformApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${siteUrl()}/#application`,
    name: SITE_NAME,
    url: siteUrl(),
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web browser",
    browserRequirements: "Requires JavaScript and an internet connection",
    provider: { "@id": `${siteUrl()}/#organization` },
    featureList: ["Branded dropshipping stores", "Product catalog", "Store themes", "Product reels and video studio", "Order fulfilment", "Seller dashboard"],
    // Monthly and yearly billing for every plan.
    offers: PLAN_KEYS.flatMap((key) => ([
      { label: "", amount: PLANS[key].price, unitText: "month", billingDuration: "P1M" },
      { label: " (yearly)", amount: PLANS[key].yearlyPrice, unitText: "year", billingDuration: "P1Y" },
    ]).map((period) => ({
      "@type": "Offer",
      name: `${PLANS[key].name}${period.label}`,
      url: `${siteUrl()}/pricing#${key}`,
      price: period.amount.toFixed(2),
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: period.amount.toFixed(2),
        priceCurrency: "USD",
        unitText: period.unitText,
        billingDuration: period.billingDuration,
      },
    }))),
  };
}

export function landingJsonLd(data: SellLandingData) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${siteUrl()}/#webpage`,
        url: siteUrl(),
        name: `${SITE_NAME} Dropshipping Store Builder`,
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": `${siteUrl()}/#website` },
        mainEntity: { "@id": `${siteUrl()}/#application` },
      },
      platformApplicationJsonLd(),
      {
        "@type": "FAQPage",
        "@id": `${siteUrl()}/#faq`,
        mainEntity: sellerFaqs(data.settings).map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };
}
