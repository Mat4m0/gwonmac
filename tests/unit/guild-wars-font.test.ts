// The game ships bitmap strikes, not an installable font. These fixtures prove
// their nibble/RLE boundary and the generated TrueType container without
// committing or reading any ArenaNet data.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GameFontAssets } from "../../src/main/core/game-font-assets.js";
import {
  buildGuildWarsTrueType,
  decodeGameFontRange,
  GUILD_WARS_DISPLAY_FONT,
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
  // top=0, width=2, height=2, mode=0, then runs of two clear and two lit.
  const glyphs = decodeGameFontRange(repeatedGlyph([0x10, 0x01, 0x11]));
  assert.deepEqual([...glyphs[0]!.pixels], [0x00, 0x00, 0xff, 0xff]);
  assert.throws(
    () => decodeGameFontRange(repeatedGlyph([0x00, 0x00, 0x1f])),
    /run exceeds its bitmap/,
  );
});

test("binary symbols preserve the first run's polarity in both strikes", () => {
  // Synthetic 3x3 + and = masks, plus solid | and _ strokes. These exercise
  // both starting alphas without including any proprietary glyph bytes.
  const plus = packedNibbles([0, 2, 2, 0, 0, 0, 0, 2, 0, 0, 0]);
  const equals = packedNibbles([0, 2, 2, 15, 2, 2, 2]);
  const bar = packedNibbles([0, 0, 2, 15, 2]);
  const underscore = packedNibbles([3, 2, 0, 15, 2]);
  const masks = new Map([
    ["+", { bytes: plus, pixels: [0, 255, 0, 255, 255, 255, 0, 255, 0] }],
    ["=", { bytes: equals, pixels: [255, 255, 255, 0, 0, 0, 255, 255, 255] }],
    ["|", { bytes: bar, pixels: [255, 255, 255] }],
    ["_", { bytes: underscore, pixels: [255, 255, 255] }],
  ]);
  const source = Array.from({ length: GLYPH_COUNT }, () => plus);
  for (const [character, mask] of masks) source[character.charCodeAt(0) - 0x21] = mask.bytes;
  for (const strike of [undefined, GUILD_WARS_DISPLAY_FONT]) {
    const glyphs = decodeGameFontRange(Uint8Array.from(source.flat()), strike);
    for (const [character, mask] of masks) {
      assert.deepEqual([...glyphs[character.charCodeAt(0) - 0x21]!.pixels], mask.pixels, character);
    }
  }
});

test("palette glyphs retain all alpha levels and endpoint runs", () => {
  const source = packedNibbles([
    0, 15, 2, 0, 1, // width=24, height=1, palette mode
    0, 4, // five transparent pixels
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    15, 4, // five opaque pixels
  ]);
  for (let mode = 1; mode < 15; mode++) {
    const variant = [...source];
    variant[2] = (variant[2]! & 0xf0) | mode;
    const glyphs = decodeGameFontRange(repeatedGlyph(variant));
    assert.deepEqual([...glyphs[0]!.pixels], [
      0, 0, 0, 0, 0,
      0x66, 0x79, 0x8d, 0x97, 0xa5, 0xaf, 0xbd,
      0xc6, 0xce, 0xd6, 0xde, 0xe7, 0xef, 0xf7,
      255, 255, 255, 255, 255,
    ]);
  }
});

test("long binary runs cross rows without losing polarity", () => {
  // 24x2 bitmap: 32 opaque pixels, then 16 transparent pixels.
  const source = packedNibbles([0, 15, 2, 1, 15, 15, 15, 1, 15, 0]);
  assert.deepEqual(
    [...decodeGameFontRange(repeatedGlyph(source))[0]!.pixels],
    [...Array<number>(32).fill(255), ...Array<number>(16).fill(0)],
  );
});

test("truncated, extra, and incomplete ranges are refused", () => {
  assert.throws(() => decodeGameFontRange(Uint8Array.of(0)), /ended inside a nibble/);
  assert.throws(() => decodeGameFontRange(Uint8Array.of(0, 0xf0)), /ended inside a nibble/);
  assert.throws(() => decodeGameFontRange(Uint8Array.of(0, 0xf0, 0)), /instead of 94/);
  assert.throws(() => decodeGameFontRange(Uint8Array.from([
    ...repeatedGlyph([0, 0xf0, 0]), 0, 0xf0, 0,
  ])), /95 glyphs instead of 94/);
});

test("the converted result is a complete checksummed TrueType font", () => {
  const font = buildGuildWarsTrueType(repeatedGlyph([0x00, 0x10, 0x01]));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  assert.equal(font.readUInt16BE(4), 10);
  assert.equal(fontChecksum(font), 0xb1b0afba);
  assert.ok(font.includes(Buffer.from("Guild Wars Original", "utf16le").swap16()));
});

test("the original display strike builds as a separate browser family", () => {
  const font = buildGuildWarsTrueType(repeatedGlyph([0x00, 0x10, 0x01]), {
    strike: GUILD_WARS_DISPLAY_FONT,
  });
  assert.ok(font.includes(
    Buffer.from("Guild Wars Original Display", "utf16le").swap16(),
  ));
  assert.deepEqual(
    font,
    buildGuildWarsTrueType(repeatedGlyph([0x00, 0x10, 0x01]), {
      strike: GUILD_WARS_DISPLAY_FONT,
      outlineThreshold: 0xc4,
    }),
  );
});

test("the measured contour remains the default and calibration inputs are bounded", () => {
  const strike = repeatedGlyph([0x00, 0xf0, 0x00]);
  const font = buildGuildWarsTrueType(strike);
  assert.deepEqual(
    font,
    buildGuildWarsTrueType(strike, { outlineThreshold: 0xb4 }),
  );
  assert.notDeepEqual(
    font,
    buildGuildWarsTrueType(strike, { outlineThreshold: 0x80 }),
  );
  assert.throws(
    () => buildGuildWarsTrueType(strike, { outlineThreshold: 0 }),
    /threshold must be an integer from 1 to 254/,
  );
});

test("a narrow numeral gets balanced proportional spacing", () => {
  // Most fixture glyphs fill a nine-pixel cell. `1` occupies only its centre
  // pixel, matching the large empty sides found in the game's real digit cell.
  const full = packedNibbles([0, 8, 1, 0, 1, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
  const narrow = packedNibbles([0, 8, 1, 0, 1, 0, 3, 8, 0, 3]);
  const glyphs = Array.from({ length: GLYPH_COUNT }, () => full);
  glyphs[0x31 - 0x21] = narrow;
  const font = buildGuildWarsTrueType(Uint8Array.from(glyphs.flat()), {
    // This synthetic one-pixel stem exists to isolate the spacing rule. The
    // real calibrated strike has a wider `1`; keep the fixture visible here.
    outlineThreshold: 0x80,
  });
  const hmtx = tableOffset(font, "hmtx");
  const glyphId = (character: string) => character.charCodeAt(0) - 0x20 + 1;
  const advance = (character: string) =>
    font.readUInt16BE(hmtx + glyphId(character) * 4);
  assert.ok(advance("1") < advance("2"));
});

test("every character maps to an outline with its actual left bearing", () => {
  // Give each character a stem at a different inset. Check the encoded cmap,
  // metrics and outline together so an otherwise valid font cannot silently
  // shift punctuation or map a symbol to the next character.
  const source = Array.from({ length: GLYPH_COUNT }, (_, index) => {
    const inset = index % 4;
    const pixels = Array.from({ length: 7 }, (_, x) => x === inset ? 15 : 0);
    return packedNibbles([0, 6, 0, 1, ...pixels.flatMap((alpha) => [alpha, 0])]);
  });
  const font = buildGuildWarsTrueType(Uint8Array.from(source.flat()), {
    outlineSampleScale: 1,
  });
  const cmap = tableOffset(font, "cmap") + 12;
  const glyf = tableOffset(font, "glyf");
  const loca = tableOffset(font, "loca");
  const hmtx = tableOffset(font, "hmtx");
  assert.equal(font.readUInt16BE(cmap), 4);
  assert.equal(font.readUInt16BE(cmap + 14), 0x7e);
  assert.equal(font.readUInt16BE(cmap + 20), 0x20);
  const delta = font.readInt16BE(cmap + 24);
  for (let character = 0x21; character <= 0x7e; character++) {
    const id = character + delta;
    assert.equal(id, character - 0x21 + 2);
    const outline = glyf + font.readUInt32BE(loca + id * 4);
    assert.equal(font.readInt16BE(outline), 1, `visible ${String.fromCharCode(character)}`);
    const left = font.readInt16BE(outline + 2);
    assert.equal(font.readInt16BE(hmtx + id * 4 + 2), left);
    if (character < 0x30 || character > 0x39) {
      assert.equal(left, Math.round(((character - 0x21) % 4) * 1024 / 24));
    }
  }
});

test("an unsupported font is refused once for its immutable client generation", async () => {
  let reads = 0;
  const assets = new GameFontAssets({
    store: {
      readRange: async () => {
        reads += 1;
        throw new Error("temporarily unavailable");
      },
    },
    decoderPath: "/not-reached",
  });

  assert.equal(await assets.font(), null);
  assert.equal(await assets.font(), null);
  assert.equal(reads, 1);
  assert.equal(assets.refusal(), "read-or-format");
});

test("a compact oversized strike is refused before outline tracing", () => {
  // top=0, width value=24 (therefore 25 pixels), height=1, palette mode=1.
  const oversized = repeatedGlyph([0x80, 0x03, 0x01]);
  assert.throws(
    () => buildGuildWarsTrueType(oversized),
    /does not match the 24px strike/,
  );
});

test("the shared UI offers the local Guild Wars font independently of Inter", () => {
  const css = readFileSync(new URL("src/shared/ui/tokens.css", root), "utf8");
  const loading = readFileSync(new URL("src/renderer/loading.css", root), "utf8");
  assert.match(css, /data-ui-font="guild-wars"/);
  assert.match(css, /--ui-font: "Guild Wars Original"/);
  assert.match(css, /--ui-font-display: "Guild Wars Original Display"/);
  assert.match(css, /"Guild Wars Original", "QTFrizQuad"/);
  assert.match(css, /:root\[data-ui-font="inter"\]/);
  assert.match(css, /font-synthesis-weight: none/);
  assert.match(css, /--ui-font-weight-bold: 400/);
  assert.match(css, /--ui-font-weight-bold: 700/);
  assert.match(css, /:where\(strong, b, h1, h2, h3, h4, h5, h6\)/);
  assert.doesNotMatch(css, /-1px 1px 0 #000/);
  assert.match(loading, /var\(--ui-font\)/u);
  const appearance = readFileSync(new URL("src/renderer/appearance.ts", root), "utf8");
  assert.match(appearance, /new FontFace\("Guild Wars Original"/);
  assert.match(appearance, /"Guild Wars Original Display"/);
  assert.match(appearance, /generation=/);
});
