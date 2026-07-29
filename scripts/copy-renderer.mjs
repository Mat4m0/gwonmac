// Copies the renderer's static assets into build/. It does not copy the
// renderer's code: `tsc -p tsconfig.renderer.json` compiles that, and this
// script runs before it so the emit is not overwritten. It does not compile the
// Enhancement kernel either — scripts/build.mjs owns that, because this script used
// to run twice per package build and so compiled it twice — and it does not
// produce the preload, which is generated from the canonical contracts by
// scripts/generate-preload.ts.
import fs from "node:fs";
import path from "node:path";

// Everything the compiler owns. An asset is what is left, so a new font or
// image needs no change here, and a new module can never be shipped twice.
const COMPILED = new Set([".js", ".ts"]);

/** @param {string} src @param {string} dest */
function copyAssets(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyAssets(from, to);
    else if (!COMPILED.has(path.extname(entry.name))) fs.copyFileSync(from, to);
  }
}

const ART_CREDIT =
  'Screenshots by <a href="https://bloogum.net/guildwars/">Snapshot Henchman</a>';

const src = path.resolve("src/renderer");
// No rmSync: scripts/build.mjs removes build/ once, at the start, and this
// script now runs before TypeScript emits into the same directories.
const dest = path.resolve("build/renderer");
copyAssets(src, dest);
copyAssets(path.resolve("src/control"), path.resolve("build/control"));

const imagesDir = path.join(dest, "images");
if (fs.existsSync(imagesDir)) {
  const names = fs.readdirSync(imagesDir).filter((n) => !n.startsWith("."));
  fs.writeFileSync(
    path.join(imagesDir, "index.json"),
    JSON.stringify({
      logo: names.includes("logo.webp") ? "images/logo.webp" : null,
      backgrounds: names.filter((n) => n.startsWith("bg")).map((n) => `images/${n}`),
      credit: ART_CREDIT,
    }),
  );
}

console.log(`copied renderer -> ${dest}`);
