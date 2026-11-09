import Breadcrumb from "@/components/other-pages/Breadcrumb";
import { pageMetadata } from "@/lib/seo";
import Contact from "@/components/other-pages/contact/Contact";
import ContactMap from "@/components/other-pages/contact/ContactMap";
import { getPublicStoreSettings } from "@/lib/backend/storefront-data";

import { Metadata } from "next";

export const metadata: Metadata = pageMetadata({
  title: "Contact Us",
  description:
    "Questions about an order, sizing, shipping, or returns? Get in touch with the Avokarto support team by email or phone. We're happy to help.",
  path: "/contact",
});

// Store contact details rarely change; serve from cache, refresh every 5 minutes.
export const revalidate = 300;

export default async function page() {
  const settings = await getPublicStoreSettings();

  return (
    <>
      <Breadcrumb />
      <Contact settings={settings} />
      <ContactMap address={settings.address} />
    </>
  );
}
