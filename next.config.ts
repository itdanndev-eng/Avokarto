import path from "node:path";
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const slimClientPolyfill = path.join(
  process.cwd(),
  "lib/next-client-polyfill-slim.js",
);

const nextConfig: NextConfig = {
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  // Resolve metadata/notFound/slug redirects before response headers. Product
  // metadata shares the page's database read; body content can still stream.
  htmlLimitedBots: /.*/,
  // Local verification runs a `next start` (prod) and `next dev` server side
  // by side against the same checkout. Both default to writing build output
  // into `.next` - `next dev`'s startup clears/rewrites that directory,
  // which corrupts the manifests the concurrently running `next start`
  // process depends on and 500s it. Routing the dev instance to its own
  // directory (opt-in via env var, unset in real deploys) keeps the two
  // fully isolated.
  distDir: process.env.NEXT_DEV_SIDE_INSTANCE === "1" ? ".next-dev" : ".next",
  turbopack: {
    resolveAlias: {
      "next/dist/build/polyfills/polyfill-module": slimClientPolyfill,
      "next/dist/build/polyfills/polyfill-module.js": slimClientPolyfill,
    },
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]next[\\/]dist[\\/]build[\\/]polyfills[\\/]polyfill-module\.js$/,
          slimClientPolyfill,
        ),
      );
    }
    return config;
  },
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
    // Two root layouts (app/(site) and app/admin) - unmatched URLs render
    // app/global-not-found.tsx.
    globalNotFound: true,
    // Optimize package imports for large icon/component libraries (reduces initial JS bundle).
    optimizePackageImports: [
      "swiper",
      "bootstrap",
      "lightgallery",
      "lucide-react",
    ],
  },
  // Image optimization: serve AVIF (smaller) then WebP, tuned device breakpoints.
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 500],
    minimumCacheTTL: 31536000, // 1 year
  },
  // Enable gzip/brotli compression.
  compress: true,
  // Public assets keep stable filenames, so allow replacement after a day.
  // Next's hashed /_next/static assets retain its built-in immutable caching.
  // The template's demo pages were removed from this build; old links land
  // on the live page that replaced them.
  async redirects() {
    return [
      { source: "/product-single-:variant/:id", destination: "/product/:id", permanent: true },
      { source: "/home-fashion", destination: "/marketplace", permanent: true },
      { source: "/splash", destination: "/", permanent: true },
      { source: "/shop-by-category", destination: "/shop-by-categories", permanent: true },
      { source: "/categories-list", destination: "/shop-by-categories", permanent: true },
    ];
  },
  // Older catalog rows point at /uploads/<file>, which only exists where the
  // files sit in public/uploads. Checked after public files, so local disk still
  // wins; anywhere else (S3 storage, serverless hosts) the uploads route serves them.
  async rewrites() {
    return {
      afterFiles: [{ source: "/uploads/:file", destination: "/api/uploads/:file" }],
      beforeFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=()" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      // Uploaded catalog images must remain eligible for image search.
      {
        source: "/api/uploads/:path*",
        headers: [{ key: "X-Robots-Tag", value: "all" }],
      },
      {
        source: "/assets/fonts/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, must-revalidate",
          },
        ],
      },
      {
        source: "/assets/images/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
