// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver...) about every
// URL in the live sitemap, so new and changed pages are crawled within hours
// instead of waiting to be discovered. Google does not use IndexNow - submit
// the sitemap in Search Console for Google.
//
//   npm run seo:indexnow                     # uses NEXT_PUBLIC_SITE_URL
//   npm run seo:indexnow -- https://www.avokarto.com
//
// The key is the public/<key>.txt file; IndexNow fetches it to confirm the
// submission comes from the site owner. It is not a secret.
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), false, { error: () => {}, info: () => {} });

const site = new URL(process.argv[2] || process.env.NEXT_PUBLIC_SITE_URL || "").origin;
const keyFile = readdirSync("public").find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (!keyFile) throw new Error("No IndexNow key file (public/<32 hex>.txt) found.");
const key = readFileSync(`public/${keyFile}`, "utf8").trim();

async function locs(url) {
	const response = await fetch(url, { headers: { "User-Agent": "Avokarto IndexNow submitter" } });
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

// The sitemap is an index of sitemaps; collect every page URL they list.
const urls = new Set();
for (const entry of await locs(`${site}/sitemap.xml`)) {
	if (entry.endsWith(".xml")) for (const page of await locs(entry)) urls.add(page);
	else urls.add(entry);
}
const urlList = [...urls].filter((url) => new URL(url).origin === site);
if (!urlList.length) throw new Error("The sitemap listed no pages.");

const response = await fetch("https://api.indexnow.org/indexnow", {
	body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${keyFile}`, urlList }),
	headers: { "Content-Type": "application/json; charset=utf-8" },
	method: "POST",
});
// 200 = accepted, 202 = accepted and the key will be checked shortly.
console.log(`IndexNow: ${urlList.length} URLs from ${site} -> HTTP ${response.status}`);
if (response.status >= 400) {
	console.error(await response.text());
	process.exitCode = 1;
}
