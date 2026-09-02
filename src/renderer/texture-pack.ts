/**
 * Prepares one immutable texture-pack generation and registers its exact
 * mappings with the shared texture-upload interceptor.
 */
import { parseTexturePackRuntimeManifest } from "../shared/texture-packs.js";
import { texmodHash, texmodRawHash, type AtlasTransform } from "./controller-prompt-texture.js";
import {
  installTextureUploadProvider,
  type ClientMemory,
  type TextureImports,
} from "./texture-upload-interceptor.js";

const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MODES: readonly AtlasTransform[] = ["direct", "swap-red-blue", "flip-y", "flip-y-swap-red-blue"];

interface PreparedEntry {
  readonly target: number;
  readonly width: number;
  readonly height: number;
  readonly levels: readonly Uint8Array[];
  readonly compressed?: Readonly<{
    mode: "DXT1" | "DXT3" | "DXT5";
    levels: readonly Uint8Array[];
  }>;
}

interface Match {
  readonly entry: PreparedEntry;
  readonly mode: AtlasTransform;
}

export interface InstalledTexturePack {
  readonly reset: () => void;
  readonly dispose: () => void;
  readonly snapshot: () => Readonly<{ mappings: number; matchedTextures: number; replacements: number }>;
}

export interface PreparedTexturePack {
  readonly install: (input: { imports: TextureImports; module: ClientMemory }) => InstalledTexturePack | null;
  readonly dispose: () => void;
}

function nextMip(source: Uint8Array, width: number, height: number): Uint8Array {
  const nextWidth = Math.max(1, width >> 1);
  const nextHeight = Math.max(1, height >> 1);
  const output = new Uint8Array(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y += 1) for (let x = 0; x < nextWidth; x += 1) {
    for (let component = 0; component < 4; component += 1) {
      let total = 0;
      for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
        const sourceX = Math.min(width - 1, x * 2 + dx);
        const sourceY = Math.min(height - 1, y * 2 + dy);
        total += source[(sourceY * width + sourceX) * 4 + component]!;
      }
      output[(y * nextWidth + x) * 4 + component] = Math.round(total / 4);
    }
  }
  return output;
}

function mipLevels(base: Uint8Array, width: number, height: number): readonly Uint8Array[] {
  const values = [base];
  while (width > 1 || height > 1) {
    values.push(nextMip(values.at(-1)!, width, height));
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  return values;
}

function transformed(bytes: Uint8Array, width: number, height: number, mode: AtlasTransform): Uint8Array {
  if (mode === "direct") return bytes;
  const output = new Uint8Array(bytes.byteLength);
  const flip = mode === "flip-y" || mode === "flip-y-swap-red-blue";
  const swap = mode === "swap-red-blue" || mode === "flip-y-swap-red-blue";
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = (y * width + x) * 4;
    const destination = ((flip ? height - 1 - y : y) * width + x) * 4;
    output[destination] = bytes[source + (swap ? 2 : 0)]!;
    output[destination + 1] = bytes[source + 1]!;
    output[destination + 2] = bytes[source + (swap ? 0 : 2)]!;
    output[destination + 3] = bytes[source + 3]!;
  }
  return output;
}

export async function prepareTexturePack(
  generation: string,
  log: (...values: unknown[]) => void,
): Promise<PreparedTexturePack | null> {
  if (!/^[0-9a-f]{32}$/u.test(generation)) return null;
  const root = new URL(`texture-packs/${generation}/`, document.baseURI);
  const [manifestResponse, textureResponse] = await Promise.all([
    fetch(new URL("manifest.json", root), { cache: "no-store" }),
    fetch(new URL("textures.rgba", root), { cache: "no-store" }),
  ]);
  if (!manifestResponse.ok || !textureResponse.ok) {
    log("[warn] selected texture pack is unavailable; using official textures");
    return null;
  }
  const pack = new Uint8Array(await textureResponse.arrayBuffer());
  if (pack.byteLength === 0 || pack.byteLength > MAX_PACK_BYTES) throw new Error("texture pack bytes are invalid");
  const manifest = parseTexturePackRuntimeManifest(await manifestResponse.json(), pack.byteLength);
  const entries: readonly PreparedEntry[] = manifest.entries.map((entry) => ({
    target: entry.target,
    width: entry.width,
    height: entry.height,
    levels: mipLevels(pack.slice(entry.offset, entry.offset + entry.length), entry.width, entry.height),
    ...(entry.compressed ? {
      compressed: {
        mode: entry.compressed.mode,
        levels: entry.compressed.levels.map((level) => pack.slice(level.offset, level.offset + level.length)),
      },
    } : {}),
  }));
  let installed: InstalledTexturePack | null = null;
  const reset = () => installed?.reset();
  addEventListener("gw:graphics-context-reset", reset);
  return Object.freeze({
    install: ({ imports, module }: { imports: TextureImports; module: ClientMemory }) => {
      installed?.dispose();
      installed = installTexturePack({ imports, module, entries, log });
      return installed;
    },
    dispose: () => {
      removeEventListener("gw:graphics-context-reset", reset);
      installed?.dispose();
      installed = null;
    },
  });
}

function compatibleCompressedFormat(mode: "DXT1" | "DXT3" | "DXT5", format: number): boolean {
  return mode === "DXT1" ? format === 0x83f0 || format === 0x83f1
    : mode === "DXT3" ? format === 0x83f2
      : format === 0x83f3;
}

export function installTexturePack({
  imports,
  module,
  entries,
  log,
}: {
  imports: TextureImports;
  module: ClientMemory;
  entries: readonly PreparedEntry[];
  log: (...values: unknown[]) => void;
}): InstalledTexturePack | null {
  const byTarget = new Map(entries.map((entry) => [entry.target, entry]));
  let replacements = 0;
  const installed = installTextureUploadProvider(imports, module, {
    id: "texture-pack",
    priority: 0,
    identifyRgba: (bytes, upload): Match | null => {
      for (const mode of MODES) {
        const entry = byTarget.get(texmodHash(bytes, upload.width, upload.height, mode));
        if (entry && entry.width === upload.width && entry.height === upload.height) return { entry, mode };
      }
      return null;
    },
    identifyCompressed: (bytes, upload): Match | null => {
      const entry = byTarget.get(texmodRawHash(bytes));
      return entry?.compressed && entry.width === upload.width && entry.height === upload.height
        ? { entry, mode: "direct" }
        : null;
    },
    rgbaReplacement: (value, level) => {
      const match = value as Match;
      const bytes = match.entry.levels[level];
      return bytes
        ? transformed(bytes, Math.max(1, match.entry.width >> level), Math.max(1, match.entry.height >> level), match.mode)
        : null;
    },
    compressedReplacement: (value, level, format) => {
      const match = value as Match;
      if (!match.entry.compressed || !compatibleCompressedFormat(match.entry.compressed.mode, format)) return null;
      return match.entry.compressed.levels[level] ?? null;
    },
    replaced: () => { replacements += 1; },
  });
  if (!installed) return null;
  log(`texture pack armed (${entries.length} exact TexMod mappings)`);
  return Object.freeze({
    reset: installed.reset,
    dispose: installed.dispose,
    snapshot: () => Object.freeze({
      mappings: entries.length,
      matchedTextures: installed.matchedTextures(),
      replacements,
    }),
  });
}
