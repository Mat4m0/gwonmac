import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installWebGlTextureRecon } from "../../src/renderer/webgl-texture-recon.ts";

const GL_TEXTURE_2D = 0x0de1;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;

describe("WebGL texture recon", () => {
  it("correlates bounded upload fingerprints with normalized bind activity", () => {
    const heap = new Uint8Array(128);
    heap.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 32);
    const calls: string[] = [];
    let now = 100;
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; calls.push("bind"); },
      glTexImage2D(...values: number[]) { void values; calls.push("upload"); },
    } };
    const recon = installWebGlTextureRecon({
      imports,
      module: { HEAPU8: heap },
      log: () => {},
      now: () => now,
    });
    if (!recon) assert.fail("texture recon did not install");

    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glTexImage2D(
      GL_TEXTURE_2D,
      0,
      GL_RGBA,
      2,
      2,
      0,
      GL_RGBA,
      GL_UNSIGNED_BYTE,
      32,
    );
    now = 2_100;

    const first = recon.checkpoint();
    assert.deepEqual(calls, ["bind", "upload"]);
    assert.equal(first.intervalDurationMs, 2_000);
    assert.equal(first.trackedTextures, 1);
    assert.deepEqual(first.records, [{
      texture: 7,
      width: 2,
      height: 2,
      level: 0,
      internalFormat: GL_RGBA,
      format: GL_RGBA,
      type: GL_UNSIGNED_BYTE,
      uploadKind: "image",
      uploadBytes: 16,
      fingerprint: "fnv1a32:ae8e8135",
      intervalUploads: 1,
      intervalBinds: 0,
      bindsPerSecond: 0,
    }]);
    assert.deepEqual(first.exactReplacements, []);

    assert.deepEqual(recon.checkpoint().records, []);
    now = 3_100;
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    assert.equal(recon.checkpoint().records[0]?.bindsPerSecond, 2);
  });

  it("refuses invalid and oversized memory ranges without changing the GL call", () => {
    let uploads = 0;
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glTexImage2D(...values: number[]) { void values; uploads += 1; },
    } };
    const recon = installWebGlTextureRecon({
      imports,
      module: { HEAPU8: new Uint8Array(64) },
      log: () => {},
    });
    if (!recon) assert.fail("texture recon did not install");

    imports.env.glBindTexture(GL_TEXTURE_2D, 9);
    imports.env.glTexImage2D(
      GL_TEXTURE_2D,
      0,
      GL_RGBA,
      2_048,
      2_048,
      0,
      GL_RGBA,
      GL_UNSIGNED_BYTE,
      60,
    );

    assert.equal(uploads, 1);
    assert.equal(recon.checkpoint().records[0]?.fingerprint, null);
  });

  it("clears stale texture identities on a graphics-context reset", () => {
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glDrawArrays(...values: number[]) { void values; },
    } };
    const recon = installWebGlTextureRecon({
      imports,
      module: { HEAPU8: new Uint8Array(16) },
      log: () => {},
      now: () => 1,
    });
    if (!recon) assert.fail("texture recon did not install");
    imports.env.glBindTexture(GL_TEXTURE_2D, 3);
    recon.resetContext();
    imports.env.glDrawArrays(4, 0, 3);
    assert.deepEqual(recon.checkpoint(), {
      intervalDurationMs: 0,
      trackedTextures: 0,
      saturated: false,
      exactReplacements: [],
      records: [],
    });
  });

  it("temporarily replaces two exact tiles with independent colors and retains original fingerprints", () => {
    const length = 512 * 512 * 4;
    const pointer = 16;
    const secondPointer = pointer + length;
    const heap = new Uint8Array(secondPointer + length);
    heap.fill(7, pointer);
    heap.fill(8, secondPointer);
    const originals = heap.slice(pointer);
    const fingerprintOf = (start: number) => {
      let hash = 0x811c9dc5;
      for (let index = start; index < start + length; index += 1) {
        hash ^= heap[index]!;
        hash = Math.imul(hash, 0x01000193);
      }
      return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
    };
    const firstFingerprint = fingerprintOf(pointer);
    const secondFingerprint = fingerprintOf(secondPointer);
    const uploadedColors: number[][] = [];
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glTexSubImage2D(...values: number[]) {
        const pixels = values[8]!;
        uploadedColors.push([
          ...heap.slice(pixels, pixels + 3),
          ...heap.slice(pixels + 128, pixels + 131),
        ]);
      },
    } };
    const recon = installWebGlTextureRecon({ imports, module: { HEAPU8: heap }, log: () => {} });
    if (!recon) assert.fail("texture recon did not install");
    assert.equal(recon.armExactReplacements([
      { fingerprint: firstFingerprint, palette: "magenta-cyan" },
      { fingerprint: secondFingerprint, palette: "yellow-blue" },
    ]), true);
    imports.env.glBindTexture(GL_TEXTURE_2D, 11);
    imports.env.glTexSubImage2D(
      GL_TEXTURE_2D, 0, 0, 0, 512, 512, GL_RGBA, GL_UNSIGNED_BYTE, pointer,
    );
    imports.env.glBindTexture(GL_TEXTURE_2D, 12);
    imports.env.glTexSubImage2D(
      GL_TEXTURE_2D, 0, 0, 0, 512, 512, GL_RGBA, GL_UNSIGNED_BYTE, secondPointer,
    );

    assert.deepEqual(uploadedColors, [
      [255, 0, 255, 0, 255, 255],
      [255, 255, 0, 0, 64, 255],
    ]);
    assert.deepEqual(heap.slice(pointer), originals);
    const snapshot = recon.checkpoint();
    assert.deepEqual(snapshot.exactReplacements, [
      { fingerprint: firstFingerprint, palette: "magenta-cyan", replacements: 1 },
      { fingerprint: secondFingerprint, palette: "yellow-blue", replacements: 1 },
    ]);
    assert.deepEqual(snapshot.records.map(({ fingerprint }) => fingerprint), [
      firstFingerprint,
      secondFingerprint,
    ]);
  });

  it("passes a fingerprint mismatch through unchanged", () => {
    const length = 512 * 512 * 4;
    const pointer = 16;
    const heap = new Uint8Array(pointer + length);
    heap.fill(7, pointer);
    const seen: number[] = [];
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glTexSubImage2D(...values: number[]) { seen.push(heap[values[8]!]!); },
    } };
    const recon = installWebGlTextureRecon({ imports, module: { HEAPU8: heap }, log: () => {} });
    if (!recon) assert.fail("texture recon did not install");
    assert.equal(recon.armExactReplacements([
      { fingerprint: "fnv1a32:00000001", palette: "magenta-cyan" },
      { fingerprint: "fnv1a32:00000002", palette: "yellow-blue" },
    ]), true);
    imports.env.glBindTexture(GL_TEXTURE_2D, 11);
    imports.env.glTexSubImage2D(
      GL_TEXTURE_2D, 0, 0, 0, 512, 512, GL_RGBA, GL_UNSIGNED_BYTE, pointer,
    );
    assert.deepEqual(seen, [7]);
    assert.deepEqual(recon.checkpoint().exactReplacements.map(({ replacements }) => replacements), [0, 0]);
  });

  it("restores WASM memory when the synchronous upload throws", () => {
    const length = 512 * 512 * 4;
    const pointer = 16;
    const heap = new Uint8Array(pointer + length);
    heap.fill(7, pointer);
    const original = heap.slice(pointer);
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glTexSubImage2D(...values: number[]) { void values; throw new Error("upload failed"); },
    } };
    const recon = installWebGlTextureRecon({ imports, module: { HEAPU8: heap }, log: () => {} });
    if (!recon) assert.fail("texture recon did not install");
    assert.equal(recon.armExactReplacements([
      { fingerprint: "fnv1a32:c5ec9dc5", palette: "magenta-cyan" },
      { fingerprint: "fnv1a32:00000002", palette: "yellow-blue" },
    ]), true);
    imports.env.glBindTexture(GL_TEXTURE_2D, 11);
    assert.throws(() => imports.env.glTexSubImage2D(
      GL_TEXTURE_2D, 0, 0, 0, 512, 512, GL_RGBA, GL_UNSIGNED_BYTE, pointer,
    ), /upload failed/u);
    assert.deepEqual(heap.slice(pointer), original);
  });

  it("clears tracked lifecycle state and replacement counts on context reset", () => {
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glTexImage2D(...values: number[]) { void values; },
    } };
    const heap = new Uint8Array(128);
    heap.fill(1, 32, 48);
    const recon = installWebGlTextureRecon({ imports, module: { HEAPU8: heap }, log: () => {} });
    if (!recon) assert.fail("texture recon did not install");
    assert.equal(recon.armExactReplacements([
      { fingerprint: "fnv1a32:00000001", palette: "magenta-cyan" },
      { fingerprint: "fnv1a32:00000002", palette: "yellow-blue" },
    ]), true);
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, 32);
    assert.equal(recon.checkpoint().trackedTextures, 1);
    recon.resetContext();
    const reset = recon.checkpoint();
    assert.equal(reset.trackedTextures, 0);
    assert.deepEqual(reset.records, []);
    assert.deepEqual(reset.exactReplacements.map(({ replacements }) => replacements), [0, 0]);
  });
});
