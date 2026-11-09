import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Use the CSS parser shipped with Next, including installations that do not
// hoist Next's dependencies into the project's node_modules directory.
const require = createRequire(import.meta.url);
const requireFromNext = createRequire(require.resolve("next/package.json"));
const postcss = requireFromNext("postcss");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorPath = "public/assets/css/plugins/fontawesome-all.min.css";
const outputPath = "public/assets/css/plugins/fontawesome.used.css";
const subsetDir = "public/assets/fonts/subset";
const ignoredDirectories = new Set(["node_modules", "out", "build", "coverage"]);
const sourceExtensions = /\.(?:[cm]?[jt]sx?|json|sql|s?css|html)$/;
const fontFamilies = new Set([
  "fa-brands", "fa-duotone", "fa-light", "fa-regular", "fa-solid", "fa-thin",
]);

// Keep complete icon names in source strings. If an integration ever builds
// names from unbounded external data, import the original stylesheet there or
// list all of its supported names here before using the smaller stylesheet.
const additionalIconClasses = [];

// Glyphs that stylesheets draw straight from the icon font with `content: "\\f078"`.
const stylesheetGlyphs = new Set();

/** Code points written in CSS `content` strings, escapes and literal characters alike. */
function contentCodepoints(value, into) {
  for (const [, , body] of value.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)) {
    for (const match of body.matchAll(/\\([0-9a-fA-F]{1,6})\s?|\\(.)|(.)/gsu)) {
      const codepoint = match[1] ? Number.parseInt(match[1], 16) : (match[2] ?? match[3]).codePointAt(0);
      if (codepoint > 0x20) into.add(codepoint);
    }
  }
}

function collectSourceIcons(directory, icons) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !ignoredDirectories.has(entry.name)) {
        collectSourceIcons(filename, icons);
      }
      continue;
    }
    const relativePath = path.relative(projectRoot, filename).split(path.sep).join("/");
    if (
      !entry.isFile() ||
      !sourceExtensions.test(entry.name) ||
      relativePath === vendorPath ||
      relativePath === outputPath ||
      entry.name.endsWith("-lock.json")
    ) {
      continue;
    }
    const source = readFileSync(filename, "utf8");
    for (const match of source.matchAll(/\bfa-[a-z0-9-]+/g)) {
      icons.add(match[0]);
    }
    if (/\.s?css$/.test(entry.name)) {
      for (const match of source.matchAll(/content\s*:\s*([^;}]+)/g)) contentCodepoints(match[1], stylesheetGlyphs);
    }
  }
}

// Only standalone icon-to-Unicode mappings may be omitted. All font faces,
// animation rules, utility classes, selectors with other declarations, and
// the original font binaries remain intact, including CSS content escapes.
function mappedIconNames(rule) {
  if (
    !rule.nodes?.length ||
    !rule.nodes.every((node) => node.type === "decl" && node.prop === "content")
  ) {
    return [];
  }
  return [...rule.selector.matchAll(/\.(fa-[a-z0-9-]+)/g)]
    .map((match) => match[1])
    .filter((name) => !fontFamilies.has(name));
}

const sourceIcons = new Set(additionalIconClasses);
collectSourceIcons(projectRoot, sourceIcons);
if (sourceIcons.size === 0) throw new Error("No source icon classes found; refusing to generate an empty subset.");

const original = readFileSync(path.join(projectRoot, vendorPath), "utf8");
const stylesheet = postcss.parse(original);
let removedRules = 0;
let retainedMappings = 0;
const expectedMappings = new Set();
stylesheet.walkRules((rule) => {
  const icons = mappedIconNames(rule);
  if (icons.length === 0) return;
  if (icons.some((icon) => sourceIcons.has(icon))) {
    retainedMappings += 1;
    expectedMappings.add(rule.toString());
  } else {
    rule.remove();
    removedRules += 1;
  }
});

// Every glyph the trimmed stylesheet and the site's own styles can draw.
const neededGlyphs = new Set(stylesheetGlyphs);
stylesheet.walkDecls("content", (decl) => contentCodepoints(decl.value, neededGlyphs));
const neededHex = [...neededGlyphs].sort((a, b) => a - b).map((codepoint) => codepoint.toString(16));
if (process.argv.includes("--codepoints")) {
  console.log(neededHex.join("\n"));
  process.exit(0);
}

// Point the stylesheet at the trimmed fonts (npm run icons:fonts) only while
// they hold every glyph in use; otherwise keep the full fonts.
const fontUrls = new Set();
stylesheet.walkAtRules("font-face", (rule) => rule.walkDecls("src", (decl) => {
  for (const [, file] of decl.value.matchAll(/url\(\.\.\/\.\.\/fonts\/([^)]+\.woff2)\)/g)) fontUrls.add(file);
}));
let subsetNote = "full icon fonts";
try {
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, subsetDir, "manifest.json"), "utf8"));
  const covered = new Set(manifest.codepoints);
  const missing = neededHex.filter((hex) => !covered.has(hex));
  const filesPresent = [...fontUrls].every((file) => existsSync(path.join(projectRoot, subsetDir, file)));
  if (!missing.length && filesPresent) {
    stylesheet.walkAtRules("font-face", (rule) => rule.walkDecls("src", (decl) => {
      decl.value = decl.value.replaceAll("url(../../fonts/", "url(../../fonts/subset/");
    }));
    subsetNote = `trimmed icon fonts (${neededHex.length} glyphs)`;
  } else {
    console.warn(
      `Icon fonts: ${missing.length ? `${missing.length} new glyph(s)` : "subset files missing"}; ` +
      "using the full fonts. Run npm run icons:fonts to trim them again.",
    );
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const generated = `/* Generated by scripts/generate-icon-css.mjs. Run npm run icons:generate after adding icons. */\n${stylesheet.toString()}`;
const generatedMappings = new Set();
postcss.parse(generated).walkRules((rule) => {
  if (mappedIconNames(rule).length > 0) generatedMappings.add(rule.toString());
});
for (const mapping of expectedMappings) {
  if (!generatedMappings.has(mapping)) throw new Error("A referenced icon mapping was lost during generation.");
}

const absoluteOutputPath = path.join(projectRoot, outputPath);
let existing;
try {
  existing = readFileSync(absoluteOutputPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (process.argv.includes("--check")) {
  if (existing !== generated) {
    throw new Error("Icon stylesheet is out of date. Run npm run icons:generate.");
  }
} else if (existing !== generated) {
  writeFileSync(absoluteOutputPath, generated);
}

console.log(
  `Icon CSS: ${sourceIcons.size} source classes, ${retainedMappings} mappings retained, ` +
  `${removedRules} unused mappings omitted; ${Buffer.byteLength(original).toLocaleString("en-US")} → ` +
  `${Buffer.byteLength(generated).toLocaleString("en-US")} bytes ` +
  `(gzip ${gzipSync(original).length.toLocaleString("en-US")} → ${gzipSync(generated).length.toLocaleString("en-US")}); ${subsetNote}.`,
);
