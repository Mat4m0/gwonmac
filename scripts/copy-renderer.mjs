// Copies the renderer's static assets into build/. It does not copy the
// renderer's code: `tsc -p tsconfig.renderer.json` compiles that, and this
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
  "favicon.ico",
  "favicon.png",
  "fonts/COPYING-QUALITYPE",
  "fonts/QTFrizQuad.otf",
  "harness.css",
  "images/hero-poster.jpg",
  "images/hero-video.webm",
  "images/logo.webp",
  "index.html",
  "loading.css",
];

const dest = path.resolve("build/renderer");
for (const relative of ASSETS) {
  const target = path.join(dest, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.resolve("src/renderer", relative), target);
}

console.log(`copied renderer -> ${dest}`);
