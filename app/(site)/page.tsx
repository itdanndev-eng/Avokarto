import type { Metadata } from "next";
import SellLanding from "@/components/seller/SellLanding";
import { getSellLandingData } from "@/lib/backend/sell-landing";
import { jsonLdString, pageMetadata, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/seo";
import { landingJsonLd } from "@/lib/seo-platform";

// Signed-in state is client-side, so the page is served from the cache and
// rebuilt in the background at most every 5 minutes, matching getSellLandingData.
export const revalidate = 300;

const TITLE = SITE_TAGLINE;

export const metadata: Metadata = {
  ...pageMetadata({
    title: TITLE,
    description: SITE_DESCRIPTION,
    path: "/",
  }),
  // The homepage leads with the brand, so it opts out of the title template.
  title: { absolute: `${SITE_NAME} | ${TITLE}` },
};

export default async function Home() {
  const data = await getSellLandingData();
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(landingJsonLd(data)) }} />
    <SellLanding data={data} />
  </>;
}
