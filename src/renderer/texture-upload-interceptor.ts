/**
 * Owns the one WebGL texture-upload interception layer. Ordered providers
 * identify exact source bytes and supply a synchronous replacement.
 */
const GL_TEXTURE_2D = 0x0de1;
const GL_RGBA = 0x1908;
const GL_RGBA8 = 0x8058;
const GL_UNSIGNED_BYTE = 0x1401;
const MAX_TEXTURE_BYTES = 64 * 1024 * 1024;
const MAX_TEXTURE_IDS_PER_CALL = 4_096;

type Upload = (
  target: number, level: number, internalFormat: number, width: number, height: number,
  border: number, format: number, type: number, pixels: number,
) => unknown;
type SubUpload = (
  target: number, level: number, x: number, y: number, width: number, height: number,
  format: number, type: number, pixels: number,
) => unknown;

export interface TextureImports {
  readonly env?: {
    glBindTexture?: (target: number, texture: number) => unknown;
    glDeleteTextures?: (count: number, pointer: number) => unknown;
    glTexStorage2D?: (target: number, levels: number, internalFormat: number, width: number, height: number) => unknown;
    glTexImage2D?: Upload;
    glTexSubImage2D?: SubUpload;
    glCompressedTexImage2D?: (
      target: number, level: number, internalFormat: number, width: number, height: number,
      border: number, imageBytes: number, data: number,
    ) => unknown;
    glCompressedTexSubImage2D?: (
      target: number, level: number, x: number, y: number, width: number, height: number,
      format: number, imageBytes: number, data: number,
    ) => unknown;
  };
}

export interface ClientMemory {
  readonly HEAPU8?: Uint8Array;
}

export interface TextureUpload {
  readonly kind: "image" | "sub-image" | "compressed-image" | "compressed-sub-image";
  readonly target: number;
  readonly level: number;
  readonly width: number;
  readonly height: number;
  readonly internalFormat?: number;
  readonly format?: number;
  readonly type?: number;
  readonly imageBytes: number;
  readonly pointer: number;
}

export interface TextureUploadProvider {
  readonly id: string;
  readonly priority: number;
  readonly observe?: (upload: TextureUpload, bytes: Uint8Array | null) => void;
  readonly identifyRgba?: (bytes: Uint8Array, upload: TextureUpload) => unknown | null;
  readonly identifyCompressed?: (bytes: Uint8Array, upload: TextureUpload) => unknown | null;
  readonly rgbaReplacement?: (match: unknown, level: number) => Uint8Array | null;
  readonly compressedReplacement?: (match: unknown, level: number, format: number) => Uint8Array | null;
  readonly replaced?: () => void;
}

export interface InstalledTextureUploadProvider {
  readonly reset: () => void;
  readonly dispose: () => void;
  readonly matchedTextures: () => number;
}

interface Match {
  readonly provider: TextureUploadProvider;
  readonly value: unknown;
  readonly compressed: boolean;
}

function validRange(heap: Uint8Array | undefined, pointer: number, length: number): boolean {
  return heap !== undefined && Number.isSafeInteger(pointer) && pointer > 0
    && Number.isSafeInteger(length) && length >= 0 && length <= MAX_TEXTURE_BYTES
    && pointer <= heap.byteLength - length;
}

class TextureUploadInterceptor {
  private readonly providers: TextureUploadProvider[] = [];
  private readonly bindings = new Map<number, number>();
  private readonly matches = new Map<number, Match>();
  private readonly originals: NonNullable<TextureImports["env"]>;
  private readonly env: NonNullable<TextureImports["env"]>;
  private readonly module: ClientMemory;
  private readonly removed: () => void;

  constructor(
    env: NonNullable<TextureImports["env"]>,
    module: ClientMemory,
    removed: () => void,
  ) {
    this.env = env;
    this.module = module;
    this.removed = removed;
    this.originals = { ...env };
    this.install();
  }

  add(provider: TextureUploadProvider): InstalledTextureUploadProvider {
    if (this.providers.some((candidate) => candidate.id === provider.id)) {
      throw new Error(`texture provider ${provider.id} is already installed`);
    }
    this.providers.push(provider);
    this.providers.sort((left, right) => right.priority - left.priority);
    let active = true;
    const reset = () => {
      this.bindings.clear();
      this.matches.clear();
    };
    const removeMatches = () => {
      for (const [texture, match] of this.matches) if (match.provider === provider) this.matches.delete(texture);
    };
    return Object.freeze({
      reset,
      dispose: () => {
        if (!active) return;
        active = false;
        removeMatches();
        const index = this.providers.indexOf(provider);
        if (index >= 0) this.providers.splice(index, 1);
        if (this.providers.length === 0) {
          Object.assign(this.env, this.originals);
          this.bindings.clear();
          this.matches.clear();
          this.removed();
        }
      },
      matchedTextures: () => [...this.matches.values()].filter((match) => match.provider === provider).length,
    });
  }

  private observe(upload: TextureUpload): void {
    const heap = this.module.HEAPU8;
    const bytes = validRange(heap, upload.pointer, upload.imageBytes)
      ? heap!.subarray(upload.pointer, upload.pointer + upload.imageBytes)
      : null;
    for (const provider of this.providers) provider.observe?.(upload, bytes);
  }

  private substitute<Result>(pointer: number, bytes: Uint8Array, call: () => Result, provider: TextureUploadProvider): Result {
    const heap = this.module.HEAPU8;
    if (!validRange(heap, pointer, bytes.byteLength)) return call();
    const original = heap!.slice(pointer, pointer + bytes.byteLength);
    heap!.set(bytes, pointer);
    try {
      const result = call();
      provider.replaced?.();
      return result;
    } finally {
      heap!.set(original, pointer);
    }
  }

  private identify(
    texture: number,
    upload: TextureUpload,
    compressed: boolean,
    format: number,
  ): { readonly match: Match; readonly bytes: Uint8Array } | null {
    const heap = this.module.HEAPU8;
    if (!validRange(heap, upload.pointer, upload.imageBytes)) return null;
    if (upload.level > 0) {
      const match = this.matches.get(texture);
      if (!match || match.compressed !== compressed) return null;
      const bytes = compressed
        ? match.provider.compressedReplacement?.(match.value, upload.level, format)
        : match.provider.rgbaReplacement?.(match.value, upload.level);
      return bytes ? { match, bytes } : null;
    }
    for (const provider of this.providers) {
      const value = compressed
        ? provider.identifyCompressed?.(heap!.subarray(upload.pointer, upload.pointer + upload.imageBytes), upload)
        : provider.identifyRgba?.(heap!.subarray(upload.pointer, upload.pointer + upload.imageBytes), upload);
      if (value === null || value === undefined) continue;
      const match = { provider, value, compressed };
      const bytes = compressed
        ? provider.compressedReplacement?.(value, 0, format)
        : provider.rgbaReplacement?.(value, 0);
      if (bytes) return { match, bytes };
    }
    return null;
  }

  private install(): void {
    const bindings = this.bindings;
    const matches = this.matches;
    const module = this.module;
    const observe = this.observe.bind(this);
    const identify = this.identify.bind(this);
    const substitute = this.substitute.bind(this);
    const bindTexture = this.originals.glBindTexture;
    if (bindTexture) this.env.glBindTexture = function (this: unknown, target, texture) {
      const result = bindTexture.call(this, target, texture);
      if (target === GL_TEXTURE_2D) bindings.set(target, texture);
      return result;
    };
    const deleteTextures = this.originals.glDeleteTextures;
    if (deleteTextures) this.env.glDeleteTextures = function (this: unknown, count, pointer) {
      const deleted: number[] = [];
      const length = Number.isSafeInteger(count) && count >= 0 && count <= MAX_TEXTURE_IDS_PER_CALL ? count * 4 : -1;
      const heap = module.HEAPU8;
      if (heap && validRange(heap, pointer, length)) {
        const view = new DataView(heap.buffer, heap.byteOffset + pointer, length);
        for (let index = 0; index < count; index += 1) deleted.push(view.getUint32(index * 4, true));
      }
      const result = deleteTextures.call(this, count, pointer);
      for (const texture of deleted) {
        matches.delete(texture);
        if (bindings.get(GL_TEXTURE_2D) === texture) bindings.delete(GL_TEXTURE_2D);
      }
      return result;
    };
    const storage = this.originals.glTexStorage2D;
    if (storage) this.env.glTexStorage2D = function (this: unknown, target, levels, internalFormat, width, height) {
      const result = storage.call(this, target, levels, internalFormat, width, height);
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture) matches.delete(texture);
      return result;
    };
    const image = this.originals.glTexImage2D!;
    this.env.glTexImage2D = function (this: unknown, target, level, internalFormat, width, height, border, format, type, pixels) {
      const upload: TextureUpload = { kind: "image", target, level, internalFormat, width, height, format, type, imageBytes: width * height * 4, pointer: pixels };
      observe(upload);
      const call = () => image.call(this, target, level, internalFormat, width, height, border, format, type, pixels);
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matches.delete(texture);
      if (!texture || target !== GL_TEXTURE_2D || border !== 0 || format !== GL_RGBA || type !== GL_UNSIGNED_BYTE
        || (internalFormat !== GL_RGBA && internalFormat !== GL_RGBA8)) return call();
      const replacement = identify(texture, upload, false, format);
      if (!replacement || replacement.bytes.byteLength !== upload.imageBytes) return call();
      const result = substitute(pixels, replacement.bytes, call, replacement.match.provider);
      if (level === 0) matches.set(texture, replacement.match);
      return result;
    };
    const subImage = this.originals.glTexSubImage2D;
    if (subImage) this.env.glTexSubImage2D = function (this: unknown, target, level, x, y, width, height, format, type, pixels) {
      const upload: TextureUpload = { kind: "sub-image", target, level, width, height, format, type, imageBytes: width * height * 4, pointer: pixels };
      observe(upload);
      const call = () => subImage.call(this, target, level, x, y, width, height, format, type, pixels);
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matches.delete(texture);
      if (!texture || target !== GL_TEXTURE_2D || x !== 0 || y !== 0 || format !== GL_RGBA || type !== GL_UNSIGNED_BYTE) return call();
      const replacement = identify(texture, upload, false, format);
      if (!replacement || replacement.bytes.byteLength !== upload.imageBytes) return call();
      const result = substitute(pixels, replacement.bytes, call, replacement.match.provider);
      if (level === 0) matches.set(texture, replacement.match);
      return result;
    };
    const compressedImage = this.originals.glCompressedTexImage2D;
    if (compressedImage) this.env.glCompressedTexImage2D = function (this: unknown, target, level, internalFormat, width, height, border, imageBytes, data) {
      const upload: TextureUpload = { kind: "compressed-image", target, level, internalFormat, width, height, imageBytes, pointer: data };
      observe(upload);
      const call = () => compressedImage.call(this, target, level, internalFormat, width, height, border, imageBytes, data);
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matches.delete(texture);
      if (!texture || target !== GL_TEXTURE_2D || border !== 0) return call();
      const replacement = identify(texture, upload, true, internalFormat);
      if (!replacement || replacement.bytes.byteLength !== imageBytes) return call();
      const result = substitute(data, replacement.bytes, call, replacement.match.provider);
      if (level === 0) matches.set(texture, replacement.match);
      return result;
    };
    const compressedSubImage = this.originals.glCompressedTexSubImage2D;
    if (compressedSubImage) this.env.glCompressedTexSubImage2D = function (this: unknown, target, level, x, y, width, height, format, imageBytes, data) {
      const upload: TextureUpload = { kind: "compressed-sub-image", target, level, width, height, format, imageBytes, pointer: data };
      observe(upload);
      const call = () => compressedSubImage.call(this, target, level, x, y, width, height, format, imageBytes, data);
      const texture = target === GL_TEXTURE_2D ? bindings.get(GL_TEXTURE_2D) : undefined;
      if (texture && level === 0) matches.delete(texture);
      if (!texture || target !== GL_TEXTURE_2D || x !== 0 || y !== 0) return call();
      const replacement = identify(texture, upload, true, format);
      if (!replacement || replacement.bytes.byteLength !== imageBytes) return call();
      const result = substitute(data, replacement.bytes, call, replacement.match.provider);
      if (level === 0) matches.set(texture, replacement.match);
      return result;
    };
  }
}

const interceptors = new WeakMap<object, TextureUploadInterceptor>();

export function installTextureUploadProvider(
  imports: TextureImports,
  module: ClientMemory,
  provider: TextureUploadProvider,
): InstalledTextureUploadProvider | null {
  const env = imports.env;
  if (!env || typeof env.glTexImage2D !== "function") return null;
  let interceptor = interceptors.get(env);
  if (!interceptor) {
    interceptor = new TextureUploadInterceptor(env, module, () => interceptors.delete(env));
    interceptors.set(env, interceptor);
  }
  return interceptor.add(provider);
}
