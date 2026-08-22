/**
 * Observes the two client boundaries that can explain WASM heap exhaustion:
 * heap-growth requests and WebGL texture lifetime. It owns bounded numeric
 * evidence only; it neither changes an allocation decision nor retains pixel
 * data, pointers, stack prose, or an unbounded per-texture history.
 */

import type { RendererMilestoneFieldsByName } from "../shared/diagnostics.js";

type GrowthFields = RendererMilestoneFieldsByName["wasm.growthRequested"];

type AttributionImports = {
  env?: {
    emscripten_resize_heap?: (requestedBytes: number) => unknown;
    glBindTexture?: (target: number, texture: number) => unknown;
    glGenTextures?: (count: number, textures: number) => unknown;
    glDeleteTextures?: (count: number, textures: number) => unknown;
    glTexStorage2D?: (
      target: number,
      levels: number,
      internalFormat: number,
      width: number,
      height: number,
    ) => unknown;
    glTexImage2D?: (
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
    glTexSubImage2D?: (
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

export interface WasmStackFrame {
  readonly functionIndex: number;
  readonly codeOffset: number;
}

interface TextureRecord {
  levelBytes: Float64Array | null;
  bytes: number;
}

/** Bounded counters only. No texture identity, dimensions, or pixels escape. */
export interface TextureMemorySnapshot {
  generatedTextures: number;
  deletedTextures: number;
  liveTextures: number;
  trackedTextures: number;
  knownTextureBytes: number;
  textureUploadBytes: number;
  unknownTextureAllocations: number;
  textureTrackingSaturated: boolean;
}

const MAX_TRACKED_TEXTURES = 4_096;
const MAX_TEXTURE_IDS_PER_CALL = 4_096;
const MAX_STACK_FRAMES = 4;
const MAX_TEXTURE_LEVEL_SLOTS = 6 * 32;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const GL_TEXTURE_CUBE_MAP = 0x8513;
const GL_TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515;
const GL_TEXTURE_CUBE_MAP_NEGATIVE_Z = 0x851a;

function saturatingAdd(value: number, increment: number): number {
  if (!Number.isFinite(increment) || increment <= 0) return value;
  return Math.min(MAX_SAFE, value + increment);
}

function finiteDimension(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function textureBindingTarget(target: number): number {
  return target >= GL_TEXTURE_CUBE_MAP_POSITIVE_X
    && target <= GL_TEXTURE_CUBE_MAP_NEGATIVE_Z
    ? GL_TEXTURE_CUBE_MAP
    : target;
}

function textureLevelSlot(target: number, level: number): number | null {
  if (!Number.isSafeInteger(level) || level < 0 || level > 31) return null;
  const face = target >= GL_TEXTURE_CUBE_MAP_POSITIVE_X
    && target <= GL_TEXTURE_CUBE_MAP_NEGATIVE_Z
    ? target - GL_TEXTURE_CUBE_MAP_POSITIVE_X
    : 0;
  return face * 32 + level;
}

function blockBytes(
  width: number,
  height: number,
  blockWidth: number,
  blockHeight: number,
  bytes: number,
): number {
  return Math.ceil(width / blockWidth) * Math.ceil(height / blockHeight) * bytes;
}

/** Estimated storage for the sized formats the shipped client can hand WebGL. */
export function textureLevelBytes(
  internalFormat: number,
  widthValue: number,
  heightValue: number,
): number | null {
  const width = finiteDimension(widthValue);
  const height = finiteDimension(heightValue);
  if (width === null || height === null) return null;
  const pixels = width * height;
  const bytesPerPixel: Readonly<Record<number, number>> = {
    0x8229: 1, // R8
    0x8f94: 1, // R8_SNORM
    0x822d: 2, // R16F
    0x822e: 4, // R32F
    0x822b: 2, // RG8
    0x8f95: 2, // RG8_SNORM
    0x822f: 4, // RG16F
    0x8230: 8, // RG32F
    0x8051: 3, // RGB8
    0x8c41: 3, // SRGB8
    0x8d62: 2, // RGB565
    0x8c3a: 4, // R11F_G11F_B10F
    0x8c3d: 4, // RGB9_E5
    0x881b: 6, // RGB16F
    0x8815: 12, // RGB32F
    0x8058: 4, // RGBA8
    0x8c43: 4, // SRGB8_ALPHA8
    0x8056: 2, // RGBA4
    0x8057: 2, // RGB5_A1
    0x8059: 4, // RGB10_A2
    0x881a: 8, // RGBA16F
    0x8814: 16, // RGBA32F
    0x81a5: 2, // DEPTH_COMPONENT16
    0x81a6: 3, // DEPTH_COMPONENT24
    0x8cac: 4, // DEPTH_COMPONENT32F
    0x88f0: 4, // DEPTH24_STENCIL8
    0x8cad: 8, // DEPTH32F_STENCIL8
  };
  const direct = bytesPerPixel[internalFormat];
  if (direct !== undefined) return pixels * direct;

  // S3TC/ETC families use fixed 4x4 blocks. These values are storage, not
  // upload traffic, so mip levels below one block still occupy one block.
  if ([0x83f0, 0x83f1, 0x8c4c, 0x8c4d, 0x9274, 0x9275].includes(internalFormat)) {
    return blockBytes(width, height, 4, 4, 8);
  }
  if ([0x83f2, 0x83f3, 0x8c4e, 0x8c4f, 0x9278, 0x9279].includes(internalFormat)) {
    return blockBytes(width, height, 4, 4, 16);
  }
  return null;
}

function uploadBytes(
  format: number,
  type: number,
  widthValue: number,
  heightValue: number,
): number | null {
  const width = finiteDimension(widthValue);
  const height = finiteDimension(heightValue);
  if (width === null || height === null) return null;
  // Packed types already describe the complete pixel.
  if ([0x8033, 0x8034, 0x8363].includes(type)) return width * height * 2;
  if ([0x8368, 0x8c3b, 0x8c3e].includes(type)) return width * height * 4;
  const components: Readonly<Record<number, number>> = {
    0x1903: 1, // RED
    0x8227: 2, // RG
    0x1907: 3, // RGB
    0x1908: 4, // RGBA
    0x1902: 1, // DEPTH_COMPONENT
    0x84f9: 1, // DEPTH_STENCIL (packed type supplies the byte width)
  };
  const scalarBytes: Readonly<Record<number, number>> = {
    0x1401: 1, // UNSIGNED_BYTE
    0x1400: 1, // BYTE
    0x1403: 2, // UNSIGNED_SHORT
    0x1402: 2, // SHORT
    0x1405: 4, // UNSIGNED_INT
    0x1404: 4, // INT
    0x1406: 4, // FLOAT
    0x140b: 2, // HALF_FLOAT
  };
  const componentCount = components[format];
  const componentBytes = scalarBytes[type];
  return componentCount === undefined || componentBytes === undefined
    ? null
    : width * height * componentCount * componentBytes;
}

/** Parses only numeric WASM frames; module hashes and JavaScript prose stay local. */
export function parseWasmStack(stack: string): WasmStackFrame[] {
  const frames: WasmStackFrame[] = [];
  const pattern = /wasm-function\[(\d+)\]:0x([0-9a-f]+)/gi;
  for (const match of stack.matchAll(pattern)) {
    const functionIndex = Number(match[1]);
    const codeOffset = Number.parseInt(match[2]!, 16);
    if (Number.isSafeInteger(functionIndex) && Number.isSafeInteger(codeOffset)) {
      frames.push({ functionIndex, codeOffset });
      if (frames.length === MAX_STACK_FRAMES) break;
    }
  }
  return frames;
}

function fingerprintFrames(frames: readonly WasmStackFrame[]): string {
  const input = frames
    .map(({ functionIndex, codeOffset }) => `${functionIndex}:${codeOffset}`)
    .join(";");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function installWasmMemoryAttribution({
  imports,
  module,
  recordGrowth,
  captureStack = () => new Error("WASM heap growth").stack ?? "",
  log,
}: {
  imports: AttributionImports;
  module: ClientMemory;
  recordGrowth: (fields: GrowthFields) => void;
  captureStack?: () => string;
  log: (...values: unknown[]) => void;
}) {
  const env = imports.env;
  const resizeHeap = env?.emscripten_resize_heap;
  if (!env || typeof resizeHeap !== "function") {
    log("[warn] memory attribution unavailable — heap resize import missing");
    return null;
  }

  const textures = new Map<number, TextureRecord>();
  const bindings = new Map<number, number>();
  let generatedTextures = 0;
  let deletedTextures = 0;
  let knownTextureBytes = 0;
  let textureUploadBytes = 0;
  let unknownTextureAllocations = 0;
  let textureTrackingSaturated = false;
  let observationFailureReported = false;

  const observe = (callback: () => void) => {
    try {
      callback();
    } catch (error) {
      if (observationFailureReported) return;
      observationFailureReported = true;
      try {
        log("[warn] memory attribution observation failed", error);
      } catch {
        // Diagnostics must never alter the client's call path, including when
        // its own logger is unavailable.
      }
    }
  };

  const readTextureIds = (pointer: number, countValue: number): number[] => {
    const heap = module.HEAPU8;
    const address = pointer >>> 0;
    if (
      !heap
      || !Number.isSafeInteger(pointer)
      || !Number.isSafeInteger(countValue)
      || countValue < 0
      || countValue > MAX_TEXTURE_IDS_PER_CALL
      || address + countValue * 4 > heap.buffer.byteLength
    ) return [];
    const view = new DataView(heap.buffer);
    return Array.from(
      { length: countValue },
      (_unused, index) => view.getUint32(address + index * 4, true),
    );
  };

  const ensureTexture = (texture: number): TextureRecord | null => {
    const existing = textures.get(texture);
    if (existing) return existing;
    if (textures.size >= MAX_TRACKED_TEXTURES) {
      textureTrackingSaturated = true;
      return null;
    }
    const created = { levelBytes: null, bytes: 0 };
    textures.set(texture, created);
    return created;
  };

  const setLevelBytes = (
    target: number,
    level: number,
    bytes: number | null,
  ) => {
    const texture = bindings.get(textureBindingTarget(target));
    const slot = textureLevelSlot(target, level);
    if (!texture || slot === null || bytes === null) {
      unknownTextureAllocations = saturatingAdd(unknownTextureAllocations, 1);
      return;
    }
    const record = ensureTexture(texture);
    if (!record) {
      unknownTextureAllocations = saturatingAdd(unknownTextureAllocations, 1);
      return;
    }
    const levels = record.levelBytes ??= new Float64Array(MAX_TEXTURE_LEVEL_SLOTS);
    const previous = levels[slot] ?? 0;
    levels[slot] = bytes;
    record.bytes += bytes - previous;
    knownTextureBytes += bytes - previous;
  };

  const bindTexture = env.glBindTexture;
  if (typeof bindTexture === "function") {
    env.glBindTexture = function (this: unknown, target, texture) {
      const result = bindTexture.call(this, target, texture);
      observe(() => bindings.set(textureBindingTarget(target), texture));
      return result;
    };
  }

  const genTextures = env.glGenTextures;
  if (typeof genTextures === "function") {
    env.glGenTextures = function (this: unknown, count, pointer) {
      const result = genTextures.call(this, count, pointer);
      observe(() => {
        generatedTextures = saturatingAdd(generatedTextures, count);
        for (const texture of readTextureIds(pointer, count)) ensureTexture(texture);
      });
      return result;
    };
  }

  const deleteTextures = env.glDeleteTextures;
  if (typeof deleteTextures === "function") {
    env.glDeleteTextures = function (this: unknown, count, pointer) {
      const result = deleteTextures.call(this, count, pointer);
      observe(() => {
        const ids = readTextureIds(pointer, count);
        deletedTextures = saturatingAdd(deletedTextures, count);
        for (const texture of ids) {
          const record = textures.get(texture);
          if (record) knownTextureBytes -= record.bytes;
          textures.delete(texture);
          for (const [target, bound] of bindings) {
            if (bound === texture) bindings.delete(target);
          }
        }
      });
      return result;
    };
  }

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
      observe(() => {
        const levelCount = Number.isSafeInteger(levels) && levels > 0
          ? Math.min(levels, 32)
          : 0;
        const faces = target === GL_TEXTURE_CUBE_MAP ? 6 : 1;
        for (let face = 0; face < faces; face++) {
          const levelTarget = faces === 1
            ? target
            : GL_TEXTURE_CUBE_MAP_POSITIVE_X + face;
          for (let level = 0; level < levelCount; level++) {
            setLevelBytes(
              levelTarget,
              level,
              textureLevelBytes(
                internalFormat,
                Math.max(1, width >> level),
                Math.max(1, height >> level),
              ),
            );
          }
        }
      });
      return result;
    };
  }

  const texImage2D = env.glTexImage2D;
  if (typeof texImage2D === "function") {
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
      const result = texImage2D.call(
        this,
        target,
        level,
        internalFormat,
        width,
        height,
        border,
        format,
        type,
        pixels,
      );
      observe(() => {
        const bytes = textureLevelBytes(internalFormat, width, height)
          ?? uploadBytes(format, type, width, height);
        setLevelBytes(target, level, bytes);
        if (pixels !== 0 && bytes !== null) {
          textureUploadBytes = saturatingAdd(textureUploadBytes, bytes);
        }
      });
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
      const result = texSubImage2D.call(
        this,
        target,
        level,
        x,
        y,
        width,
        height,
        format,
        type,
        pixels,
      );
      observe(() => {
        const bytes = uploadBytes(format, type, width, height);
        if (pixels !== 0 && bytes !== null) {
          textureUploadBytes = saturatingAdd(textureUploadBytes, bytes);
        }
      });
      return result;
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
      const result = compressedTexSubImage2D.call(
        this,
        target,
        level,
        x,
        y,
        width,
        height,
        format,
        imageBytes,
        data,
      );
      observe(() => {
        textureUploadBytes = saturatingAdd(textureUploadBytes, imageBytes);
      });
      return result;
    };
  }

  const textureSnapshot = (): TextureMemorySnapshot => ({
    generatedTextures,
    deletedTextures,
    liveTextures: Math.max(0, generatedTextures - deletedTextures),
    trackedTextures: textures.size,
    knownTextureBytes: Math.max(0, knownTextureBytes),
    textureUploadBytes,
    unknownTextureAllocations,
    textureTrackingSaturated,
  });

  const growthFields = (
    requestedBytes: number,
    beforeBytes: number,
    afterBytes: number,
    outcome: GrowthFields["outcome"],
    frames: readonly WasmStackFrame[],
  ): GrowthFields => ({
    requestedBytes,
    beforeBytes,
    afterBytes,
    outcome,
    stackFingerprint: fingerprintFrames(frames),
    stackDepth: frames.length,
    frame0Function: frames[0]?.functionIndex ?? 0,
    frame0Offset: frames[0]?.codeOffset ?? 0,
    frame1Function: frames[1]?.functionIndex ?? 0,
    frame1Offset: frames[1]?.codeOffset ?? 0,
    frame2Function: frames[2]?.functionIndex ?? 0,
    frame2Offset: frames[2]?.codeOffset ?? 0,
    frame3Function: frames[3]?.functionIndex ?? 0,
    frame3Offset: frames[3]?.codeOffset ?? 0,
    ...textureSnapshot(),
  });

  env.emscripten_resize_heap = function (this: unknown, requestedValue) {
    const requestedBytes = Number(requestedValue) >>> 0;
    const beforeBytes = module.HEAPU8?.buffer.byteLength ?? 0;
    let frames: WasmStackFrame[] = [];
    observe(() => {
      frames = parseWasmStack(captureStack());
    });
    try {
      const result = resizeHeap.call(this, requestedValue);
      const afterBytes = module.HEAPU8?.buffer.byteLength ?? beforeBytes;
      const outcome = afterBytes > beforeBytes
        ? "grown"
        : result ? "unchanged" : "refused";
      observe(() => recordGrowth(growthFields(
          requestedBytes,
          beforeBytes,
          afterBytes,
          outcome,
          frames,
        )));
      return result;
    } catch (error) {
      observe(() => recordGrowth(growthFields(
          requestedBytes,
          beforeBytes,
          module.HEAPU8?.buffer.byteLength ?? beforeBytes,
          "threw",
          frames,
        )));
      throw error;
    }
  };

  return Object.freeze({
    snapshot: () => Object.freeze(textureSnapshot()),
  });
}
