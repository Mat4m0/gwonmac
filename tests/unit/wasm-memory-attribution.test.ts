import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installWasmMemoryAttribution,
  parseWasmStack,
  textureLevelBytes,
} from "../../src/renderer/wasm-memory-attribution.ts";

const GL_TEXTURE_2D = 0x0de1;
const GL_RGBA = 0x1908;
const GL_RGBA8 = 0x8058;
const GL_UNSIGNED_BYTE = 0x1401;

describe("WASM growth provenance", () => {
  it("keeps only the first four numeric WASM frames", () => {
    assert.deepEqual(
      parseWasmStack([
        "Error: growth",
        "    at wrapper (memory-investigation.js:10:2)",
        "    at wasm-function[17792]:0x643e6f",
        "    at wasm-function[17784]:0x641dc5",
        "    at wasm-function[7]:0xaa",
        "    at wasm-function[8]:0xbb",
        "    at wasm-function[9]:0xcc",
      ].join("\n")),
      [
        { functionIndex: 17_792, codeOffset: 0x643e6f },
        { functionIndex: 17_784, codeOffset: 0x641dc5 },
        { functionIndex: 7, codeOffset: 0xaa },
        { functionIndex: 8, codeOffset: 0xbb },
      ],
    );
  });

  it("records the request, result, call stack, and current texture state", () => {
    const module = { HEAPU8: new Uint8Array(128) };
    new DataView(module.HEAPU8.buffer).setUint32(0, 7, true);
    const observations: Array<Record<string, unknown>> = [];
    const noop = (...values: number[]) => { void values; };
    const imports = {
      env: {
        emscripten_resize_heap(requestedBytes: number) {
          module.HEAPU8 = new Uint8Array(requestedBytes);
          return true;
        },
        glGenTextures: noop,
        glDeleteTextures: noop,
        glBindTexture: noop,
        glTexStorage2D: noop,
        glTexSubImage2D: noop,
      },
    };
    const investigation = installWasmMemoryAttribution({
      imports,
      module,
      recordGrowth: (fields) => observations.push(fields),
      captureStack: () => [
        "Error: growth",
        "    at wasm-function[17792]:0x643e6f",
        "    at wasm-function[17784]:0x641dc5",
      ].join("\n"),
      log: () => {},
    });

    imports.env.glGenTextures(1, 0);
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glTexStorage2D(GL_TEXTURE_2D, 2, GL_RGBA8, 4, 4);
    imports.env.glTexSubImage2D(
      GL_TEXTURE_2D,
      0,
      0,
      0,
      2,
      2,
      GL_RGBA,
      GL_UNSIGNED_BYTE,
      16,
    );
    assert.equal(imports.env.emscripten_resize_heap(256), true);

    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0], {
      requestedBytes: 256,
      beforeBytes: 128,
      afterBytes: 256,
      outcome: "grown",
      stackFingerprint: "211ffc96",
      stackDepth: 2,
      frame0Function: 17_792,
      frame0Offset: 0x643e6f,
      frame1Function: 17_784,
      frame1Offset: 0x641dc5,
      frame2Function: 0,
      frame2Offset: 0,
      frame3Function: 0,
      frame3Offset: 0,
      generatedTextures: 1,
      deletedTextures: 0,
      liveTextures: 1,
      trackedTextures: 1,
      knownTextureBytes: 80,
      textureUploadBytes: 16,
      unknownTextureAllocations: 0,
      textureTrackingSaturated: false,
    });
    assert.deepEqual(investigation?.snapshot(), {
      generatedTextures: 1,
      deletedTextures: 0,
      liveTextures: 1,
      trackedTextures: 1,
      knownTextureBytes: 80,
      textureUploadBytes: 16,
      unknownTextureAllocations: 0,
      textureTrackingSaturated: false,
    });
  });

  it("distinguishes a refused resize from one that throws", () => {
    const refused: Array<Record<string, unknown>> = [];
    const refusedImports = {
      env: {
        emscripten_resize_heap(requestedBytes: number) {
          void requestedBytes;
          return false;
        },
      },
    };
    installWasmMemoryAttribution({
      imports: refusedImports,
      module: { HEAPU8: new Uint8Array(64) },
      recordGrowth: (fields) => refused.push(fields),
      captureStack: () => "",
      log: () => {},
    });
    assert.equal(refusedImports.env.emscripten_resize_heap(128), false);
    assert.equal(refused[0]?.outcome, "refused");
    assert.equal(refused[0]?.beforeBytes, 64);
    assert.equal(refused[0]?.afterBytes, 64);

    const thrown: Array<Record<string, unknown>> = [];
    const failure = new Error("resize failed");
    const thrownImports = {
      env: {
        emscripten_resize_heap(requestedBytes: number): never {
          void requestedBytes;
          throw failure;
        },
      },
    };
    installWasmMemoryAttribution({
      imports: thrownImports,
      module: { HEAPU8: new Uint8Array(64) },
      recordGrowth: (fields) => thrown.push(fields),
      captureStack: () => "",
      log: () => {},
    });
    assert.throws(
      () => thrownImports.env.emscripten_resize_heap(128),
      (error) => error === failure,
    );
    assert.equal(thrown[0]?.outcome, "threw");
  });

  it("preserves the allocator contract when observation itself fails", () => {
    const receiver = { marker: "original receiver" };
    const seen: unknown[][] = [];
    const warnings: unknown[][] = [];
    const imports = {
      env: {
        emscripten_resize_heap(this: unknown, requestedBytes: number) {
          seen.push([this, requestedBytes]);
          return "original result";
        },
      },
    };
    installWasmMemoryAttribution({
      imports,
      module: { HEAPU8: new Uint8Array(64) },
      recordGrowth: () => {
        throw new Error("recorder unavailable");
      },
      captureStack: () => {
        throw new Error("stack unavailable");
      },
      log: (...values) => warnings.push(values),
    });

    assert.equal(
      imports.env.emscripten_resize_heap.call(receiver, 123),
      "original result",
    );
    assert.deepEqual(seen, [[receiver, 123]]);
    assert.equal(warnings.length, 1);
  });

  it("does not alter imports when the shipped client lacks the resize boundary", () => {
    const warnings: unknown[][] = [];
    const imports = { env: {} };
    assert.equal(installWasmMemoryAttribution({
      imports,
      module: { HEAPU8: new Uint8Array(0) },
      recordGrowth: () => assert.fail("growth must not be recorded"),
      log: (...values) => warnings.push(values),
    }), null);
    assert.equal("emscripten_resize_heap" in imports.env, false);
    assert.equal(warnings.length, 1);
  });

  it("stops retaining texture identities at the documented bound", () => {
    const module = { HEAPU8: new Uint8Array(4_096 * 4) };
    let nextTexture = 1;
    const imports = {
      env: {
        emscripten_resize_heap(requestedBytes: number) {
          void requestedBytes;
          return false;
        },
        glGenTextures(count: number, pointer: number) {
          const view = new DataView(module.HEAPU8.buffer);
          for (let index = 0; index < count; index++) {
            view.setUint32(pointer + index * 4, nextTexture++, true);
          }
        },
      },
    };
    const investigation = installWasmMemoryAttribution({
      imports,
      module,
      recordGrowth: () => {},
      captureStack: () => "",
      log: () => {},
    });

    imports.env.glGenTextures(4_096, 0);
    imports.env.glGenTextures(1, 0);

    assert.equal(investigation?.snapshot().generatedTextures, 4_097);
    assert.equal(investigation?.snapshot().trackedTextures, 4_096);
    assert.equal(investigation?.snapshot().textureTrackingSaturated, true);
  });

  it("drops dead-context residency before texture ids can be reused", () => {
    const module = { HEAPU8: new Uint8Array(16) };
    const textureIds = new DataView(module.HEAPU8.buffer);
    const noop = (...values: number[]) => { void values; };
    const imports = {
      env: {
        emscripten_resize_heap: () => false,
        glGenTextures: noop,
        glBindTexture: noop,
        glTexStorage2D: noop,
      },
    };
    const investigation = installWasmMemoryAttribution({
      imports,
      module,
      recordGrowth: () => {},
      log: () => {},
    });
    if (!investigation) assert.fail("memory attribution was not installed");

    textureIds.setUint32(0, 7, true);
    imports.env.glGenTextures(1, 0);
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, 4, 4);
    assert.equal(investigation.snapshot().knownTextureBytes, 64);

    investigation.resetContext();
    assert.deepEqual(investigation.snapshot(), {
      generatedTextures: 0,
      deletedTextures: 0,
      liveTextures: 0,
      trackedTextures: 0,
      knownTextureBytes: 0,
      textureUploadBytes: 0,
      unknownTextureAllocations: 0,
      textureTrackingSaturated: false,
    });

    imports.env.glGenTextures(1, 0);
    imports.env.glBindTexture(GL_TEXTURE_2D, 7);
    imports.env.glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, 2, 2);
    assert.equal(investigation.snapshot().knownTextureBytes, 16);
    assert.equal(investigation.snapshot().trackedTextures, 1);
  });
});

describe("texture storage estimates", () => {
  it("covers direct and block-compressed formats without guessing unknown ones", () => {
    assert.equal(textureLevelBytes(GL_RGBA8, 8, 4), 128);
    assert.equal(textureLevelBytes(0x83f0, 3, 3), 8);
    assert.equal(textureLevelBytes(0x83f3, 5, 5), 64);
    assert.equal(textureLevelBytes(0xdead, 8, 8), null);
  });
});
