import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const output = join(import.meta.dirname, "..", ".output", "public");

const requiredFiles = [
  "docs/index.html",
  "docs/guides/install/index.html",
  "docs/guides/play-guild-wars-on-mac/index.html",
  "docs/guides/accounts/index.html",
  "docs/project/safety/index.html",
  "de/dokumentation/index.html",
  "de/dokumentation/anleitungen/installation/index.html",
  "de/dokumentation/anleitungen/guild-wars-auf-dem-mac-spielen/index.html",
  "de/dokumentation/anleitungen/konten/index.html",
  "de/dokumentation/projekt/sicherheit/index.html",
  "llms.txt",
  "de/llms.txt",
  "llms-full.txt",
  "de/llms-full.txt",
  "sitemap_index.xml",
  "__sitemap__/en-US.xml",
  "__sitemap__/de-DE.xml",
  "api/_content/search/index.json",
];

await Promise.all(requiredFiles.map((file) => access(join(output, file))));

const missingIcons = new Set();
const renderedIcons = new Set();
for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const html = await readFile(join(entry.parentPath, entry.name), "utf8");
  for (const match of html.matchAll(
    /class="[^"]*\bi-([a-z0-9-]+:[a-z0-9-]+)\b[^"]*"/g,
  )) {
    const name = match[1];
    renderedIcons.add(name);
    const selector = `.i-${name.replace(":", "\\:")}`;
    if (!html.includes(selector)) missingIcons.add(name);
  }
}

if (renderedIcons.size === 0) {
  throw new Error("No rendered icon classes were found in the generated website");
}

if (missingIcons.size > 0) {
  throw new Error(
    `Rendered icons missing their generated CSS: ${[...missingIcons].sort().join(", ")}`,
  );
}

const english = await readFile(join(output, "__sitemap__/en-US.xml"), "utf8");
const german = await readFile(join(output, "__sitemap__/de-DE.xml"), "utf8");

const contentLocations = (xml) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(match[1]).pathname)
    .filter(
      (path) =>
        path === "/docs" ||
        path.startsWith("/docs/") ||
        path === "/de/dokumentation" ||
        path.startsWith("/de/dokumentation/"),
    );

const englishLocations = contentLocations(english);
const germanLocations = contentLocations(german);

if (
  englishLocations.length === 0 ||
  englishLocations.some((path) => path.startsWith("/de/dokumentation"))
) {
  throw new Error("The English child sitemap is not partitioned to English content routes");
}

if (
  germanLocations.length === 0 ||
  germanLocations.some((path) => path === "/docs" || path.startsWith("/docs/"))
) {
  throw new Error("The German child sitemap is not partitioned to German content routes");
}

for (const [locale, sitemap] of [
  ["English", english],
  ["German", german],
]) {
  if (!sitemap.includes('hreflang="en-US"') || !sitemap.includes('hreflang="de-DE"')) {
    throw new Error(`${locale} sitemap does not contain reciprocal locale alternates`);
  }
}

console.info("Release output invariants passed for the multilingual consumer.");
