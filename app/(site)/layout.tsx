import StorefrontChrome from "@/components/common/other-components/StorefrontChrome";
import type { Metadata, Viewport } from "next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  DEFAULT_SOCIAL_IMAGE,
  jsonLdString,
  publicRobots,
  siteUrl,
} from "@/lib/seo";

import "../../public/assets/scss/main.scss";

export const metadata: Metadata = {
  // Absolute base for canonical URLs and social images.
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    // Pages set just their own name ("Cart", a product title...) and get the
    // brand appended consistently.
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: publicRobots(),
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined,
  },
  manifest: "/site.webmanifest?v=avokarto-logo-20260902-2",
  icons: {
    icon: [
      {
        url: "/favicon.ico?v=avokarto-logo-20260902-2",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        url: "/icon.png?v=avokarto-logo-20260902-2",
        sizes: "512x512",
        type: "image/png",
      },
      {
        url: "/favicon.png?v=avokarto-logo-20260902-2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico?v=avokarto-logo-20260902-2",
    apple: [
      {
        url: "/apple-touch-icon.png?v=avokarto-logo-20260902-2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    images: [DEFAULT_SOCIAL_IMAGE.url],
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
};

// Site-wide organization and website identity. One object with a
// top-level "@context" and an "@graph" (not a bare array): some JSON-LD
// readers - e.g. shopping/price-tracker browser extensions - assume every
// block has "@context" and crash on arrays.
const SAME_AS = (process.env.SITE_SAME_AS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => /^https:\/\/[^\s]+$/.test(url));

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl()}/#organization`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: siteUrl(),
      logo: { "@type": "ImageObject", url: `${siteUrl()}/icon.png`, width: 512, height: 512 },
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "support@avokarto.com", availableLanguage: ["en"] },
      // The brand's own profiles (comma-separated URLs), so search engines tie them to this site.
      ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl()}/#website`,
      name: SITE_NAME,
      // How Google may name the site in results; keeps "Avokarto" apart from look-alike names.
      alternateName: [`${SITE_NAME}.com`],
      url: siteUrl(),
      inLanguage: "en-US",
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${siteUrl()}/#organization` },
    },
  ],
};

export const viewport: Viewport = {
  themeColor: "#174d0a",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="font-vars"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(siteJsonLd) }}
        />
        <StorefrontChrome>{children}</StorefrontChrome>
      </body>
    </html>
  );
}
