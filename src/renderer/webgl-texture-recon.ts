/**
 * Owns a development-only, bounded WebGL texture-activity probe. It records
 * dimensions, formats, content fingerprints, and normalized bind activity so a live
 * operator can compare named visual states without retaining pixels or WASM
 * pointers.
 */

const GL_TEXTURE_2D = 0x0de1;
const GL_TEXTURE0 = 0x84c0;
const MAX_TEXTURES = 4_096;
const MAX_FINGERPRINT_BYTES = 4 * 1024 * 1024;
const PROOF_TILE_SIZE = 512;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;

type TextureReconImports = {
  env?: {
    glActiveTexture?: (texture: number) => unknown;
    glBindTexture?: (target: number, texture: number) => unknown;
    glDeleteTextures?: (count: number, pointer: number) => unknown;
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

export type TextureReconRecord = Readonly<{
  texture: number;
  width: number;
  height: number;
  level: number;
  internalFormat: number | null;
  format: number | null;
  type: number | null;
  uploadKind: "image" | "sub-image" | "compressed-image" | "compressed-sub-image";
  uploadBytes: number;
  fingerprint: string | null;
  intervalUploads: number;
  intervalBinds: number;
  bindsPerSecond: number;
}>;

export type TextureReconSnapshot = Readonly<{
  intervalDurationMs: number;
  trackedTextures: number;
  saturated: boolean;
  exactReplacements: readonly Readonly<{
    fingerprint: string;
    palette: TextureProofPalette;
    replacements: number;
  }>[];
  records: readonly TextureReconRecord[];
}>;

export type TextureProofPalette = "magenta-cyan" | "yellow-blue";

export type TextureReconController = Readonly<{
  armExactReplacements: (replacements: readonly Readonly<{
    fingerprint: string;
    palette: TextureProofPalette;
  }>[]) => boolean;
  checkpoint: () => TextureReconSnapshot;
  resetContext: () => void;
}>;

type MutableRecord = {
  width: number;
  height: number;
  level: number;
  internalFormat: number | null;
  format: number | null;
  type: number | null;
  uploadKind: TextureReconRecord["uploadKind"];
  uploadBytes: number;
  fingerprint: string | null;
  intervalUploads: number;
  intervalBinds: number;
};

function byteLength(format: number, type: number, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return 0;
  }
  const components: Readonly<Record<number, number>> = {
    0x1903: 1,
    0x8227: 2,
    0x1907: 3,
    0x1908: 4,
  };
  const scalarBytes: Readonly<Record<number, number>> = {
    0x1400: 1,
    0x1401: 1,
    0x1402: 2,
    0x1403: 2,
    0x1404: 4,
    0x1405: 4,
    0x1406: 4,
    0x140b: 2,
  };
  return width * height * (components[format] ?? 0) * (scalarBytes[type] ?? 0);
}

function fingerprint(heap: Uint8Array | undefined, pointer: number, length: number): string | null {
  if (
    !heap
    || !Number.isSafeInteger(pointer)
    || !Number.isSafeInteger(length)
    || pointer <= 0
    || length <= 0
    || length > MAX_FINGERPRINT_BYTES
    || pointer > heap.byteLength - length
  ) return null;
  let hash = 0x811c9dc5;
  const end = pointer + length;
  for (let index = pointer; index < end; index += 1) {
    hash ^= heap[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const PROOF_PALETTES: Readonly<Record<TextureProofPalette, readonly [
  readonly [number, number, number],
  readonly [number, number, number],
]>> = Object.freeze({
  "magenta-cyan": [[255, 0, 255], [0, 255, 255]],
  "yellow-blue": [[255, 255, 0], [0, 64, 255]],
});

function replaceWithCheckerboard(
  heap: Uint8Array | undefined,
  pointer: number,
  length: number,
  expectedFingerprint: string | null,
  palette: TextureProofPalette,
): (() => void) | null {
  if (!expectedFingerprint || fingerprint(heap, pointer, length) !== expectedFingerprint || !heap) {
    return null;
  }
  const original = heap.slice(pointer, pointer + length);
  const pixels = heap.subarray(pointer, pointer + length);
  const colors = PROOF_PALETTES[palette];
  for (let y = 0; y < PROOF_TILE_SIZE; y += 1) {
    for (let x = 0; x < PROOF_TILE_SIZE; x += 1) {
      const offset = (y * PROOF_TILE_SIZE + x) * 4;
      const alternate = ((x >> 5) + (y >> 5)) % 2 === 0;
      const color = colors[alternate ? 0 : 1];
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return () => heap.set(original, pointer);
}

/** Installs the removable-in-practice probe before WASM instantiation. */
export function installWebGlTextureRecon({
  imports,
  module,
  log,
  now = () => performance.now(),
}: {
  imports: TextureReconImports;
  module: ClientMemory;
  log: (...values: unknown[]) => void;
  now?: () => number;
}): TextureReconController | null {
  const env = imports.env;
  if (!env || typeof env.glBindTexture !== "function") {
    log("[warn] texture recon unavailable — texture binding import missing");
    return null;
  }

  const records = new Map<number, MutableRecord>();
  const bindings = new Map<number, number>();
  let activeUnit = GL_TEXTURE0;
  let saturated = false;
  let observationFailureReported = false;
  let intervalStartedAt = now();
  const exactReplacements = new Map<TextureProofPalette, {
    fingerprint: string;
    replacements: number;
  }>();

  const observe = (callback: () => void) => {
    try {
      callback();
    } catch (error) {
      if (observationFailureReported) return;
      observationFailureReported = true;
      try {
        log("[warn] texture recon observation failed", error);
      } catch {
        // The probe must never change the client call path.
      }
    }
  };

  const currentTexture = () => bindings.get(activeUnit) ?? 0;
  const recordUpload = (input: Omit<MutableRecord, "intervalUploads" | "intervalBinds">) => {
    const texture = currentTexture();
    if (!texture) return;
    const previous = records.get(texture);
    if (!previous && records.size >= MAX_TEXTURES) {
      saturated = true;
      return;
    }
    records.set(texture, {
      ...input,
      intervalUploads: (previous?.intervalUploads ?? 0) + 1,
      intervalBinds: previous?.intervalBinds ?? 0,
    });
  };

  const activeTexture = env.glActiveTexture;
  if (typeof activeTexture === "function") {
    env.glActiveTexture = function (this: unknown, texture) {
      const result = activeTexture.call(this, texture);
      observe(() => {
        if (Number.isSafeInteger(texture) && texture >= GL_TEXTURE0) activeUnit = texture;
      });
      return result;
    };
  }

  const bindTexture = env.glBindTexture;
  env.glBindTexture = function (this: unknown, target, texture) {
    const result = bindTexture.call(this, target, texture);
    observe(() => {
      if (target !== GL_TEXTURE_2D) return;
      bindings.set(activeUnit, texture);
      const record = records.get(texture);
      if (record) record.intervalBinds += 1;
    });
    return result;
  };

  const texImage2D = env.glTexImage2D;
  if (typeof texImage2D === "function") {
    env.glTexImage2D = function (this: unknown, target, level, internalFormat, width, height, border, format, type, pixels) {
      const result = texImage2D.call(this, target, level, internalFormat, width, height, border, format, type, pixels);
      observe(() => {
        if (target !== GL_TEXTURE_2D || level !== 0) return;
        const uploadBytes = byteLength(format, type, width, height);
        recordUpload({ width, height, level, internalFormat, format, type, uploadKind: "image", uploadBytes, fingerprint: fingerprint(module.HEAPU8, pixels, uploadBytes) });
      });
      return result;
    };
  }

  const texSubImage2D = env.glTexSubImage2D;
  if (typeof texSubImage2D === "function") {
    env.glTexSubImage2D = function (this: unknown, target, level, x, y, width, height, format, type, pixels) {
      const uploadBytes = byteLength(format, type, width, height);
      const uploadedFingerprint = fingerprint(module.HEAPU8, pixels, uploadBytes);
      const eligibleForProof = target === GL_TEXTURE_2D
        && level === 0
        && x === 0
        && y === 0
        && width === PROOF_TILE_SIZE
        && height === PROOF_TILE_SIZE
        && format === GL_RGBA
        && type === GL_UNSIGNED_BYTE;
      const replacement = eligibleForProof
        ? [...exactReplacements.entries()].find(([, candidate]) => candidate.fingerprint === uploadedFingerprint)
        : undefined;
      const restore = replacement
        ? replaceWithCheckerboard(module.HEAPU8, pixels, uploadBytes, uploadedFingerprint, replacement[0])
        : null;
      let result: unknown;
      try {
        result = texSubImage2D.call(this, target, level, x, y, width, height, format, type, pixels);
      } finally {
        restore?.();
      }
      observe(() => {
        if (target !== GL_TEXTURE_2D || level !== 0) return;
        if (restore && replacement) replacement[1].replacements += 1;
        recordUpload({ width, height, level, internalFormat: null, format, type, uploadKind: "sub-image", uploadBytes, fingerprint: uploadedFingerprint });
      });
      return result;
    };
  }

  const compressedImage = env.glCompressedTexImage2D;
  if (typeof compressedImage === "function") {
    env.glCompressedTexImage2D = function (this: unknown, target, level, internalFormat, width, height, border, imageBytes, data) {
      const result = compressedImage.call(this, target, level, internalFormat, width, height, border, imageBytes, data);
      observe(() => {
        if (target !== GL_TEXTURE_2D || level !== 0) return;
        recordUpload({ width, height, level, internalFormat, format: null, type: null, uploadKind: "compressed-image", uploadBytes: imageBytes, fingerprint: fingerprint(module.HEAPU8, data, imageBytes) });
      });
      return result;
    };
  }

  const compressedSubImage = env.glCompressedTexSubImage2D;
  if (typeof compressedSubImage === "function") {
    env.glCompressedTexSubImage2D = function (this: unknown, target, level, x, y, width, height, format, imageBytes, data) {
      const result = compressedSubImage.call(this, target, level, x, y, width, height, format, imageBytes, data);
      observe(() => {
        if (target !== GL_TEXTURE_2D || level !== 0) return;
        recordUpload({ width, height, level, internalFormat: null, format, type: null, uploadKind: "compressed-sub-image", uploadBytes: imageBytes, fingerprint: fingerprint(module.HEAPU8, data, imageBytes) });
      });
      return result;
    };
  }

  const deleteTextures = env.glDeleteTextures;
  if (typeof deleteTextures === "function") {
    env.glDeleteTextures = function (this: unknown, count, pointer) {
      const heap = module.HEAPU8;
      const ids: number[] = [];
      if (heap && Number.isSafeInteger(count) && count >= 0 && count <= 4_096 && pointer >= 0 && pointer <= heap.byteLength - count * 4) {
        const view = new DataView(heap.buffer, heap.byteOffset + pointer, count * 4);
        for (let index = 0; index < count; index += 1) ids.push(view.getUint32(index * 4, true));
      }
      const result = deleteTextures.call(this, count, pointer);
      observe(() => {
        for (const texture of ids) {
          records.delete(texture);
          for (const [unit, bound] of bindings) if (bound === texture) bindings.delete(unit);
        }
      });
      return result;
    };
  }

  const clearInterval = () => {
    for (const record of records.values()) {
      record.intervalUploads = 0;
      record.intervalBinds = 0;
    }
  };
  const checkpoint = (): TextureReconSnapshot => {
    const checkpointAt = now();
    const intervalDurationMs = Math.max(0, checkpointAt - intervalStartedAt);
    const intervalSeconds = intervalDurationMs / 1_000;
    const active = [...records.entries()]
      .filter(([, record]) => record.intervalUploads > 0 || record.intervalBinds > 0)
      .map(([texture, record]) => Object.freeze({
        texture,
        ...record,
        bindsPerSecond: intervalSeconds > 0 ? record.intervalBinds / intervalSeconds : 0,
      }))
      .sort((a, b) => b.bindsPerSecond - a.bindsPerSecond || b.intervalUploads - a.intervalUploads || a.texture - b.texture);
    const replacementSnapshot = [...exactReplacements.entries()].map(([palette, replacement]) => Object.freeze({
      fingerprint: replacement.fingerprint,
      palette,
      replacements: replacement.replacements,
    }));
    const snapshot = Object.freeze({
      intervalDurationMs,
      trackedTextures: records.size,
      saturated,
      exactReplacements: Object.freeze(replacementSnapshot),
      records: Object.freeze(active),
    });
    clearInterval();
    intervalStartedAt = checkpointAt;
    return snapshot;
  };
  const armExactReplacements = (requested: readonly Readonly<{
    fingerprint: string;
    palette: TextureProofPalette;
  }>[]) => {
    if (
      requested.length !== 2
      || new Set(requested.map(({ fingerprint }) => fingerprint)).size !== requested.length
      || new Set(requested.map(({ palette }) => palette)).size !== requested.length
      || requested.some(({ fingerprint, palette }) => (
        !/^fnv1a32:[0-9a-f]{8}$/u.test(fingerprint) || !Object.hasOwn(PROOF_PALETTES, palette)
      ))
    ) return false;
    exactReplacements.clear();
    for (const { fingerprint, palette } of requested) {
      exactReplacements.set(palette, { fingerprint, replacements: 0 });
    }
    return true;
  };
  const resetContext = () => {
    records.clear();
    bindings.clear();
    activeUnit = GL_TEXTURE0;
    saturated = false;
    intervalStartedAt = now();
    for (const replacement of exactReplacements.values()) replacement.replacements = 0;
  };

  log("Texture recon armed for local development evidence");
  return Object.freeze({ armExactReplacements, checkpoint, resetContext });
}
