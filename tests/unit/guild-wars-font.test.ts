// The game ships bitmap strikes, not an installable font. These fixtures prove
// their nibble/RLE boundary and the generated TrueType container without
// committing or reading any ArenaNet data.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ChunkStore } from "../../src/main/core/chunk-store.js";
import { GameFontAssets } from "../../src/main/core/game-font-assets.js";
import {
  buildGuildWarsTrueType,
  decodeGameFontRange,
} from "../../src/main/core/gw-font.ts";

const root = new URL("../../", import.meta.url);
const GLYPH_COUNT = 94;

function repeatedGlyph(bytes: readonly number[]): Uint8Array {
  return Uint8Array.from(
    Array.from({ length: GLYPH_COUNT }, () => bytes).flat(),
  );
}

function packedNibbles(values: readonly number[]): number[] {
  const bytes: number[] = [];
  for (let at = 0; at < values.length; at += 2) {
    bytes.push(values[at]! | ((values[at + 1] ?? 0) << 4));
  }
  return bytes;
}

function tableOffset(font: Buffer, wanted: string): number {
  const count = font.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;
    if (font.toString("ascii", at, at + 4) === wanted) {
      return font.readUInt32BE(at + 8);
    }
  }
  throw new Error(`font has no ${wanted} table`);
}

function fontChecksum(bytes: Uint8Array): number {
  const padded = Math.ceil(bytes.byteLength / 4) * 4;
  let sum = 0;
  for (let at = 0; at < padded; at += 4) {
    sum = (
      sum
      + (((bytes[at] ?? 0) << 24) >>> 0)
      + ((bytes[at + 1] ?? 0) << 16)
      + ((bytes[at + 2] ?? 0) << 8)
      + (bytes[at + 3] ?? 0)
    ) >>> 0;
  }
  return sum;
}

test("the Guild Wars nibble stream decodes every printable ASCII glyph", () => {
  // top=0, width=1, height=1, palette mode=1, one palette-1 pixel.
  const glyphs = decodeGameFontRange(repeatedGlyph([0x00, 0x10, 0x01]));
  assert.equal(glyphs.length, GLYPH_COUNT);
  assert.deepEqual(
    { top: glyphs[0]?.top, width: glyphs[0]?.width, height: glyphs[0]?.height },
    { top: 0, width: 1, height: 1 },
  );
  assert.deepEqual([...glyphs[0]!.pixels], [0x66]);
});

test("alternating runs cannot overrun a glyph", () => {
  // top=0, width=2, height=2, mode=0, then runs of two lit and two clear.
  const glyphs = decodeGameFontRange(repeatedGlyph([0x10, 0x01, 0x11]));
  assert.deepEqual([...glyphs[0]!.pixels], [0xff, 0xff, 0x00, 0x00]);
  assert.throws(
    () => decodeGameFontRange(repeatedGlyph([0x00, 0x00, 0x1f])),
    /run exceeds its bitmap/,
  );
});

test("the converted result is a complete checksummed TrueType font", () => {
  const font = buildGuildWarsTrueType(repeatedGlyph([0x00, 0x10, 0x01]));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  assert.equal(font.readUInt16BE(4), 10);
  assert.equal(fontChecksum(font), 0xb1b0afba);
  assert.ok(font.includes(Buffer.from("Guild Wars Original", "utf16le").swap16()));
});

test("a narrow numeral gets balanced proportional spacing", () => {
  // Most fixture glyphs fill a nine-pixel cell. `1` occupies only its centre
  // pixel, matching the large empty sides found in the game's real digit cell.
  const full = packedNibbles([0, 8, 1, 0, 1, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
  const narrow = packedNibbles([0, 8, 1, 0, 1, 0, 3, 8, 0, 3]);
  const glyphs = Array.from({ length: GLYPH_COUNT }, () => full);
  glyphs[0x31 - 0x21] = narrow;
  const font = buildGuildWarsTrueType(Uint8Array.from(glyphs.flat()));
  const hmtx = tableOffset(font, "hmtx");
  const glyphId = (character: string) => character.charCodeAt(0) - 0x20 + 1;
  const advance = (character: string) =>
    font.readUInt16BE(hmtx + glyphId(character) * 4);
  assert.ok(advance("1") < advance("2"));
});

test("a temporary local font refusal can recover without an app restart", async () => {
  let reads = 0;
  const assets = new GameFontAssets({
    store: {
      readRange: async () => {
        reads += 1;
        throw new Error("temporarily unavailable");
      },
    } as unknown as ChunkStore,
    decoderPath: "/not-reached",
  });

  assert.equal(await assets.font(), null);
  assert.equal(await assets.font(), null);
  assert.equal(reads, 2);
});

test("the shared UI offers the local Guild Wars font independently of Inter", () => {
  const css = readFileSync(new URL("src/shared/ui/tokens.css", root), "utf8");
  assert.match(css, /url\("gw:\/\/app\/game-font\.ttf"\)/);
  assert.match(css, /--ui-font: "Guild Wars Original"/);
  assert.match(css, /:root\[data-ui-font="inter"\]/);
  assert.match(css, /unicode-range: U\+0020-007E/);
});
