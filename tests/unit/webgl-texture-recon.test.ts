import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installWebGlTextureRecon } from "../../src/renderer/webgl-texture-recon.ts";

const GL_TEXTURE_2D = 0x0de1;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;

describe("WebGL texture recon", () => {
  it("correlates bounded upload fingerprints with later draw activity", () => {
    const heap = new Uint8Array(128);
    heap.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 32);
    const calls: string[] = [];
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; calls.push("bind"); },
      glTexImage2D(...values: number[]) { void values; calls.push("upload"); },
      glDrawElements(...values: number[]) { void values; calls.push("draw"); return 17; },
    } };
    const recon = installWebGlTextureRecon({
      imports,
      module: { HEAPU8: heap },
      log: () => {},
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
    assert.equal(imports.env.glDrawElements(4, 6, 0x1403, 0), 17);

    const first = recon.checkpoint();
    assert.deepEqual(calls, ["bind", "upload", "draw"]);
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
      intervalDrawUses: 1,
    }]);
    assert.equal(first.exactReplacement, null);

    assert.deepEqual(recon.checkpoint().records, []);
    imports.env.glDrawElements(4, 6, 0x1403, 0);
    assert.deepEqual(recon.checkpoint().records, []);
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glDrawElements(4, 6, 0x1403, 0);
    assert.equal(recon.checkpoint().records[0]?.intervalDrawUses, 1);
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
    });
    if (!recon) assert.fail("texture recon did not install");
    imports.env.glBindTexture(GL_TEXTURE_2D, 3);
    recon.resetContext();
    imports.env.glDrawArrays(4, 0, 3);
    assert.deepEqual(recon.checkpoint(), {
      trackedTextures: 0,
      saturated: false,
      exactReplacement: null,
      records: [],
    });
  });

  it("temporarily replaces one exact 512px RGBA sub-image and restores WASM memory", () => {
    const length = 512 * 512 * 4;
    const pointer = 16;
    const heap = new Uint8Array(pointer + length);
    heap.fill(7, pointer);
    const original = heap.slice(pointer);
    let uploadStartedWithCheckerboard = false;
    const imports = { env: {
      glBindTexture(...values: number[]) { void values; },
      glTexSubImage2D(...values: number[]) {
        void values;
        uploadStartedWithCheckerboard = heap[pointer] === 255
          && heap[pointer + 1] === 0
          && heap[pointer + 2] === 255
          && heap[pointer + 128] === 0
          && heap[pointer + 129] === 255
          && heap[pointer + 130] === 255;
      },
    } };
    const recon = installWebGlTextureRecon({ imports, module: { HEAPU8: heap }, log: () => {} });
    if (!recon) assert.fail("texture recon did not install");
    assert.equal(recon.armExactReplacement("fnv1a32:c5ec9dc5"), true);
    imports.env.glBindTexture(GL_TEXTURE_2D, 11);
    imports.env.glTexSubImage2D(
      GL_TEXTURE_2D, 0, 0, 0, 512, 512, GL_RGBA, GL_UNSIGNED_BYTE, pointer,
    );

    assert.equal(uploadStartedWithCheckerboard, true);
    assert.deepEqual(heap.slice(pointer), original);
    assert.deepEqual(recon.checkpoint().exactReplacement, {
      fingerprint: "fnv1a32:c5ec9dc5",
      replacements: 1,
    });
  });
});
