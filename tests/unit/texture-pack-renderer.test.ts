import assert from "node:assert/strict";
import test from "node:test";
import { texmodHash, texmodRawHash } from "../../src/renderer/controller-prompt-texture.js";
import { createControllerPromptAtlas, installControllerPromptTexture } from "../../src/renderer/controller-prompt-texture.js";
import { installTexturePack } from "../../src/renderer/texture-pack.js";

test("replaces an exact RGBA TexMod target only for the synchronous upload", () => {
  const original = Uint8Array.from([1, 2, 3, 255]);
  const replacement = Uint8Array.from([20, 30, 40, 200]);
  const heap = new Uint8Array(128);
  heap.set(original, 32);
  let uploaded: number[] = [];
  const env = {
    glBindTexture: (...args: number[]) => void args,
    glTexImage2D: (_target: number, _level: number, _internal: number, _width: number, _height: number, _border: number, _format: number, _type: number, pointer: number) => {
      uploaded = [...heap.subarray(pointer, pointer + 4)];
    },
  };
  const installed = installTexturePack({
    imports: { env },
    module: { HEAPU8: heap },
    entries: [{
      target: texmodHash(original, 1, 1),
      width: 1,
      height: 1,
      levels: [replacement],
    }],
    log: () => undefined,
  });
  env.glBindTexture(0x0de1, 9);
  env.glTexImage2D(0x0de1, 0, 0x1908, 1, 1, 0, 0x1908, 0x1401, 32);
  assert.deepEqual(uploaded, [...replacement]);
  assert.deepEqual([...heap.subarray(32, 36)], [...original]);
  assert.equal(installed?.snapshot().replacements, 1);
});

test("replaces exact compressed DXT blocks and restores client memory", () => {
  const original = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const replacement = Uint8Array.from([8, 7, 6, 5, 4, 3, 2, 1]);
  const heap = new Uint8Array(128);
  heap.set(original, 32);
  let uploaded: number[] = [];
  const env = {
    glBindTexture: (...args: number[]) => void args,
    glTexImage2D: () => undefined,
    glCompressedTexImage2D: (_target: number, _level: number, _format: number, _width: number, _height: number, _border: number, bytes: number, pointer: number) => {
      uploaded = [...heap.subarray(pointer, pointer + bytes)];
    },
  };
  installTexturePack({
    imports: { env },
    module: { HEAPU8: heap },
    entries: [{
      target: texmodRawHash(original),
      width: 4,
      height: 4,
      levels: [new Uint8Array(64)],
      compressed: { mode: "DXT1", levels: [replacement] },
    }],
    log: () => undefined,
  });
  env.glBindTexture(0x0de1, 3);
  env.glCompressedTexImage2D(0x0de1, 0, 0x83f1, 4, 4, 0, 8, 32);
  assert.deepEqual(uploaded, [...replacement]);
  assert.deepEqual([...heap.subarray(32, 40)], [...original]);
});

test("uses a red-blue swap only to identify a Direct3D hash", () => {
  const originalWebGl = Uint8Array.from([10, 20, 30, 255]);
  const replacementRgba = Uint8Array.from([240, 12, 5, 255]);
  const heap = new Uint8Array(64);
  heap.set(originalWebGl, 16);
  let uploaded: number[] = [];
  const env = {
    glBindTexture: (...args: number[]) => void args,
    glTexImage2D: (
      _target: number, _level: number, _internal: number, _width: number, _height: number,
      _border: number, _format: number, _type: number, pointer: number,
    ) => { uploaded = [...heap.subarray(pointer, pointer + 4)]; },
  };
  installTexturePack({
    imports: { env },
    module: { HEAPU8: heap },
    entries: [{
      target: texmodHash(originalWebGl, 1, 1, "swap-red-blue"),
      width: 1,
      height: 1,
      levels: [replacementRgba],
    }],
    log: () => undefined,
  });
  env.glBindTexture(0x0de1, 7);
  env.glTexImage2D(0x0de1, 0, 0x1908, 1, 1, 0, 0x1908, 0x1401, 16);

  assert.deepEqual(uploaded, [...replacementRgba]);
  assert.ok(uploaded[0]! > uploaded[2]!, "the intended red channel must remain red");
});

test("gives controller prompts explicit priority and restores imports after disposal", () => {
  const width = 256;
  const height = 512;
  const length = width * height * 4;
  const original = new Uint8Array(length).fill(1);
  const packReplacement = new Uint8Array(length).fill(40);
  const controllerReplacement = new Uint8Array(length).fill(90);
  const heap = new Uint8Array(length + 32);
  heap.set(original, 16);
  const uploads: number[] = [];
  const originalUpload = (
    _target: number, _level: number, _internal: number, _width: number, _height: number,
    _border: number, _format: number, _type: number, pointer: number,
  ) => { uploads.push(heap[pointer]!); };
  const env = {
    glBindTexture: (...args: number[]) => void args,
    glTexImage2D: originalUpload,
  };
  const pack = installTexturePack({
    imports: { env },
    module: { HEAPU8: heap },
    entries: [{
      target: texmodHash(original, width, height),
      width,
      height,
      levels: [packReplacement],
    }],
    log: () => undefined,
  });
  const controller = installControllerPromptTexture({
    imports: { env },
    module: { HEAPU8: heap },
    atlas: createControllerPromptAtlas(controllerReplacement),
    identify: () => "direct",
    log: () => undefined,
  });
  env.glBindTexture(0x0de1, 1);
  env.glTexImage2D(0x0de1, 0, 0x1908, width, height, 0, 0x1908, 0x1401, 16);
  controller?.dispose();
  env.glTexImage2D(0x0de1, 0, 0x1908, width, height, 0, 0x1908, 0x1401, 16);
  pack?.dispose();
  assert.deepEqual(uploads, [90, 40]);
  assert.strictEqual(env.glTexImage2D, originalUpload);
});
