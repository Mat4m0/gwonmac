/**
 * Decodes only the bounded DDS formats accepted from legacy TexMod packs.
 * Compressed source blocks remain available beside the safe RGBA fallback.
 */

export interface DecodedTexture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly compressed?: Readonly<{
    mode: "DXT1" | "DXT3" | "DXT5";
    levels: readonly Uint8Array[];
  }>;
}

const DDS_MAGIC = 0x20534444;
const DDPF_FOURCC = 0x4;
const MAX_DIMENSION = 4096;
const MAX_BYTES = 64 * 1024 * 1024;

function channel(value: number, mask: number): number {
  if (mask === 0) return 255;
  const shift = 31 - Math.clz32(mask & -mask);
  const maximum = mask >>> shift;
  return Math.round((((value & mask) >>> shift) * 255) / maximum);
}

function rgb565(value: number): readonly [number, number, number] {
  const red = (value >>> 11) & 31;
  const green = (value >>> 5) & 63;
  const blue = value & 31;
  return [(red << 3) | (red >>> 2), (green << 2) | (green >>> 4), (blue << 3) | (blue >>> 2)];
}

function colors(a: number, b: number, transparent: boolean): readonly (readonly number[])[] {
  const first = rgb565(a);
  const second = rgb565(b);
  const mix = (left: number, right: number, weight: number, divisor: number) =>
    Math.floor((left * weight + right * (divisor - weight)) / divisor);
  if (transparent && a <= b) {
    return [
      [...first, 255],
      [...second, 255],
      [mix(first[0], second[0], 1, 2), mix(first[1], second[1], 1, 2), mix(first[2], second[2], 1, 2), 255],
      [0, 0, 0, 0],
    ];
  }
  return [
    [...first, 255],
    [...second, 255],
    [mix(first[0], second[0], 2, 3), mix(first[1], second[1], 2, 3), mix(first[2], second[2], 2, 3), 255],
    [mix(first[0], second[0], 1, 3), mix(first[1], second[1], 1, 3), mix(first[2], second[2], 1, 3), 255],
  ];
}

function decodeDxt(source: Uint8Array, width: number, height: number, mode: "DXT1" | "DXT3" | "DXT5"): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const blockBytes = mode === "DXT1" ? 8 : 16;
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  if (source.byteLength < blocksWide * blocksHigh * blockBytes) throw new Error("DDS top mip is truncated");
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const offset = (blockY * blocksWide + blockX) * blockBytes;
      const colorOffset = offset + (mode === "DXT1" ? 0 : 8);
      const table = colors(view.getUint16(colorOffset, true), view.getUint16(colorOffset + 2, true), mode === "DXT1");
      const colorBits = view.getUint32(colorOffset + 4, true);
      let alphaTable: readonly number[] = [];
      let alphaBits = 0n;
      if (mode === "DXT5") {
        const a0 = source[offset]!;
        const a1 = source[offset + 1]!;
        const values = [a0, a1];
        const steps = a0 > a1 ? 7 : 5;
        for (let index = 1; index < steps; index += 1) values.push(Math.floor((a0 * (steps - index) + a1 * index) / steps));
        if (a0 <= a1) values.push(0, 255);
        alphaTable = values;
        for (let index = 0; index < 6; index += 1) alphaBits |= BigInt(source[offset + 2 + index]!) << BigInt(index * 8);
      }
      for (let pixel = 0; pixel < 16; pixel += 1) {
        const x = blockX * 4 + (pixel & 3);
        const y = blockY * 4 + (pixel >>> 2);
        if (x >= width || y >= height) continue;
        const selected = table[(colorBits >>> (pixel * 2)) & 3]!;
        const alpha = mode === "DXT1"
          ? selected[3]!
          : mode === "DXT3"
            ? ((source[offset + (pixel >>> 1)]! >>> ((pixel & 1) * 4)) & 15) * 17
            : alphaTable[Number((alphaBits >> BigInt(pixel * 3)) & 7n)]!;
        const target = (y * width + x) * 4;
        output.set([selected[0]!, selected[1]!, selected[2]!, alpha], target);
      }
    }
  }
  return output;
}

export function decodeDds(input: Uint8Array): DecodedTexture {
  if (input.byteLength < 128) throw new Error("DDS header is truncated");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, true) !== DDS_MAGIC || view.getUint32(4, true) !== 124 || view.getUint32(76, true) !== 32) {
    throw new Error("DDS header is invalid");
  }
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const rgbaBytes = width * height * 4;
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION || rgbaBytes > MAX_BYTES) {
    throw new Error("DDS dimensions are outside the supported range");
  }
  const source = input.subarray(128);
  if ((view.getUint32(80, true) & DDPF_FOURCC) !== 0) {
    const fourCc = String.fromCharCode(input[84]!, input[85]!, input[86]!, input[87]!);
    if (fourCc !== "DXT1" && fourCc !== "DXT3" && fourCc !== "DXT5") throw new Error(`unsupported DDS compression ${fourCc}`);
    const blockBytes = fourCc === "DXT1" ? 8 : 16;
    const declaredLevels = Math.max(1, view.getUint32(28, true));
    const maximumLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    if (declaredLevels > maximumLevels) throw new Error("DDS mip count is outside the supported range");
    const levels: Uint8Array[] = [];
    let cursor = 0;
    let levelWidth = width;
    let levelHeight = height;
    for (let level = 0; level < declaredLevels; level += 1) {
      const length = Math.ceil(levelWidth / 4) * Math.ceil(levelHeight / 4) * blockBytes;
      if (cursor > source.byteLength - length) throw new Error("DDS mip chain is truncated");
      levels.push(source.slice(cursor, cursor + length));
      cursor += length;
      levelWidth = Math.max(1, levelWidth >> 1);
      levelHeight = Math.max(1, levelHeight >> 1);
    }
    return {
      width,
      height,
      rgba: decodeDxt(levels[0]!, width, height, fourCc),
      compressed: { mode: fourCc, levels },
    };
  }
  const bits = view.getUint32(88, true);
  if (bits !== 8 && bits !== 16 && bits !== 32) throw new Error(`unsupported DDS pixel width ${bits}`);
  const bytesPerPixel = bits / 8;
  const tightPitch = width * bytesPerPixel;
  const declaredPitch = view.getUint32(20, true);
  const pitch = (view.getUint32(8, true) & 0x8) !== 0 && declaredPitch >= tightPitch ? declaredPitch : tightPitch;
  if (source.byteLength < pitch * height) throw new Error("DDS top mip is truncated");
  const masks = [view.getUint32(92, true), view.getUint32(96, true), view.getUint32(100, true), view.getUint32(104, true)] as const;
  const output = new Uint8Array(rgbaBytes);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * pitch + x * bytesPerPixel;
      const value = bytesPerPixel === 1
        ? source[offset]!
        : bytesPerPixel === 2
          ? new DataView(source.buffer, source.byteOffset + offset, 2).getUint16(0, true)
          : new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0, true);
      const target = (y * width + x) * 4;
      output[target] = channel(value, masks[0]);
      output[target + 1] = channel(value, masks[1]);
      output[target + 2] = channel(value, masks[2]);
      output[target + 3] = masks[3] === 0 ? 255 : channel(value, masks[3]);
    }
  }
  return { width, height, rgba: output };
}
