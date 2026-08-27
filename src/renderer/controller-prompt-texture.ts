/**
 * Replaces one certified Guild Wars controller-prompt atlas at its existing
 * Emscripten WebGL upload boundary. Matching is by the atlas' certified
 * content checksum, never by dimensions or the surrounding client build. The
 * game's bytes are put back immediately after the synchronous upload, and
 * every mismatch is an unchanged pass-through.
 */

// Exact evidence and the recertification procedure live in
// internal/upstream/controller-prompt-atlas.md.
const CONTROLLER_PROMPT_ATLAS_CERTIFICATIONS: Readonly<Record<number, AtlasTransform>> =
  Object.freeze({
    // The web renderer transposes/rebuilds texture uploads, so this RGBA
    // checksum differs from the native TexMod checksum.
    [0x74eb6846]: "direct",
  });
const ATLAS_WIDTH = 256;
const ATLAS_HEIGHT = 512;
const GL_TEXTURE_2D = 0x0de1;
const GL_RGBA = 0x1908;
const GL_RGBA8 = 0x8058;
const GL_UNSIGNED_BYTE = 0x1401;
const MAX_TEXTURE_IDS_PER_CALL = 4096;

type Upload = (
  target: number,
  level: number,
  internalFormat: number,
  width: number,
  height: number,
  border: number,
  format: number,
  type: number,
  pixels: number,
) => unknown;

type SubUpload = (
  target: number,
  level: number,
  x: number,
  y: number,
  width: number,
  height: number,
  format: number,
  type: number,
  pixels: number,
) => unknown;

type TextureImports = {
  env?: {
    glBindTexture?: (target: number, texture: number) => unknown;
    glDeleteTextures?: (count: number, textures: number) => unknown;
    glTexStorage2D?: (
      target: number,
      levels: number,
      internalFormat: number,
      width: number,
      height: number,
    ) => unknown;
    glTexImage2D?: Upload;
    glTexSubImage2D?: SubUpload;
    glCompressedTexImage2D?: (
      target: number,
      level: number,
      internalFormat: number,
      width: number,
      height: number,
      border: number,
      imageBytes: number,
      data: number,
    ) => unknown;
    glCompressedTexSubImage2D?: (
      target: number,
      level: number,
      x: number,
      y: number,
      width: number,
      height: number,
      format: number,
      imageBytes: number,
      data: number,
    ) => unknown;
  };
};

type ClientMemory = { HEAPU8?: Uint8Array };

export type AtlasTransform = "direct" | "flip-y" | "swap-red-blue" | "flip-y-swap-red-blue";

export interface ControllerPromptAtlas {
  readonly width: typeof ATLAS_WIDTH;
  readonly height: typeof ATLAS_HEIGHT;
  readonly levels: readonly Uint8Array[];
}

export interface AtlasUploadCandidate {
  readonly kind: "image" | "sub-image" | "compressed-image" | "compressed-sub-image";
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
  readonly snapshot: () => ControllerPromptTextureStats;
}

export interface PreparedControllerPrompts {
  readonly install: (input: {
    imports: TextureImports;
    module: ClientMemory;
  }) => InstalledControllerPromptTexture | null;
  readonly dispose: () => void;
}

function diagnosticUploadBytes(format: number, type: number, width: number, height: number) {
  if (type !== GL_UNSIGNED_BYTE) return 0;
  const components = format === 0x1903 ? 1
    : format === 0x8227 ? 2
    : format === 0x1907 ? 3
    : format === GL_RGBA || format === 0x80e1 ? 4
    : 0;
  return width * height * components;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
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
  const flip = transform === "flip-y" || transform === "flip-y-swap-red-blue";
  const swap = transform === "swap-red-blue" || transform === "flip-y-swap-red-blue";
  let crc = 0xffffffff;
  const update = (value: number) => {
    crc = CRC_TABLE[(crc ^ value) & 0xff]! ^ (crc >>> 8);
  };
  for (let y = 0; y < height; y++) {
    const sourceY = flip ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const pixel = (sourceY * width + x) * 4;
      update(bytes[pixel + (swap ? 2 : 0)]!);
      update(bytes[pixel + 1]!);
      update(bytes[pixel + (swap ? 0 : 2)]!);
      update(bytes[pixel + 3]!);
    }
  }
  return crc >>> 0;
}

export function certifiedWebGlAtlasTransform(hash: number): AtlasTransform | null {
  return CONTROLLER_PROMPT_ATLAS_CERTIFICATIONS[hash] ?? null;
}

export function identifyControllerPromptAtlas(bytes: Uint8Array): AtlasTransform | null {
  return certifiedWebGlAtlasTransform(texmodHash(bytes));
}

function atlasHashes(bytes: Uint8Array, width: number, height: number) {
  const hash = (mode: AtlasTransform) =>
    `0x${texmodHash(bytes, width, height, mode).toString(16).padStart(8, "0")}`;
  return Object.freeze({
    direct: hash("direct"),
    "flip-y": hash("flip-y"),
    "swap-red-blue": hash("swap-red-blue"),
    "flip-y-swap-red-blue": hash("flip-y-swap-red-blue"),
  });
}

function transformed(bytes: Uint8Array, width: number, height: number, mode: AtlasTransform) {
  if (mode === "direct") return bytes;
  const output = new Uint8Array(bytes.byteLength);
  const flip = mode === "flip-y" || mode === "flip-y-swap-red-blue";
  const swap = mode === "swap-red-blue" || mode === "flip-y-swap-red-blue";
  for (let y = 0; y < height; y++) {
    const destinationY = flip ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const destination = (destinationY * width + x) * 4;
      output[destination] = bytes[source + (swap ? 2 : 0)]!;
      output[destination + 1] = bytes[source + 1]!;
      output[destination + 2] = bytes[source + (swap ? 0 : 2)]!;
      output[destination + 3] = bytes[source + 3]!;
    }
  }
  return output;
}

function nextMip(source: Uint8Array, width: number, height: number): Uint8Array {
  const nextWidth = Math.max(1, width >> 1);
  const nextHeight = Math.max(1, height >> 1);
  const output = new Uint8Array(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      for (let component = 0; component < 4; component++) {
        let total = 0;
        let samples = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sourceX = Math.min(width - 1, x * 2 + dx);
            const sourceY = Math.min(height - 1, y * 2 + dy);
            total += source[(sourceY * width + sourceX) * 4 + component]!;
            samples++;
          }
        }
        output[(y * nextWidth + x) * 4 + component] = Math.round(total / samples);
      }
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
    throw new Error(
      `controller atlas is ${image.naturalWidth}×${image.naturalHeight}, expected 256×512`,
    );
  }
  const canvas = new OffscreenCanvas(ATLAS_WIDTH, ATLAS_HEIGHT);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("controller atlas canvas is unavailable");
  context.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  context.drawImage(image, 0, 0);
  return createControllerPromptAtlas(
    new Uint8Array(context.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data),
  );
}

function validRange(heap: Uint8Array | undefined, pointer: number, length: number) {
  return heap !== undefined
    && Number.isSafeInteger(pointer)
    && Number.isSafeInteger(length)
    && pointer > 0
    && length >= 0
    && pointer <= heap.byteLength - length;
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
    install: ({ imports, module }: {
      imports: TextureImports;
      module: ClientMemory;
    }) => {
      installed?.reset();
      installed = installControllerPromptTexture({
        imports,
        module,
        atlas,
        diagnostics,
        log,
      });
      return installed;
    },
    dispose: () => {
      removeEventListener("gw:graphics-context-reset", reset);
      installed?.reset();
      installed = null;
    },
  });
}

/** Installs the exact, removable substitution for this launch. */
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
}) {
  const env = imports.env;
  if (!env || typeof env.glTexImage2D !== "function") {
    log("[warn] PlayStation controller symbols unavailable — texture upload import missing");
    return null;
  }

  const bindings = new Map<number, number>();
  const matchedTextures = new Map<number, AtlasTransform>();
  const replacementLevels = new Map<AtlasTransform, readonly Uint8Array[]>();
  let replacements = 0;
  const candidates: AtlasUploadCandidate[] = [];

  const observeCandidate = (candidate: Omit<AtlasUploadCandidate, "pointerValid" | "hashes"> & {
    pointer: number;
  }) => {
    if (!diagnostics || candidate.level !== 0 || candidate.width * candidate.height !== ATLAS_WIDTH * ATLAS_HEIGHT) {
      return;
    }
    const heap = module.HEAPU8;
    const pointerValid = validRange(heap, candidate.pointer, candidate.imageBytes);
    const bytes = pointerValid && heap
      ? heap.subarray(candidate.pointer, candidate.pointer + candidate.imageBytes)
      : null;
    const hashes = bytes && candidate.imageBytes === candidate.width * candidate.height * 4
      ? atlasHashes(bytes, candidate.width, candidate.height)
      : undefined;
    const { pointer: _pointer, ...publicFields } = candidate;
    const record: AtlasUploadCandidate = {
      ...publicFields,
      pointerValid,
      ...(hashes ? { hashes } : {}),
    };
    const key = JSON.stringify(record);
    if (candidates.some((existing) => JSON.stringify(existing) === key)) return;
    if (candidates.length === 16) candidates.shift();
    candidates.push(Object.freeze(record));
  };

  const replacement = (mode: AtlasTransform, level: number) => {
    let levels = replacementLevels.get(mode);
    if (!levels) {
      levels = atlas.levels.map((bytes, index) =>
        transformed(
          bytes,
          Math.max(1, atlas.width >> index),
          Math.max(1, atlas.height >> index),
          mode,
        )
      );
      replacementLevels.set(mode, levels);
    }
    return levels[level] ?? null;
  };

  const substitute = <Result>(
    pointer: number,
    bytes: Uint8Array,
    call: () => Result,
  ): Result => {
    const heap = module.HEAPU8;
    if (!heap || !validRange(heap, pointer, bytes.byteLength)) return call();
    const original = heap.slice(pointer, pointer + bytes.byteLength);
    heap.set(bytes, pointer);
    try {
      const result = call();
      replacements++;
      return result;
    } finally {
      heap.set(original, pointer);
    }
  };

  const bindTexture = env.glBindTexture;
  if (typeof bindTexture === "function") {
    env.glBindTexture = function (this: unknown, target, texture) {
      const result = bindTexture.call(this, target, texture);
      if (target === GL_TEXTURE_2D) bindings.set(target, texture);
      return result;
    };
  }

  const deleteTextures = env.glDeleteTextures;
  if (typeof deleteTextures === "function") {
    env.glDeleteTextures = function (this: unknown, count, pointer) {
      const heap = module.HEAPU8;
      const validCount = Number.isSafeInteger(count) && count >= 0 && count <= MAX_TEXTURE_IDS_PER_CALL;
      const byteLength = validCount ? count * 4 : -1;
      const deleted: number[] = [];
      if (heap && validRange(heap, pointer, byteLength)) {
        const view = new DataView(heap.buffer, heap.byteOffset + pointer, byteLength);
        for (let index = 0; index < count; index++) {
          deleted.push(view.getUint32(index * 4, true));
        }
      }
      const result = deleteTextures.call(this, count, pointer);
      for (const texture of deleted) {
          matchedTextures.delete(texture);
          if (bindings.get(GL_TEXTURE_2D) === texture) bindings.delete(GL_TEXTURE_2D);
      }
      return result;
    };
  }

  const texImage2D = env.glTexImage2D;
  env.glTexImage2D = function (
    this: unknown,
    target,
    level,
    internalFormat,
    width,
    height,
    border,
    format,
    type,
    pixels,
  ) {
    observeCandidate({
      kind: "image", target, level, internalFormat, width, height, format, type,
      imageBytes: diagnosticUploadBytes(format, type, width, height), pointer: pixels,
    });
    const call = () => texImage2D.call(
      this, target, level, internalFormat, width, height, border, format, type, pixels,
    );
    const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
    if (texture && level === 0) matchedTextures.delete(texture);
    if (
      target !== GL_TEXTURE_2D || border !== 0 || format !== GL_RGBA
      || type !== GL_UNSIGNED_BYTE || (internalFormat !== GL_RGBA && internalFormat !== GL_RGBA8)
    ) return call();
    if (!texture) return call();
    const expectedWidth = Math.max(1, ATLAS_WIDTH >> level);
    const expectedHeight = Math.max(1, ATLAS_HEIGHT >> level);
    const length = expectedWidth * expectedHeight * 4;
    if (width !== expectedWidth || height !== expectedHeight || !validRange(module.HEAPU8, pixels, length)) {
      return call();
    }
    const mode = level === 0
      ? identify(module.HEAPU8!.subarray(pixels, pixels + length))
      : matchedTextures.get(texture) ?? null;
    if (!mode) return call();
    const bytes = replacement(mode, level);
    if (!bytes) return call();
    try {
      const result = substitute(pixels, bytes, call);
      if (level === 0) matchedTextures.set(texture, mode);
      return result;
    } catch (error) {
      if (level === 0) matchedTextures.delete(texture);
      throw error;
    }
  };

  const texStorage2D = env.glTexStorage2D;
  if (typeof texStorage2D === "function") {
    env.glTexStorage2D = function (
      this: unknown,
      target,
      levels,
      internalFormat,
      width,
      height,
    ) {
      const result = texStorage2D.call(
        this,
        target,
        levels,
        internalFormat,
        width,
        height,
      );
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture) matchedTextures.delete(texture);
      return result;
    };
  }

  const texSubImage2D = env.glTexSubImage2D;
  if (typeof texSubImage2D === "function") {
    env.glTexSubImage2D = function (
      this: unknown,
      target,
      level,
      x,
      y,
      width,
      height,
      format,
      type,
      pixels,
    ) {
      observeCandidate({
        kind: "sub-image", target, level, width, height, format, type,
        imageBytes: diagnosticUploadBytes(format, type, width, height), pointer: pixels,
      });
      const call = () => texSubImage2D.call(
        this, target, level, x, y, width, height, format, type, pixels,
      );
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matchedTextures.delete(texture);
      const expectedWidth = Math.max(1, ATLAS_WIDTH >> level);
      const expectedHeight = Math.max(1, ATLAS_HEIGHT >> level);
      const length = expectedWidth * expectedHeight * 4;
      if (
        target !== GL_TEXTURE_2D || x !== 0 || y !== 0
        || width !== expectedWidth || height !== expectedHeight
        || format !== GL_RGBA || type !== GL_UNSIGNED_BYTE || !texture
        || !validRange(module.HEAPU8, pixels, length)
      ) return call();
      const mode = level === 0
        ? identify(module.HEAPU8!.subarray(pixels, pixels + length))
        : matchedTextures.get(texture) ?? null;
      if (!mode) return call();
      const bytes = replacement(mode, level);
      if (!bytes) return call();
      try {
        const result = substitute(pixels, bytes, call);
        if (level === 0) matchedTextures.set(texture, mode);
        return result;
      } catch (error) {
        if (level === 0) matchedTextures.delete(texture);
        throw error;
      }
    };
  }

  const compressedTexImage2D = env.glCompressedTexImage2D;
  if (typeof compressedTexImage2D === "function") {
    env.glCompressedTexImage2D = function (
      this: unknown,
      target,
      level,
      internalFormat,
      width,
      height,
      border,
      imageBytes,
      data,
    ) {
      observeCandidate({
        kind: "compressed-image", target, level, internalFormat, width, height,
        imageBytes, pointer: data,
      });
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matchedTextures.delete(texture);
      return compressedTexImage2D.call(
        this, target, level, internalFormat, width, height, border, imageBytes, data,
      );
    };
  }

  const compressedTexSubImage2D = env.glCompressedTexSubImage2D;
  if (typeof compressedTexSubImage2D === "function") {
    env.glCompressedTexSubImage2D = function (
      this: unknown,
      target,
      level,
      x,
      y,
      width,
      height,
      format,
      imageBytes,
      data,
    ) {
      observeCandidate({
        kind: "compressed-sub-image", target, level, width, height, format,
        imageBytes, pointer: data,
      });
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matchedTextures.delete(texture);
      return compressedTexSubImage2D.call(
        this, target, level, x, y, width, height, format, imageBytes, data,
      );
    };
  }

  log("PlayStation controller-symbol substitution armed for the certified Guild Wars atlas");
  return Object.freeze({
    reset: () => {
      bindings.clear();
      matchedTextures.clear();
    },
    snapshot: (): ControllerPromptTextureStats => Object.freeze({
      replacements,
      matchedTextures: matchedTextures.size,
      candidates: Object.freeze([...candidates]),
    }),
  });
}
