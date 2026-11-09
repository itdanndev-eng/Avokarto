/* eslint-disable @typescript-eslint/no-require-imports -- Next loads PostCSS plugins with require(). */
// Drops the template rules no page uses from the site's global stylesheet
// (public/assets/scss/main.scss), which otherwise ships ~1.2 MB of CSS that
// blocks the first paint on every page. CSS modules, the admin stylesheet and
// the blocks marked `purgecss start ignore` in main.scss (Bootstrap, icons)
// are left untouched.
//
// A rule is kept when every class in its selector appears somewhere in the
// source. Classes that only exist at runtime - added by a library or built
// from a template string - must be listed in `safelist` below; if a style
// goes missing after adding such a class, add its name or prefix here.
const path = require("node:path");
const purgecss = require("@fullhuman/postcss-purgecss");

const root = path.resolve(__dirname, "..");
const target = path.join("public", "assets", "scss", "main.scss");

const purge = (purgecss.default ?? purgecss)({
  content: [
    "{app,components,lib,hooks,context,data,admin,types}/**/*.{ts,tsx,js,jsx,mjs,json,md,mdx,html}",
    "database/**/*.sql",
  ].map((glob) => path.join(root, glob)),
  // Keep @font-face, @keyframes and custom properties; they are cheap and
  // referenced indirectly.
  fontFace: false,
  keyframes: false,
  variables: false,
  safelist: {
    standard: [
      // Bootstrap and template scripts toggle these.
      "show", "showing", "hiding", "collapse", "collapsing", "fade", "active", "open", "sticky",
      "modal-open", "modal-backdrop", "offcanvas-backdrop", "disabled", "selected", "checked",
      // Scroll-reveal steps built as `animation-order-${index + 1}`.
      /^animation-order-/,
      // Password strength tones built as `is-${label}`, and other is-/has- state flags.
      /^is-/, /^has-/,
      // Classes added by third-party components at runtime.
      /^swiper/, /^lg-/, /^rc-slider/, /^drift-/, /^odometer/, /^cloudimage/, /^ci-/,
      /^tooltip/, /^popover/, /^bs-/,
      // Product-switcher and badge variants chosen from data.
      /^rbt-switcher--/, /^rbt-badge-/,
    ],
    deep: [/^swiper/, /^lg-/, /^rc-slider/],
    greedy: [/swiper/, /lg-/],
  },
});

module.exports = () => ({
  postcssPlugin: "purge-template-css",
  async OnceExit(css, helpers) {
    const file = css.source?.input?.file ?? "";
    if (!file.endsWith(target)) return;
    await purge.OnceExit(css, helpers);
  },
});
module.exports.postcss = true;
