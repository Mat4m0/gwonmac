// Copies the renderer's static assets into build/. It does not copy the
// renderer's code: scripts/build-renderer.mjs compiles that, and this
// script runs before it so the emit is not overwritten. It does not compile the
// Enhancement kernel either — scripts/build.mjs owns that, because this script used
// to run twice per package build and so compiled it twice — and it does not
// produce the preload, which is generated from the canonical contracts by
// scripts/generate-preload.ts.
import fs from "node:fs";
import path from "node:path";

// Package inputs are explicit. Copying "everything except code" made ignored
// editor and OS files part of the build, so two clean checkouts could package
// different applications. A new asset must be reviewed here.
const ASSETS = [
  "cartography-overlay-controls.css",
  "character-switch.css",
  "hub.css",
  "favicon.ico",
  "favicon.png",
  "fonts.css",
  "fonts/COPYING-QUALITYPE",
  "fonts/QTFrizQuad.otf",
  "harness.css",
  "images/logo.webp",
  "images/playstation-controller-prompts.png",
  "index.html",
  "loading.css",
];

// The design system lives in src/shared because the Tools application consumes
// it too, and apps/** may only reach into src/shared (see eslint.config.js).
// The renderer loads it as `ui/…`, so it lands beside the renderer's own assets
// rather than under a shared/ subtree nothing else would read. Listed here for
// the same reason as everything above: a package input is explicit.
/** @type {ReadonlyArray<readonly [source: string, destination: string]>} */
const SHARED_ASSETS = [
  ["src/shared/ui/tokens.css", "ui/tokens.css"],
  ["src/shared/ui/components.css", "ui/components.css"],
  ["src/shared/ui/frame/body.png", "shared/ui/frame/body.png"],
  ["src/shared/ui/frame/header.png", "shared/ui/frame/header.png"],
  // Currency cards run in the unbundled renderer as well as the Vite Tools UI.
  ["src/shared/images/currency/Gold.png", "shared/images/currency/Gold.png"],
  ["src/shared/images/currency/Platinum.png", "shared/images/currency/Platinum.png"],
  ["src/shared/images/currency/Armbrace_of_Truth.png", "shared/images/currency/Armbrace_of_Truth.png"],
  ["src/shared/images/currency/Zaishen_Key.png", "shared/images/currency/Zaishen_Key.png"],
  ["src/shared/images/materials/0b1985.png", "shared/images/materials/0b1985.png"],
  ["src/shared/images/materials/0b1984.png", "shared/images/materials/0b1984.png"],
  ["src/shared/images/materials/0b039b.png", "shared/images/materials/0b039b.png"],
  ["src/shared/images/materials/0b03b4.png", "shared/images/materials/0b03b4.png"],
  ["src/shared/images/materials/0b03bb.png", "shared/images/materials/0b03bb.png"],
  ["src/shared/images/materials/0b03a8.png", "shared/images/materials/0b03a8.png"],
  ["src/shared/images/materials/0b03a9.png", "shared/images/materials/0b03a9.png"],
  ["src/shared/images/materials/0b03bc.png", "shared/images/materials/0b03bc.png"],
  ["src/shared/images/materials/0b03b5.png", "shared/images/materials/0b03b5.png"],
  ["src/shared/images/materials/0b039a.png", "shared/images/materials/0b039a.png"],
  ["src/shared/images/materials/0b03b7.png", "shared/images/materials/0b03b7.png"],
  ["src/shared/images/materials/0b03ba.png", "shared/images/materials/0b03ba.png"],
  ["src/shared/images/materials/0b03b6.png", "shared/images/materials/0b03b6.png"],
  ["src/shared/images/materials/0b039d.png", "shared/images/materials/0b039d.png"],
  ["src/shared/images/materials/0b03b2.png", "shared/images/materials/0b03b2.png"],
  ["src/shared/images/materials/0b039e.png", "shared/images/materials/0b039e.png"],
  ["src/shared/images/materials/0b03b1.png", "shared/images/materials/0b03b1.png"],
  ["src/shared/images/materials/0b03b0.png", "shared/images/materials/0b03b0.png"],
  ["src/shared/images/materials/0b039f.png", "shared/images/materials/0b039f.png"],
  ["src/shared/images/materials/0b03a1.png", "shared/images/materials/0b03a1.png"],
  ["src/shared/images/materials/0b03af.png", "shared/images/materials/0b03af.png"],
  ["src/shared/images/materials/0b03a0.png", "shared/images/materials/0b03a0.png"],
  ["src/shared/images/materials/0b03a2.png", "shared/images/materials/0b03a2.png"],
  ["src/shared/images/materials/0b03ad.png", "shared/images/materials/0b03ad.png"],
  ["src/shared/images/materials/0b03ae.png", "shared/images/materials/0b03ae.png"],
  ["src/shared/images/materials/0b03a3.png", "shared/images/materials/0b03a3.png"],
  ["src/shared/images/materials/0b03aa.png", "shared/images/materials/0b03aa.png"],
  ["src/shared/images/materials/0b03a7.png", "shared/images/materials/0b03a7.png"],
  ["src/shared/images/materials/0b03a6.png", "shared/images/materials/0b03a6.png"],
  ["src/shared/images/materials/0b03b8.png", "shared/images/materials/0b03b8.png"],
  ["src/shared/images/materials/0b03ab.png", "shared/images/materials/0b03ab.png"],
  ["src/shared/images/materials/0b03a4.png", "shared/images/materials/0b03a4.png"],
  ["src/shared/images/materials/0b03a5.png", "shared/images/materials/0b03a5.png"],
  ["src/shared/images/materials/0b03ac.png", "shared/images/materials/0b03ac.png"],
  ["src/shared/images/materials/0b03b9.png", "shared/images/materials/0b03b9.png"],
  ["src/shared/images/materials/0b0399.png", "shared/images/materials/0b0399.png"],
  ["src/shared/images/professions/1.png", "shared/images/professions/1.png"],
  ["src/shared/images/professions/2.png", "shared/images/professions/2.png"],
  ["src/shared/images/professions/3.png", "shared/images/professions/3.png"],
  ["src/shared/images/professions/4.png", "shared/images/professions/4.png"],
  ["src/shared/images/professions/5.png", "shared/images/professions/5.png"],
  ["src/shared/images/professions/6.png", "shared/images/professions/6.png"],
  ["src/shared/images/professions/7.png", "shared/images/professions/7.png"],
  ["src/shared/images/professions/8.png", "shared/images/professions/8.png"],
  ["src/shared/images/professions/9.png", "shared/images/professions/9.png"],
  ["src/shared/images/professions/10.png", "shared/images/professions/10.png"],
  // The website and Hub use one reviewed static painting. Keep it canonical in
  // the website package and copy it into the renderer at build time.
  ["apps/website/public/bg-reforged.jpg", "images/bg-reforged.jpg"],
];

// Inter is a pinned build dependency rather than a checked-in binary. Copy its
// reviewed variable-weight CSS, language subsets, and OFL notice into the
// renderer so the named preference is real and remains fully offline.
/** @type {ReadonlyArray<readonly [source: string, destination: string]>} */
const INTER_ASSETS = [
  ["wght.css", "fonts/inter.css"],
  ["LICENSE", "fonts/COPYING-INTER"],
  ["files/inter-cyrillic-ext-wght-normal.woff2", "fonts/files/inter-cyrillic-ext-wght-normal.woff2"],
  ["files/inter-cyrillic-wght-normal.woff2", "fonts/files/inter-cyrillic-wght-normal.woff2"],
  ["files/inter-greek-ext-wght-normal.woff2", "fonts/files/inter-greek-ext-wght-normal.woff2"],
  ["files/inter-greek-wght-normal.woff2", "fonts/files/inter-greek-wght-normal.woff2"],
  ["files/inter-latin-ext-wght-normal.woff2", "fonts/files/inter-latin-ext-wght-normal.woff2"],
  ["files/inter-latin-wght-normal.woff2", "fonts/files/inter-latin-wght-normal.woff2"],
  ["files/inter-vietnamese-wght-normal.woff2", "fonts/files/inter-vietnamese-wght-normal.woff2"],
];

const dest = path.resolve("build/renderer");
/**
 * @param {string} from absolute source path
 * @param {string} relative destination, under build/renderer
 */
const copy = (from, relative) => {
  const target = path.join(dest, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target);
};

for (const relative of ASSETS) {
  copy(path.resolve("src/renderer", relative), relative);
}

for (const [from, relative] of SHARED_ASSETS) {
  copy(path.resolve(from), relative);
}
for (const [from, relative] of INTER_ASSETS) {
  copy(path.resolve("node_modules/@fontsource-variable/inter", from), relative);
}

console.log(`copied renderer -> ${dest}`);
