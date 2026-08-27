import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createControllerPromptAtlas,
  certifiedWebGlAtlasTransform,
  identifyControllerPromptAtlas,
  installControllerPromptTexture,
  texmodHash,
  type AtlasTransform,
} from "../../src/renderer/controller-prompt-texture.js";

const WIDTH = 256;
const HEIGHT = 512;
const LENGTH = WIDTH * HEIGHT * 4;

function slowHash(
  bytes: Uint8Array,
  width: number,
  height: number,
  flip: boolean,
  swap: boolean,
) {
  let crc = 0xffffffff;
  for (let y = 0; y < height; y++) {
    const sourceY = flip ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const pixel = (sourceY * width + x) * 4;
      for (const component of swap ? [2, 1, 0, 3] : [0, 1, 2, 3]) {
        crc ^= bytes[pixel + component]!;
        for (let bit = 0; bit < 8; bit++) {
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
      }
    }
  }
  return crc >>> 0;
}

describe("controller prompt texture", () => {
  it("implements the uMod hash for every bounded atlas orientation", () => {
    const bytes = Uint8Array.from({ length: 24 }, (_, index) => index * 7);
    const cases: readonly [AtlasTransform, boolean, boolean][] = [
      ["direct", false, false],
      ["flip-y", true, false],
      ["swap-red-blue", false, true],
      ["flip-y-swap-red-blue", true, true],
    ];
    for (const [mode, flip, swap] of cases) {
      assert.equal(texmodHash(bytes, 3, 2, mode), slowHash(bytes, 3, 2, flip, swap));
    }
    assert.equal(texmodHash(bytes.subarray(1), 3, 2), 0);
  });

  it("refuses arbitrary data instead of matching dimensions alone", () => {
    assert.equal(identifyControllerPromptAtlas(new Uint8Array(LENGTH)), null);
    assert.equal(identifyControllerPromptAtlas(new Uint8Array(100)), null);
  });

  it("pins the WebGL fingerprint to the atlas content instead of the client build", () => {
    assert.equal(certifiedWebGlAtlasTransform(0x74eb6846), "direct");
    assert.equal(certifiedWebGlAtlasTransform(0x74eb6847), null);
  });

  it("substitutes synchronously and restores the client's heap", () => {
    const pointer = 32;
    const original = new Uint8Array(LENGTH).fill(17);
    const replacement = new Uint8Array(LENGTH).fill(91);
    const heap = new Uint8Array(pointer + LENGTH + 16);
    heap.set(original, pointer);
    const uploads: Uint8Array[] = [];
    const env = {
      glBindTexture: (...values: number[]) => { void values; },
      glTexImage2D: (
        _target: number,
        _level: number,
        _internalFormat: number,
        _width: number,
        _height: number,
        _border: number,
        _format: number,
        _type: number,
        pixels: number,
      ) => uploads.push(heap.slice(pixels, pixels + LENGTH)),
    };
    const installed = installControllerPromptTexture({
      imports: { env },
      module: { HEAPU8: heap },
      atlas: createControllerPromptAtlas(replacement),
      identify: () => "direct",
      log: () => undefined,
    });
    env.glBindTexture(0x0de1, 7);
    env.glTexImage2D(0x0de1, 0, 0x1908, WIDTH, HEIGHT, 0, 0x1908, 0x1401, pointer);

    assert.deepEqual(uploads, [replacement]);
    assert.deepEqual(heap.subarray(pointer, pointer + LENGTH), original);
    assert.deepEqual(installed?.snapshot(), {
      replacements: 1,
      matchedTextures: 1,
      candidates: [],
    });
  });

  it("passes mismatches, malformed pointers, and unrelated textures unchanged", () => {
    const pointer = 16;
    const original = new Uint8Array(LENGTH).fill(23);
    const heap = new Uint8Array(pointer + LENGTH);
    heap.set(original, pointer);
    const seen: number[] = [];
    const env = {
      glBindTexture: (...values: number[]) => { void values; },
      glTexImage2D: (
        _target: number,
        _level: number,
        _internalFormat: number,
        _width: number,
        _height: number,
        _border: number,
        _format: number,
        _type: number,
        pixels: number,
      ) => seen.push(heap[pixels] ?? -1),
    };
    installControllerPromptTexture({
      imports: { env },
      module: { HEAPU8: heap },
      atlas: createControllerPromptAtlas(new Uint8Array(LENGTH).fill(99)),
      identify: () => null,
      log: () => undefined,
    });
    env.glBindTexture(0x0de1, 8);
    env.glTexImage2D(0x0de1, 0, 0x1908, WIDTH, HEIGHT, 0, 0x1908, 0x1401, pointer);
    env.glTexImage2D(0x0de1, 0, 0x1908, WIDTH, HEIGHT, 0, 0x1908, 0x1401, heap.length);
    env.glTexImage2D(0x0de1, 0, 0x1908, 128, HEIGHT, 0, 0x1908, 0x1401, pointer);
    assert.deepEqual(seen, [23, -1, 23]);
  });

  it("preserves call receiver, result, and restoration when the upload throws", () => {
    const pointer = 8;
    const heap = new Uint8Array(pointer + LENGTH);
    heap.fill(4, pointer);
    const receiver = { marker: true };
    const env = {
      glBindTexture: (...values: number[]) => { void values; },
      glTexImage2D(
        this: unknown,
        ...parameters: [number, number, number, number, number, number, number, number, number]
      ) {
        void parameters;
        assert.equal(this, receiver);
        assert.equal(heap[pointer], 8);
        throw new Error("upload failed");
      },
    };
    installControllerPromptTexture({
      imports: { env },
      module: { HEAPU8: heap },
      atlas: createControllerPromptAtlas(new Uint8Array(LENGTH).fill(8)),
      identify: () => "direct",
      log: () => undefined,
    });
    env.glBindTexture(0x0de1, 1);
    assert.throws(
      () => env.glTexImage2D.call(
        receiver, 0x0de1, 0, 0x1908, WIDTH, HEIGHT, 0, 0x1908, 0x1401, pointer,
      ),
      /upload failed/u,
    );
    assert.equal(heap[pointer], 4);
  });

  it("also handles an exact full-atlas sub-image upload", () => {
    const pointer = 24;
    const heap = new Uint8Array(pointer + LENGTH);
    heap.fill(3, pointer);
    let uploaded = 0;
    const env = {
      glBindTexture: (...values: number[]) => { void values; },
      glTexImage2D: (
        ...parameters: [number, number, number, number, number, number, number, number, number]
      ) => { void parameters; },
      glTexSubImage2D: (
        _target: number,
        _level: number,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        _format: number,
        _type: number,
        pixels: number,
      ) => { uploaded = heap[pixels]!; },
    };
    installControllerPromptTexture({
      imports: { env },
      module: { HEAPU8: heap },
      atlas: createControllerPromptAtlas(new Uint8Array(LENGTH).fill(77)),
      identify: () => "direct",
      log: () => undefined,
    });
    env.glBindTexture(0x0de1, 5);
    env.glTexSubImage2D(0x0de1, 0, 0, 0, WIDTH, HEIGHT, 0x1908, 0x1401, pointer);
    assert.equal(uploaded, 77);
    assert.equal(heap[pointer], 3);
  });

  it("withdraws a match after every non-certified level-zero mutation and reset", () => {
    const pointer = 32;
    const heap = new Uint8Array(pointer + LENGTH);
    heap.fill(5, pointer);
    const uploads: number[] = [];
    const env = {
      glBindTexture: (...values: number[]) => { void values; },
      glTexImage2D: (
        _target: number, _level: number, _internalFormat: number, _width: number,
        _height: number, _border: number, _format: number, _type: number, pixels: number,
      ) => uploads.push(heap[pixels]!),
      glTexSubImage2D: (...values: number[]) => { void values; },
      glTexStorage2D: (...values: number[]) => { void values; },
      glCompressedTexImage2D: (...values: number[]) => { void values; },
      glCompressedTexSubImage2D: (...values: number[]) => { void values; },
    };
    const installed = installControllerPromptTexture({
      imports: { env },
      module: { HEAPU8: heap },
      atlas: createControllerPromptAtlas(new Uint8Array(LENGTH).fill(99)),
      identify: () => "direct",
      log: () => undefined,
    });
    assert.ok(installed);
    env.glBindTexture(0x0de1, 7);

    const certify = () =>
      env.glTexImage2D(0x0de1, 0, 0x1908, WIDTH, HEIGHT, 0, 0x1908, 0x1401, pointer);
    const uploadMip = () =>
      env.glTexImage2D(0x0de1, 1, 0x1908, WIDTH / 2, HEIGHT / 2, 0, 0x1908, 0x1401, pointer);

    certify();
    uploadMip();
    env.glCompressedTexImage2D(0x0de1, 0, 0x83f3, WIDTH, HEIGHT, 0, 16, pointer);
    uploadMip();
    certify();
    env.glCompressedTexSubImage2D(0x0de1, 0, 0, 0, WIDTH, HEIGHT, 0x83f3, 16, pointer);
    uploadMip();
    certify();
    env.glTexSubImage2D(0x0de1, 0, 1, 1, 1, 1, 0x1908, 0x1401, pointer);
    uploadMip();
    certify();
    env.glTexImage2D(0x0de1, 0, 0x1907, WIDTH, HEIGHT, 0, 0x1907, 0x1401, pointer);
    uploadMip();
    certify();
    env.glTexStorage2D(0x0de1, 10, 0x8058, WIDTH, HEIGHT);
    uploadMip();
    certify();
    installed.reset();
    uploadMip();

    assert.deepEqual(uploads, [99, 99, 5, 99, 5, 99, 5, 99, 5, 5, 99, 5, 99, 5]);
    assert.equal(installed.snapshot().matchedTextures, 0);
  });

  it("bounds texture deletion bookkeeping and never blocks malformed client calls", () => {
    const pointer = 32;
    const heap = new Uint8Array(pointer + LENGTH);
    heap.fill(11, pointer);
    new DataView(heap.buffer).setUint32(4, 7, true);
    const deleted: Array<[number, number]> = [];
    const uploads: number[] = [];
    const env = {
      glBindTexture: (...values: number[]) => { void values; },
      glDeleteTextures: (count: number, textures: number) => deleted.push([count, textures]),
      glTexImage2D: (
        _target: number, _level: number, _internalFormat: number, _width: number,
        _height: number, _border: number, _format: number, _type: number, pixels: number,
      ) => uploads.push(heap[pixels]!),
    };
    const installed = installControllerPromptTexture({
      imports: { env },
      module: { HEAPU8: heap },
      atlas: createControllerPromptAtlas(new Uint8Array(LENGTH).fill(88)),
      identify: () => "direct",
      log: () => undefined,
    });
    assert.ok(installed);
    env.glBindTexture(0x0de1, 7);
    env.glTexImage2D(0x0de1, 0, 0x1908, WIDTH, HEIGHT, 0, 0x1908, 0x1401, pointer);

    assert.doesNotThrow(() => env.glDeleteTextures(-1, 8));
    assert.doesNotThrow(() => env.glDeleteTextures(Number.MAX_SAFE_INTEGER, 8));
    assert.doesNotThrow(() => env.glDeleteTextures(4097, 8));
    assert.equal(installed.snapshot().matchedTextures, 1);

    env.glDeleteTextures(1, 4);
    assert.equal(installed.snapshot().matchedTextures, 0);
    env.glBindTexture(0x0de1, 7);
    env.glTexImage2D(0x0de1, 1, 0x1908, WIDTH / 2, HEIGHT / 2, 0, 0x1908, 0x1401, pointer);
    assert.equal(uploads.at(-1), 11, "a reused texture id must not inherit the deleted match");
    assert.deepEqual(deleted, [
      [-1, 8],
      [Number.MAX_SAFE_INTEGER, 8],
      [4097, 8],
      [1, 4],
    ]);
  });

  it("fails closed when the required texture import is absent", () => {
    const logs: unknown[][] = [];
    assert.equal(installControllerPromptTexture({
      imports: { env: {} },
      module: {},
      atlas: createControllerPromptAtlas(new Uint8Array(LENGTH)),
      identify: () => "direct",
      log: (...values) => logs.push(values),
    }), null);
    assert.match(String(logs[0]?.[0]), /unavailable/u);
  });
});
