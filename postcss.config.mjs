import path from "node:path";

// Unused template CSS is trimmed only in production builds (see
// scripts/postcss-purge-template.cjs); `next dev` keeps the full stylesheet.
// The plugin is referenced by absolute path: Turbopack (dev) resolves plugin
// names from its own build directory, not the project root.
const purgeTemplateCss = path.join(process.cwd(), "scripts", "postcss-purge-template.cjs");

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    ...(process.env.NODE_ENV === "production" ? { [purgeTemplateCss]: {} } : {}),
  },
};

export default config;
