/**
 * Visual calibration loop for the locally converted Guild Wars UI font.
 *
 * The player's own archive is the reference. Nothing from it is committed:
 * this command writes a disposable report under `/tmp` unless `--out` says
 * otherwise. Each candidate outline is rasterised by Chromium at the strike's
 * native physical size, aligned against the original grayscale
 * strike, scored by alpha error, and shown beside a heat-map difference.
 *
 *   pnpm font:calibrate
 *   pnpm font:calibrate -- --role display --text "Primary Quests"
 */

import { homedir } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ChunkStore } from "../src/main/core/chunk-store.js";
import { readGameFontStrike } from "../src/main/core/game-font-assets.js";
import {
  buildGuildWarsTrueType,
  decodeGameFontRange,
  GUILD_WARS_BODY_FONT,
  GUILD_WARS_DISPLAY_FONT,
} from "../src/main/core/gw-font.js";
import { parsePublishedClientManifest } from "../src/main/core/published-client.js";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const gameDir = path.resolve(flag(
  "game",
  path.join(homedir(), "Library", "Application Support", "Guild Wars", "game"),
));
const role = flag("role", "body");
if (role !== "body" && role !== "display") {
  throw new Error("--role must be body or display");
}
const metrics = role === "display" ? GUILD_WARS_DISPLAY_FONT : GUILD_WARS_BODY_FONT;
const outDir = path.resolve(flag(
  "out",
  role === "body"
    ? "/tmp/gwonmac-font-calibration"
    : "/tmp/gwonmac-font-calibration-display",
));
const sample = flag("text", role === "display" ? "Primary Quests" : "Seek Party");
const manifestPath = path.join(gameDir, "artifacts", "manifest.json");
const decoderPath = path.resolve("build/native/gw-dat-decode");
const thresholds = [0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0];

const manifest = parsePublishedClientManifest(
  JSON.parse(await readFile(manifestPath, "utf8")),
);
const store = new ChunkStore({
  chunksDir: path.join(gameDir, "chunks"),
  size: manifest.size,
  chunkSize: manifest.chunkSize,
  chunkHashes: manifest.chunkHashes,
  compression: manifest.compressionMode,
  fetch: null,
});
const strike = await readGameFontStrike({ store, decoderPath }, metrics);
if (!strike) throw new Error("the installed client does not contain the expected Latin strike");

const glyphs = decodeGameFontRange(strike, metrics).map((glyph) => ({
  top: glyph.top,
  width: glyph.width,
  height: glyph.height,
  pixels: Array.from(glyph.pixels),
}));
const candidates = thresholds.map((threshold) => ({
  threshold,
  font: buildGuildWarsTrueType(strike, { outlineThreshold: threshold, strike: metrics })
    .toString("base64"),
}));

interface CandidateResult {
  threshold: number;
  error: number;
  coverageDelta: number;
  referencePng: string;
  renderedPng: string;
  differencePng: string;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const results = await page.evaluate(
  async ({ candidates, glyphs, metrics, sample }) => {
    const margin = 3;
    const glyphFor = (character: string) => {
      const code = character.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e ? glyphs[code - 0x21] : null;
    };
    const advance = (character: string) =>
      character === " " ? metrics.spaceWidth : (glyphFor(character)?.width ?? 0);
    const contentWidth = [...sample].reduce(
      (total, character) => total + advance(character),
      0,
    );
    const width = contentWidth + margin * 2;
    const height = metrics.lineHeight + margin * 2;

    const makeCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    const reference = makeCanvas();
    const referenceContext = reference.getContext("2d", { willReadFrequently: true });
    if (!referenceContext) throw new Error("Chromium did not provide a 2D canvas");
    const referenceImage = referenceContext.createImageData(width, height);
    let pen = margin;
    for (const character of sample) {
      const glyph = glyphFor(character);
      if (glyph) {
        for (let y = 0; y < glyph.height; y += 1) {
          for (let x = 0; x < glyph.width; x += 1) {
            const alpha = glyph.pixels[y * glyph.width + x] ?? 0;
            const at = ((margin + glyph.top + y) * width + pen + x) * 4;
            referenceImage.data[at] = 255;
            referenceImage.data[at + 1] = 255;
            referenceImage.data[at + 2] = 255;
            referenceImage.data[at + 3] = alpha;
          }
        }
      }
      pen += advance(character);
    }
    referenceContext.putImageData(referenceImage, 0, 0);
    const referenceAlpha = referenceContext.getImageData(0, 0, width, height).data;

    const score = (
      rendered: Uint8ClampedArray,
      xShift: number,
      yShift: number,
    ) => {
      let error = 0;
      let referenceCoverage = 0;
      let renderedCoverage = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const referenceValue = referenceAlpha[(y * width + x) * 4 + 3] ?? 0;
          const shiftedX = x + xShift;
          const shiftedY = y + yShift;
          const renderedValue = shiftedX < 0 || shiftedY < 0
            || shiftedX >= width || shiftedY >= height
            ? 0
            : (rendered[(shiftedY * width + shiftedX) * 4 + 3] ?? 0);
          error += Math.abs(referenceValue - renderedValue);
          referenceCoverage += referenceValue;
          renderedCoverage += renderedValue;
        }
      }
      return {
        error: error / (width * height * 255),
        coverageDelta: (renderedCoverage - referenceCoverage)
          / Math.max(referenceCoverage, 1),
      };
    };

    const output = [];
    for (const candidate of candidates) {
      const family = `Candidate${candidate.threshold}`;
      const face = new FontFace(
        family,
        `url(data:font/ttf;base64,${candidate.font})`,
        { weight: "400" },
      );
      await face.load();
      document.fonts.add(face);
      const rendered = makeCanvas();
      const context = rendered.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Chromium did not provide a 2D canvas");
      context.fillStyle = "white";
      context.font = `400 ${metrics.em}px ${family}`;
      context.textBaseline = "alphabetic";
      context.fillText(sample, margin, margin + metrics.baseline);
      const renderedImage = context.getImageData(0, 0, width, height);

      let best = { x: 0, y: 0, ...score(renderedImage.data, 0, 0) };
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          const candidateScore = score(renderedImage.data, x, y);
          if (candidateScore.error < best.error) best = { x, y, ...candidateScore };
        }
      }

      const difference = makeCanvas();
      const differenceContext = difference.getContext("2d");
      if (!differenceContext) throw new Error("Chromium did not provide a 2D canvas");
      const differenceImage = differenceContext.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const at = (y * width + x) * 4;
          const referenceValue = referenceAlpha[at + 3] ?? 0;
          const shiftedX = x + best.x;
          const shiftedY = y + best.y;
          const renderedValue = shiftedX < 0 || shiftedY < 0
            || shiftedX >= width || shiftedY >= height
            ? 0
            : (renderedImage.data[(shiftedY * width + shiftedX) * 4 + 3] ?? 0);
          differenceImage.data[at] = Math.max(referenceValue - renderedValue, 0);
          differenceImage.data[at + 1] = Math.min(referenceValue, renderedValue);
          differenceImage.data[at + 2] = Math.max(renderedValue - referenceValue, 0);
          differenceImage.data[at + 3] = Math.max(referenceValue, renderedValue);
        }
      }
      differenceContext.putImageData(differenceImage, 0, 0);
      output.push({
        threshold: candidate.threshold,
        error: best.error,
        coverageDelta: best.coverageDelta,
        referencePng: reference.toDataURL("image/png"),
        renderedPng: rendered.toDataURL("image/png"),
        differencePng: difference.toDataURL("image/png"),
      });
    }
    return output;
  },
  { candidates, glyphs, metrics, sample },
) as CandidateResult[];

results.sort((left, right) => left.error - right.error);
const best = results[0];
if (!best) throw new Error("font calibration produced no candidates");
const bestFont = candidates.find(({ threshold }) => threshold === best.threshold);
if (!bestFont) throw new Error("font calibration lost its best candidate");
const pngBytes = (dataUrl: string) => Buffer.from(dataUrl.split(",", 2)[1]!, "base64");
await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outDir, "font.ttf"), Buffer.from(bestFont.font, "base64")),
  writeFile(path.join(outDir, "reference.png"), pngBytes(best.referencePng)),
  writeFile(path.join(outDir, "rendered.png"), pngBytes(best.renderedPng)),
  writeFile(path.join(outDir, "difference.png"), pngBytes(best.differencePng)),
  writeFile(path.join(outDir, "report.json"), JSON.stringify({
    sample,
    role,
    physicalPixelSize: metrics.em,
    bestThreshold: best.threshold,
    candidates: results.map(({ threshold, error, coverageDelta }) => ({
      threshold,
      error,
      coverageDelta,
    })),
  }, null, 2)),
]);

await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { width: 1080px; margin: 0; padding: 40px; background: #0c0b0a; color: #eee9df; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  p { color: #aaa397; }
  .summary { margin-bottom: 28px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  article { padding: 18px; border: 1px solid #454038; border-radius: 10px; background: #171410; }
  h2 { margin: 0 0 14px; color: #e7c982; font-size: 16px; }
  img { width: auto; height: auto; min-width: 100%; image-rendering: pixelated; background: #241b14; }
  table { width: 100%; margin-top: 28px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #39352f; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  tr.best { color: #f2d58e; font-weight: 700; }
</style>
<h1>Guild Wars ${role} font calibration</h1>
<p class="summary">“${sample.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}” at ${metrics.em} physical pixels · best alpha threshold: 0x${best.threshold.toString(16)} · mean error ${(best.error * 100).toFixed(2)}%</p>
<div class="grid">
  <article><h2>Original archive strike</h2><img src="${best.referencePng}"></article>
  <article><h2>Chromium render</h2><img src="${best.renderedPng}"></article>
  <article><h2>Difference heat map</h2><img src="${best.differencePng}"></article>
</div>
<table><thead><tr><th>Threshold</th><th>Mean alpha error</th><th>Coverage delta</th></tr></thead><tbody>
${results.map((result) => `<tr class="${result === best ? "best" : ""}"><td>0x${result.threshold.toString(16)}</td><td>${(result.error * 100).toFixed(2)}%</td><td>${(result.coverageDelta * 100).toFixed(2)}%</td></tr>`).join("")}
</tbody></table>`);
await page.screenshot({ path: path.join(outDir, "report.png"), fullPage: true });
await browser.close();

console.log(JSON.stringify({
  report: path.join(outDir, "report.png"),
  data: path.join(outDir, "report.json"),
  font: path.join(outDir, "font.ttf"),
  role,
  bestThreshold: `0x${best.threshold.toString(16)}`,
  meanAlphaError: best.error,
  coverageDelta: best.coverageDelta,
}, null, 2));
