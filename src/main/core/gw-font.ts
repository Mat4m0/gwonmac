/**
 * The original Guild Wars Latin UI face, converted from the player's archive.
 *
 * Guild Wars stores one bitmap strike per character range. File 123027 is its
 * hand-tuned 24-pixel Latin body strike: 94 glyphs in ASCII order (`!` through
 * `~`). It matches the physical size of GWonMac's interface on a Retina
 * display; scaling the 52-pixel title strike down lost the weight and spacing
 * visible in the real game, while doubling the 14-pixel strike looked blocky.
 * Every boundary below validates the local data before it becomes a browser
 * font. No game bytes or generated font ship with GWonMac.
 *
 * The range is a low-nibble-first stream. Each glyph starts with top inset,
 * width, height and alpha mode, followed by palette or alternating runs. The
 * converter traces the high-resolution bitmap into a small TrueType `glyf`
 * font. Chromium can then use it through an ordinary `FontFace`, while glyphs
 * outside basic ASCII fall through to the existing serif stack.
 */

export const GUILD_WARS_LATIN_FONT_FILE_ID = 123027;

const ALPHA = Uint8Array.of(
  0x00, 0x66, 0x79, 0x8d, 0x97, 0xa5, 0xaf, 0xbd,
  0xc6, 0xce, 0xd6, 0xde, 0xe7, 0xef, 0xf7, 0xff,
);
const FIRST_CHARACTER = 0x21;
const LAST_CHARACTER = 0x7e;
const SOURCE_EM = 24;
const SOURCE_BASELINE = 18;
const SOURCE_LINE_HEIGHT = 25;
const SOURCE_SPACE_WIDTH = 6;
const UNITS_PER_EM = 1024;
const OUTLINE_THRESHOLD = 0x80;
const OUTLINE_SAMPLE_SCALE = 4;

export interface GameGlyph {
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

class Nibbles {
  private at = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  read(): number {
    const byte = this.bytes[this.at >> 1];
    if (byte === undefined) throw new Error("font glyph ended inside a nibble");
    const value = (this.at & 1) === 0 ? byte & 0x0f : byte >>> 4;
    this.at += 1;
    return value;
  }

  /** Three data bits, then one or three extension nibbles. */
  value(): number {
    const first = this.read();
    if (first < 8) return first;
    const low = first & 7;
    const middle = this.read();
    if (middle < 15) return low | (middle << 3);
    return low | (this.read() << 3) | (this.read() << 7);
  }

  run(): number {
    let part = this.read();
    if (part < 15) return part + 1;
    let length = 16;
    do {
      part = this.read();
      length += part;
    } while (part === 15);
    return length;
  }

  get bytesRead(): number {
    return (this.at + 1) >> 1;
  }
}

function decodeGlyph(source: Uint8Array): { glyph: GameGlyph; bytes: number } {
  const input = new Nibbles(source);
  const top = input.value();
  const width = input.value() + 1;
  const height = input.value() + 1;
  const mode = input.read();
  const pixelCount = width * height;
  if (width > 256 || height > 256 || pixelCount > 65_536) {
    throw new Error("font glyph dimensions exceed their bound");
  }

  const pixels = new Uint8Array(pixelCount);
  let written = 0;
  let alpha = ALPHA[mode]!;
  while (written < pixelCount) {
    let length: number;
    if (mode === 0 || mode === 15) {
      alpha ^= 0xff;
      length = input.run();
    } else {
      const value = input.read();
      alpha = ALPHA[value]!;
      length = value === 0 || value === 15 ? input.run() : 1;
    }
    if (length > pixelCount - written) {
      throw new Error("font glyph run exceeds its bitmap");
    }
    pixels.fill(alpha, written, written + length);
    written += length;
  }
  return { glyph: { top, width, height, pixels }, bytes: input.bytesRead };
}

export function decodeGameFontRange(bytes: Uint8Array): readonly GameGlyph[] {
  const glyphs: GameGlyph[] = [];
  let at = 0;
  while (at < bytes.byteLength) {
    const decoded = decodeGlyph(bytes.subarray(at));
    if (decoded.bytes <= 0 || at + decoded.bytes > bytes.byteLength) {
      throw new Error("font glyph length is invalid");
    }
    glyphs.push(decoded.glyph);
    at += decoded.bytes;
  }
  const expected = LAST_CHARACTER - FIRST_CHARACTER + 1;
  if (glyphs.length !== expected) {
    throw new Error(`font range has ${glyphs.length} glyphs instead of ${expected}`);
  }
  return glyphs;
}

const align4 = (value: number): number => (value + 3) & ~3;

function u16(value: number): Buffer {
  const out = Buffer.allocUnsafe(2);
  out.writeUInt16BE(value & 0xffff);
  return out;
}

function i16(value: number): Buffer {
  const out = Buffer.allocUnsafe(2);
  out.writeInt16BE(value);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32BE(value >>> 0);
  return out;
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let at = 0; at < align4(bytes.byteLength); at += 4) {
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

interface Rectangle {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  bottom: number;
}

interface HorizontalMetrics {
  readonly advance: number;
  readonly shift: number;
}

function interpolatedAlpha(glyph: GameGlyph, x: number, y: number): number {
  const sourceX = (x + 0.5) / OUTLINE_SAMPLE_SCALE - 0.5;
  const sourceY = (y + 0.5) / OUTLINE_SAMPLE_SCALE - 0.5;
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const xBlend = sourceX - left;
  const yBlend = sourceY - top;
  const pixel = (pixelX: number, pixelY: number): number =>
    pixelX < 0
      || pixelY < 0
      || pixelX >= glyph.width
      || pixelY >= glyph.height
      ? 0
      : glyph.pixels[pixelY * glyph.width + pixelX]!;
  const upper = pixel(left, top) * (1 - xBlend)
    + pixel(left + 1, top) * xBlend;
  const lower = pixel(left, top + 1) * (1 - xBlend)
    + pixel(left + 1, top + 1) * xBlend;
  return upper * (1 - yBlend) + lower * yBlend;
}

/**
 * Trace the game's grayscale mask on a quarter-pixel grid, then merge equal
 * horizontal runs into outline rectangles. The interpolation retains where a
 * soft edge crosses half opacity; tracing the source pixels directly produced
 * the visibly stepped curves the bitmap's alpha levels were meant to hide.
 */
function bitmapRectangles(glyph: GameGlyph): readonly Rectangle[] {
  const complete: Rectangle[] = [];
  let active = new Map<string, Rectangle>();
  const width = glyph.width * OUTLINE_SAMPLE_SCALE;
  const height = glyph.height * OUTLINE_SAMPLE_SCALE;
  for (let y = 0; y < height; y++) {
    const next = new Map<string, Rectangle>();
    for (let x = 0; x < width;) {
      if (interpolatedAlpha(glyph, x, y) < OUTLINE_THRESHOLD) {
        x += 1;
        continue;
      }
      const left = x;
      while (
        x < width
        && interpolatedAlpha(glyph, x, y) >= OUTLINE_THRESHOLD
      ) x += 1;
      const key = `${left}:${x}`;
      const rectangle = active.get(key) ?? {
        left: left / OUTLINE_SAMPLE_SCALE,
        right: x / OUTLINE_SAMPLE_SCALE,
        top: y / OUTLINE_SAMPLE_SCALE,
        bottom: y / OUTLINE_SAMPLE_SCALE,
      };
      rectangle.bottom = (y + 1) / OUTLINE_SAMPLE_SCALE;
      next.set(key, rectangle);
      active.delete(key);
    }
    complete.push(...active.values());
    active = next;
  }
  complete.push(...active.values());
  return complete;
}

/**
 * The source gives every digit the same cell so game counters line up. Its
 * narrow `1` consequently carries very wide blank sides and reads like a word
 * space in ordinary interface copy. Preserve every ink pixel, but give the ten
 * digits balanced two-pixel side bearings for proportional UI text. Wide
 * digits keep the original cell rather than growing past it.
 */
function horizontalMetrics(glyph: GameGlyph, character: number): HorizontalMetrics {
  if (character < 0x30 || character > 0x39) {
    return { advance: glyph.width, shift: 0 };
  }
  const rectangles = bitmapRectangles(glyph);
  if (rectangles.length === 0) return { advance: glyph.width, shift: 0 };
  const inkLeft = Math.min(...rectangles.map(({ left }) => left));
  const inkRight = Math.max(...rectangles.map(({ right }) => right));
  const inkWidth = inkRight - inkLeft;
  const advance = Math.min(glyph.width, inkWidth + 4);
  const shift = (advance - inkWidth) / 2 - inkLeft;
  return { advance, shift };
}

function trueTypeGlyph(glyph: GameGlyph, horizontalShift: number): Buffer {
  const scale = UNITS_PER_EM / SOURCE_EM;
  const rectangles = bitmapRectangles(glyph);
  if (rectangles.length === 0) return Buffer.alloc(10);
  const points = rectangles.flatMap((rectangle) => {
    const left = Math.round((rectangle.left + horizontalShift) * scale);
    const right = Math.round((rectangle.right + horizontalShift) * scale);
    const top = Math.round((SOURCE_BASELINE - glyph.top - rectangle.top) * scale);
    const bottom = Math.round(
      (SOURCE_BASELINE - glyph.top - rectangle.bottom) * scale,
    );
    return [[left, top], [right, top], [right, bottom], [left, bottom]] as const;
  });
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const header = Buffer.concat([
    i16(rectangles.length),
    i16(Math.min(...xs)),
    i16(Math.min(...ys)),
    i16(Math.max(...xs)),
    i16(Math.max(...ys)),
  ]);
  const ends = Buffer.concat(rectangles.map((_, index) => u16(index * 4 + 3)));
  const flags = Buffer.alloc(points.length, 1);
  let previousX = 0;
  let previousY = 0;
  const xCoordinates: Buffer[] = [];
  const yCoordinates: Buffer[] = [];
  for (const [x, y] of points) {
    xCoordinates.push(i16(x - previousX));
    yCoordinates.push(i16(y - previousY));
    previousX = x;
    previousY = y;
  }
  const out = Buffer.concat([
    header,
    ends,
    u16(0),
    flags,
    ...xCoordinates,
    ...yCoordinates,
  ]);
  return out.byteLength % 2 === 0 ? out : Buffer.concat([out, Buffer.alloc(1)]);
}

function cmapTable(): Buffer {
  const segmentCount = 2;
  const format4 = Buffer.concat([
    u16(4), u16(32), u16(0),
    u16(segmentCount * 2), u16(4), u16(1), u16(0),
    u16(LAST_CHARACTER), u16(0xffff),
    u16(0),
    u16(0x20), u16(0xffff),
    i16(1 - 0x20), i16(1),
    u16(0), u16(0),
  ]);
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), format4]);
}

function nameTable(): Buffer {
  const names = new Map<number, string>([
    [1, "Guild Wars Original"],
    [2, "Regular"],
    [3, "Guild Wars Original; locally converted by GWonMac"],
    [4, "Guild Wars Original Regular"],
    [5, "Version 1.0"],
    [6, "GuildWarsOriginal-Regular"],
    [8, "Converted locally by GWonMac"],
    [9, "ArenaNet"],
  ]);
  const records: Buffer[] = [];
  const strings: Buffer[] = [];
  let offset = 0;
  for (const [nameId, text] of names) {
    const encoded = Buffer.from(text, "utf16le");
    encoded.swap16();
    records.push(Buffer.concat([
      u16(3), u16(1), u16(0x0409), u16(nameId),
      u16(encoded.byteLength), u16(offset),
    ]));
    strings.push(encoded);
    offset += encoded.byteLength;
  }
  return Buffer.concat([
    u16(0), u16(records.length), u16(6 + records.length * 12),
    ...records,
    ...strings,
  ]);
}

function os2Table(advances: readonly number[]): Buffer {
  const scale = UNITS_PER_EM / SOURCE_EM;
  const out = Buffer.alloc(78);
  out.writeUInt16BE(0, 0);
  out.writeInt16BE(Math.round(advances.reduce((a, b) => a + b, 0) / advances.length), 2);
  out.writeUInt16BE(500, 4);
  out.writeUInt16BE(5, 6);
  // Restricted embedding: this derivative is for the player's local UI only.
  out.writeUInt16BE(2, 8);
  out.writeInt16BE(650, 10);
  out.writeInt16BE(600, 12);
  out.writeInt16BE(0, 14);
  out.writeInt16BE(75, 16);
  out.writeInt16BE(650, 18);
  out.writeInt16BE(600, 20);
  out.writeInt16BE(0, 22);
  out.writeInt16BE(350, 24);
  out.writeInt16BE(50, 26);
  out.writeInt16BE(300, 28);
  out[32] = 2;
  out[33] = 2;
  out.writeUInt32BE(1, 42);
  out.write("GWoM", 58, "ascii");
  out.writeUInt16BE(0x40, 62);
  out.writeUInt16BE(0x20, 64);
  out.writeUInt16BE(LAST_CHARACTER, 66);
  out.writeInt16BE(Math.round(SOURCE_BASELINE * scale), 68);
  out.writeInt16BE(Math.round((SOURCE_BASELINE - SOURCE_EM) * scale), 70);
  out.writeInt16BE(Math.round((SOURCE_LINE_HEIGHT - SOURCE_EM) * scale), 72);
  out.writeUInt16BE(Math.round(SOURCE_BASELINE * scale), 74);
  out.writeUInt16BE(Math.round((SOURCE_EM - SOURCE_BASELINE) * scale), 76);
  return out;
}

/** Build a standards-compliant TrueType font from the 24px body strike. */
export function buildGuildWarsTrueType(source: Uint8Array): Buffer {
  const glyphs = decodeGameFontRange(source);
  const sourceGlyphs: readonly (GameGlyph | null)[] = [null, null, ...glyphs];
  const metrics = sourceGlyphs.map((glyph, glyphId) =>
    glyph
      ? horizontalMetrics(glyph, glyphId + FIRST_CHARACTER - 2)
      : { advance: SOURCE_SPACE_WIDTH, shift: 0 });
  const glyfParts = sourceGlyphs.map((glyph, glyphId) =>
    glyph ? trueTypeGlyph(glyph, metrics[glyphId]!.shift) : Buffer.alloc(10));
  const loca: number[] = [0];
  let glyfLength = 0;
  for (const glyph of glyfParts) {
    glyfLength += glyph.byteLength;
    loca.push(glyfLength);
  }
  const advances = metrics.map(({ advance }) =>
    Math.max(1, Math.round(advance * UNITS_PER_EM / SOURCE_EM)));
  const maxRectangles = Math.max(0, ...glyphs.map((glyph) => bitmapRectangles(glyph).length));
  const ascent = Math.round(SOURCE_BASELINE * UNITS_PER_EM / SOURCE_EM);
  const descent = Math.round((SOURCE_BASELINE - SOURCE_EM) * UNITS_PER_EM / SOURCE_EM);
  const lineGap = Math.round((SOURCE_LINE_HEIGHT - SOURCE_EM) * UNITS_PER_EM / SOURCE_EM);

  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(3, 16);
  head.writeUInt16BE(UNITS_PER_EM, 18);
  head.writeInt16BE(descent, 38);
  head.writeInt16BE(UNITS_PER_EM, 40);
  head.writeInt16BE(ascent, 42);
  head.writeUInt16BE(0, 44);
  head.writeUInt16BE(8, 46);
  head.writeInt16BE(2, 48);
  head.writeInt16BE(1, 50);

  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0);
  hhea.writeInt16BE(ascent, 4);
  hhea.writeInt16BE(descent, 6);
  hhea.writeInt16BE(lineGap, 8);
  hhea.writeUInt16BE(Math.max(...advances), 10);
  hhea.writeInt16BE(0, 12);
  hhea.writeInt16BE(0, 14);
  hhea.writeInt16BE(Math.max(...advances), 16);
  hhea.writeInt16BE(1, 18);
  hhea.writeInt16BE(0, 20);
  hhea.writeUInt16BE(sourceGlyphs.length, 34);

  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x00010000, 0);
  maxp.writeUInt16BE(sourceGlyphs.length, 4);
  maxp.writeUInt16BE(maxRectangles * 4, 6);
  maxp.writeUInt16BE(maxRectangles, 8);
  maxp.writeUInt16BE(2, 14);

  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0);
  post.writeInt16BE(-100, 8);
  post.writeInt16BE(50, 10);

  const tables = new Map<string, Buffer>([
    ["OS/2", os2Table(advances)],
    ["cmap", cmapTable()],
    ["glyf", Buffer.concat(glyfParts)],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", Buffer.concat(advances.map((advance) => Buffer.concat([u16(advance), i16(0)])))],
    ["loca", Buffer.concat(loca.map(u32))],
    ["maxp", maxp],
    ["name", nameTable()],
    ["post", post],
  ]);
  const entries = [...tables].sort(([a], [b]) => a.localeCompare(b));
  const tableCount = entries.length;
  const power = 2 ** Math.floor(Math.log2(tableCount));
  const header = Buffer.concat([
    u32(0x00010000), u16(tableCount), u16(power * 16),
    u16(Math.log2(power)), u16(tableCount * 16 - power * 16),
  ]);
  const directory = Buffer.alloc(tableCount * 16);
  const bodies: Buffer[] = [];
  let offset = header.byteLength + directory.byteLength;
  let headOffset = 0;
  entries.forEach(([tag, table], index) => {
    const at = index * 16;
    directory.write(tag, at, 4, "ascii");
    directory.writeUInt32BE(checksum(table), at + 4);
    directory.writeUInt32BE(offset, at + 8);
    directory.writeUInt32BE(table.byteLength, at + 12);
    if (tag === "head") headOffset = offset;
    const padded = Buffer.alloc(align4(table.byteLength));
    table.copy(padded);
    bodies.push(padded);
    offset += padded.byteLength;
  });
  const font = Buffer.concat([header, directory, ...bodies]);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}
