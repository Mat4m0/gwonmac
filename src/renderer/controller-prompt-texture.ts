/**
 * Owns the certified PlayStation prompt atlas and its high-priority exact
 * texture-upload provider. The shared interceptor owns WebGL patching.
 */
import {
  installTextureUploadProvider,
  type ClientMemory,
  type TextureImports,
  type TextureUpload,
} from "./texture-upload-interceptor.js";

const CONTROLLER_PROMPT_ATLAS_CERTIFICATIONS: Readonly<Record<number, AtlasTransform>> = Object.freeze({
  // The web renderer transposes/rebuilds texture uploads, so this differs
  // from the native TexMod checksum. See internal/upstream/controller-prompt-atlas.md.
  [0x74eb6846]: "direct",
});
const ATLAS_WIDTH = 256;
const ATLAS_HEIGHT = 512;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;

export type AtlasTransform = "direct" | "flip-y" | "swap-red-blue" | "flip-y-swap-red-blue";

export interface ControllerPromptAtlas {
  readonly width: typeof ATLAS_WIDTH;
  readonly height: typeof ATLAS_HEIGHT;
  readonly levels: readonly Uint8Array[];
}

export interface AtlasUploadCandidate {
  readonly kind: TextureUpload["kind"];
  readonly target: number;
  readonly level: number;
  readonly internalFormat?: number;
  readonly width: number;
  readonly height: number;
  readonly format?: number;
  readonly type?: number;
  readonly imageBytes: number;
  readonly pointerValid: boolean;
  readonly hashes?: Readonly<Record<AtlasTransform, string>>;
}

export interface ControllerPromptTextureStats {
  readonly replacements: number;
  readonly matchedTextures: number;
  readonly candidates: readonly AtlasUploadCandidate[];
}

export interface InstalledControllerPromptTexture {
  readonly reset: () => void;
  readonly dispose: () => void;
  readonly snapshot: () => ControllerPromptTextureStats;
}

export interface PreparedControllerPrompts {
  readonly install: (input: { imports: TextureImports; module: ClientMemory }) => InstalledControllerPromptTexture | null;
  readonly dispose: () => void;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

/** uMod uses CRC-32's running value without the conventional final XOR. */
export function texmodHash(
  bytes: Uint8Array,
  width = ATLAS_WIDTH,
  height = ATLAS_HEIGHT,
  transform: AtlasTransform = "direct",
): number {
  if (bytes.byteLength !== width * height * 4) return 0;
  return texmodRawHash(transform === "direct" ? bytes : transformed(bytes, width, height, transform));
}

/** TexMod's checksum over the exact D3D payload, including compressed blocks. */
export function texmodRawHash(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 0xff]! ^ (crc >>> 8);
  return crc >>> 0;
}

export function certifiedWebGlAtlasTransform(hash: number): AtlasTransform | null {
  return CONTROLLER_PROMPT_ATLAS_CERTIFICATIONS[hash] ?? null;
}

export function identifyControllerPromptAtlas(bytes: Uint8Array): AtlasTransform | null {
  return certifiedWebGlAtlasTransform(texmodHash(bytes));
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

export function createControllerPromptAtlas(levelZero: Uint8Array): ControllerPromptAtlas {
  if (levelZero.byteLength !== ATLAS_WIDTH * ATLAS_HEIGHT * 4) {
    throw new Error("PlayStation controller atlas must be exactly 256×512 RGBA");
  }
  const levels = [levelZero];
  let width = ATLAS_WIDTH;
  let height = ATLAS_HEIGHT;
  while (width > 1 || height > 1) {
    levels.push(nextMip(levels.at(-1)!, width, height));
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  return Object.freeze({ width: ATLAS_WIDTH, height: ATLAS_HEIGHT, levels });
}

export async function loadPlayStationControllerPromptAtlas(
  source = new URL("images/playstation-controller-prompts.png", document.baseURI).href,
): Promise<ControllerPromptAtlas> {
  const image = new Image();
  image.decoding = "sync";
  image.src = source;
  await image.decode();
  if (image.naturalWidth !== ATLAS_WIDTH || image.naturalHeight !== ATLAS_HEIGHT) {
    throw new Error(`controller atlas is ${image.naturalWidth}×${image.naturalHeight}, expected 256×512`);
  }
  const canvas = new OffscreenCanvas(ATLAS_WIDTH, ATLAS_HEIGHT);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("controller atlas canvas is unavailable");
  context.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  context.drawImage(image, 0, 0);
  return createControllerPromptAtlas(new Uint8Array(context.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data));
}

function atlasHashes(bytes: Uint8Array, width: number, height: number): Readonly<Record<AtlasTransform, string>> {
  const hash = (mode: AtlasTransform) => `0x${texmodHash(bytes, width, height, mode).toString(16).padStart(8, "0")}`;
  return Object.freeze({
    direct: hash("direct"),
    "flip-y": hash("flip-y"),
    "swap-red-blue": hash("swap-red-blue"),
    "flip-y-swap-red-blue": hash("flip-y-swap-red-blue"),
  });
}

export async function preparePlayStationControllerPrompts({
  diagnostics,
  log,
}: {
  diagnostics: boolean;
  log: (...values: unknown[]) => void;
}): Promise<PreparedControllerPrompts> {
  const atlas = await loadPlayStationControllerPromptAtlas();
  let installed: InstalledControllerPromptTexture | null = null;
  const reset = () => installed?.reset();
  addEventListener("gw:graphics-context-reset", reset);
  return Object.freeze({
    install: ({ imports, module }: { imports: TextureImports; module: ClientMemory }) => {
      installed?.dispose();
      installed = installControllerPromptTexture({ imports, module, atlas, diagnostics, log });
      return installed;
    },
    dispose: () => {
      removeEventListener("gw:graphics-context-reset", reset);
      installed?.dispose();
      installed = null;
    },
  });
}

/** Registers the controller provider above ordinary texture packs. */
export function installControllerPromptTexture({
  imports,
  module,
  atlas,
  identify = identifyControllerPromptAtlas,
  diagnostics = false,
  log,
}: {
  imports: TextureImports;
  module: ClientMemory;
  atlas: ControllerPromptAtlas;
  identify?: (bytes: Uint8Array) => AtlasTransform | null;
  diagnostics?: boolean;
  log: (...values: unknown[]) => void;
}): InstalledControllerPromptTexture | null {
  let replacements = 0;
  const candidates: AtlasUploadCandidate[] = [];
  const transformedLevels = new Map<AtlasTransform, readonly Uint8Array[]>();
  const replacement = (mode: AtlasTransform, level: number): Uint8Array | null => {
    let levels = transformedLevels.get(mode);
    if (!levels) {
      levels = atlas.levels.map((bytes, index) => transformed(
        bytes,
        Math.max(1, atlas.width >> index),
        Math.max(1, atlas.height >> index),
        mode,
      ));
      transformedLevels.set(mode, levels);
    }
    return levels[level] ?? null;
  };
  const installed = installTextureUploadProvider(imports, module, {
    id: "controller-prompts",
    priority: 100,
    observe: (upload, bytes) => {
      if (!diagnostics || upload.level !== 0 || upload.width * upload.height !== ATLAS_WIDTH * ATLAS_HEIGHT) return;
      const { pointer: _pointer, ...fields } = upload;
      const candidate: AtlasUploadCandidate = {
        ...fields,
        pointerValid: bytes !== null,
        ...(bytes && upload.imageBytes === upload.width * upload.height * 4
          ? { hashes: atlasHashes(bytes, upload.width, upload.height) }
          : {}),
      };
      const key = JSON.stringify(candidate);
      if (candidates.some((existing) => JSON.stringify(existing) === key)) return;
      if (candidates.length === 16) candidates.shift();
      candidates.push(Object.freeze(candidate));
    },
    identifyRgba: (bytes, upload) => {
      if (upload.width !== ATLAS_WIDTH || upload.height !== ATLAS_HEIGHT
        || upload.format !== GL_RGBA || upload.type !== GL_UNSIGNED_BYTE) return null;
      return identify(bytes);
    },
    rgbaReplacement: (match, level) => replacement(match as AtlasTransform, level),
    replaced: () => { replacements += 1; },
  });
  if (!installed) {
    log("[warn] PlayStation controller symbols unavailable — texture upload import missing");
    return null;
  }
  log("PlayStation controller-symbol substitution armed for the certified Guild Wars atlas");
  return Object.freeze({
    reset: installed.reset,
    dispose: installed.dispose,
    snapshot: (): ControllerPromptTextureStats => Object.freeze({
      replacements,
      matchedTextures: installed.matchedTextures(),
      candidates: Object.freeze([...candidates]),
    }),
  });
}
