import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const output = join(import.meta.dirname, "..", ".output", "public");

const requiredFiles = [
  "index.html",
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

const representativeHtml = await readFile(join(output, "index.html"), "utf8");
const headLinks = [...representativeHtml.matchAll(/<link\b[^>]*>/giu)].map(
  ([tag]) => Object.fromEntries(
    [...tag.matchAll(/\b([a-z][a-z0-9:-]*)="([^"]*)"/giu)]
      .map(([, name, value]) => [name.toLowerCase(), value]),
  ),
);
const requiredHeadLinks = [
  { rel: "icon", type: "image/png", href: "/favicon-96x96.png", sizes: "96x96" },
  { rel: "shortcut icon", href: "/favicon.ico" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];
for (const required of requiredHeadLinks) {
  const present = headLinks.some((link) =>
    Object.entries(required).every(([name, value]) => link[name] === value),
  );
  if (!present) {
    throw new Error(`Generated HTML is missing head link: ${JSON.stringify(required)}`);
  }
  await access(join(output, required.href.slice(1)));
}

const expectedManifestIcons = [
  {
    src: "/web-app-manifest-192x192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "maskable",
  },
  {
    src: "/web-app-manifest-512x512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];
const manifest = JSON.parse(await readFile(join(output, "site.webmanifest"), "utf8"));
if (JSON.stringify(manifest.icons) !== JSON.stringify(expectedManifestIcons)) {
  throw new Error("Generated web manifest does not contain the exact owned icon set");
}
await Promise.all(
  expectedManifestIcons.map(({ src }) => access(join(output, src.slice(1)))),
);

const missingIcons = new Set();
const renderedIcons = new Set();
const rasterDataUrl = /\b(?:href|xlink:href)\s*=\s*["']data:image\/(?!svg\+xml[;,])[a-z0-9.+-]+[;,]/iu;
for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".svg")) {
    const svg = await readFile(join(entry.parentPath, entry.name), "utf8");
    if (rasterDataUrl.test(svg)) {
      throw new Error(
        `Generated SVG embeds raster image data: ${join(entry.parentPath, entry.name)}`,
      );
    }
  }
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
