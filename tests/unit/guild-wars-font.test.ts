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
      outlineThreshold: 0xe0,
    }),
  );
});

test("the measured contour remains the default and calibration inputs are bounded", () => {
  const strike = repeatedGlyph([0x00, 0x00, 0x00]);
  const font = buildGuildWarsTrueType(strike);
  assert.deepEqual(
    font,
    buildGuildWarsTrueType(strike, { outlineThreshold: 0xa0 }),
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
  const settings = readFileSync(new URL("src/renderer/settings.css", root), "utf8");
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
  assert.doesNotMatch(
    settings.match(/#settings-dialog\s*\{[\s\S]*?\}/u)?.[0] ?? "",
    /--ui-font(?:-display)?\s*:/u,
  );
  assert.match(loading, /font:16px\/1\.5 var\(--ui-font\)/u);
  const appearance = readFileSync(new URL("src/renderer/appearance.ts", root), "utf8");
  assert.match(appearance, /new FontFace\("Guild Wars Original"/);
  assert.match(appearance, /"Guild Wars Original Display"/);
  assert.match(appearance, /generation=/);
});
