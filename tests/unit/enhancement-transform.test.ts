import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  enhancementConfigWords,
  ENHANCEMENT_BUILDS,
  type KnownEnhancementBuild,
} from "../../src/main/core/enhancement-builds.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/core/template-save-compat.js";
import {
  inspectEnhancementCandidate,
  ENHANCEMENT_HOOK_EXPORT,
  ENHANCEMENT_CURSOR_ORIGINAL_EXPORT,
  ENHANCEMENT_MANIFEST_SECTION,
  ENHANCEMENT_ORIGINAL_EXPORT,
  ENHANCEMENT_UI_ORIGINAL_EXPORT,
  ENHANCEMENT_TRANSFORM_ABI,
  transformEnhancementWasm,
} from "../../src/main/core/enhancement-transform.js";

function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

// `hookParamType` is the WebAssembly value type of the main loop's single
// parameter: 0x7f is i32, the signature every certified build declares. A
// caller passes another one — 0x7e is i64 — to build the module a manifest
// does not certify, which is the only side the mismatch can come from: a
// KnownEnhancementBuild's hookParams is the literal ["i32"] and cannot say
// otherwise.
function fixture(occupied = false, hookParamType = 0x7f): Uint8Array {
  const type = section(1, [
    3,
    0x60, 1, hookParamType, 0,
    0x60, 5, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0,
    0x60, 3, 0x7f, 0x7f, 0x7f, 0,
  ]);
  const env = [3, 101, 110, 118];
  const imports = section(2, [
    3,
    ...env, 1, 116, 0, 0,
    ...env, 1, 99, 0, 1,
    ...env, 1, 117, 0, 2,
  ]);
  const functions = section(3, [3, 0, 1, 2]);
  const table = section(4, [1, 0x70, 1, 4, 4]);
  const globals = section(6, [0]);
  const tableName = [...uleb(3), 116, 98, 108];
  const loopName = [...new TextEncoder().encode("EmscriptenExeThreadMainLoop")];
  const cursorName = [...new TextEncoder().encode("cursor")];
  const uiName = [...new TextEncoder().encode("ui")];
  const exports = section(7, [
    4,
    ...tableName, 1, 0,
    ...uleb(loopName.length), ...loopName, 0, 3,
    ...uleb(cursorName.length), ...cursorName, 0, 4,
    ...uleb(uiName.length), ...uiName, 0, 5,
  ]);
  const occupiedSegment = occupied
    ? [1, 0, 0x41, 0, 0x0b, 1, 3]
    : [0];
  const mappedSegment = [0, 0x41, 1, 0x0b, 3, 4, 3, 5];
  const elements = section(9, [
    occupied ? 2 : 1,
    ...(occupied ? occupiedSegment.slice(1) : []),
    ...mappedSegment,
  ]);
  const tick = [0, 0x20, 0, 0x10, 0, 0x0b];
  const cursor = [
    0, 0x20, 0, 0x20, 1, 0x20, 2, 0x20, 3, 0x20, 4, 0x10, 1, 0x0b,
  ];
  const ui = [0, 0x20, 0, 0x20, 1, 0x20, 2, 0x10, 2, 0x0b];
  const code = section(10, [
    3,
    ...uleb(tick.length), ...tick,
    ...uleb(cursor.length), ...cursor,
    ...uleb(ui.length), ...ui,
  ]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type, ...imports, ...functions, ...table, ...globals, ...exports,
    ...elements, ...code,
  ]);
}

function manifest(bytes: Uint8Array): KnownEnhancementBuild {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    programId: 1,
    buildId: 1,
    hookFunction: 3,
    hookParams: ["i32"],
    hookResults: [],
    tableSlot: 0,
    cursorEvent: {
      functionIndex: 4,
      params: ["i32", "i32", "i32", "i32", "i32"],
      results: [],
      tableSlot: 1,
      producerFunctions: [4, 4],
    },
    uiDispatcher: {
      functionIndex: 5,
      params: ["i32", "i32", "i32"],
      results: [],
      playerChatMessage: 0x1000_0082,
      hideHeroPanelMessage: 0x1000_01a3,
      showHeroPanelMessage: 0x1000_01a4,
      playerChatProducer: 5,
      playerChatSites: 3,
      nearbyPlayerMessageProducers: [5, 5],
    },
    layout: {
      contextRoot: 1, agentArray: 2, manualTargetAgentId: 3,
      automaticTargetAgentId: 4, gameContextSlot: 6, characterContext: 4,
      mapId: 5, isExplorable: 6, currentMapId: 7, currentInstanceType: 8,
      playerNumber: 9, agentId: 10, agentX: 11, agentY: 12, agentType: 13,
      agentPlayerNumber: 14, agentModelType: 15,
      cursorActiveArt: 16, cursorSoftwareModel: 17, cursorShowCount: 18,
      cursorColorBuffer: 19, cursorArtHotspot: 0, cursorArtTexture: 12,
      cursorHandleKey: 8, cursorHandleObject: 0, cursorViewTexture: 8,
      cursorTextureType: 12, cursorTextureWidth: 20, cursorTextureHeight: 24,
      partyContext: 28, playerParty: 32, partyHeroes: 36,
      heroMemberStride: 24, heroAgentId: 0, heroOwnerPlayerId: 4, heroId: 8,
      propContextSlot: 40,
    },
  };
}

function callbackFixture(): Uint8Array {
  const type = section(1, [
    1, 0x60, 6, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0,
  ]);
  const imports = section(2, [
    1, 3, 101, 110, 118, 8, 100, 105, 115, 112, 97, 116, 99, 104, 0, 0,
  ]);
  const functions = section(3, [1, 0]);
  const name = [...new TextEncoder().encode("callback")];
  const exports = section(7, [1, ...uleb(name.length), ...name, 0, 1]);
  const body = [
    0,
    0x20, 0, 0x20, 1, 0x20, 2, 0x20, 3, 0x20, 4, 0x20, 5,
    0x10, 0,
    0x0b,
  ];
  const code = section(10, [1, ...uleb(body.length), ...body]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type, ...imports, ...functions, ...exports, ...code,
  ]);
}

describe("targeted Enhancement WebAssembly transform", () => {
  it("is deterministic, valid, and exports only the hook contract", () => {
    const input = fixture();
    const build = manifest(input);
    const first = transformEnhancementWasm(input, build);
    const second = transformEnhancementWasm(input, build);
    assert.deepEqual(first, second);
    // The transform returns a plain Uint8Array, which says nothing about the
    // buffer behind it, and WebAssembly takes only an unshared one. The copy
    // is the same bytes in a buffer the checker can see is not shared.
    const bytes = new Uint8Array(first);
    assert.equal(WebAssembly.validate(bytes), true);
    const module = new WebAssembly.Module(bytes);
    const names = WebAssembly.Module.exports(module).map((entry) => entry.name);
    assert.ok(names.includes(ENHANCEMENT_HOOK_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_ORIGINAL_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_CURSOR_ORIGINAL_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_UI_ORIGINAL_EXPORT));
    const sections = WebAssembly.Module.customSections(
      module,
      ENHANCEMENT_MANIFEST_SECTION,
    );
    assert.equal(sections.length, 1);
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(sections[0])),
      {
        transformAbi: ENHANCEMENT_TRANSFORM_ABI,
        programId: build.programId,
        buildId: build.buildId,
        tableSlot: build.tableSlot,
        hooks: {
          tick: { functionIndex: 3, params: ["i32"] },
          cursor: {
            functionIndex: 4,
            params: ["i32", "i32", "i32", "i32", "i32"],
            existingTableSlot: 1,
          },
          ui: { functionIndex: 5, params: ["i32", "i32", "i32"] },
        },
        messages: {
          playerChat: 0x1000_0082,
          hideHeroPanel: 0x1000_01a3,
          showHeroPanel: 0x1000_01a4,
        },
        configWords: enhancementConfigWords(build),
      },
    );
  });

  it("reports the semantic loop signature and reusable empty slots", () => {
    const report = inspectEnhancementCandidate(fixture());
    assert.equal(report.validWasm, true);
    assert.deepEqual(report.mainLoop, {
      functionIndex: 3,
      params: ["i32"],
      results: [],
    });
    assert.deepEqual(report.table, {
      min: 4,
      max: 4,
      firstEmptySlots: [0],
    });
  });

  it("preserves every argument and calls each relocated original once", () => {
    const transformed = transformEnhancementWasm(fixture(), manifest(fixture()));
    const originals: number[][] = [];
    const dispatches: number[][] = [];
    const game = { exports: {} as Record<string, unknown> };
    const callbackInstance = new WebAssembly.Instance(
      new WebAssembly.Module(
        new Uint8Array(callbackFixture()).buffer as ArrayBuffer,
      ),
      {
        env: {
          dispatch: (...args: number[]) => {
            dispatches.push(args);
            if (args[0] === 0) {
              (game.exports[ENHANCEMENT_ORIGINAL_EXPORT] as (a: number) => void)(
                args[1]!,
              );
            } else if (args[0] === 1) {
              (game.exports[ENHANCEMENT_CURSOR_ORIGINAL_EXPORT] as (
                ...a: number[]
              ) => void)(
                ...args.slice(1),
              );
            } else {
              (game.exports[ENHANCEMENT_UI_ORIGINAL_EXPORT] as (
                ...a: number[]
              ) => void)(
                ...args.slice(1, 4),
              );
            }
          },
        },
      },
    );
    const gameInstance = new WebAssembly.Instance(
      new WebAssembly.Module(
        new Uint8Array(transformed).buffer as ArrayBuffer,
      ),
      {
        env: {
          t: (a: number) => originals.push([0, a]),
          c: (...args: number[]) => originals.push([1, ...args]),
          u: (...args: number[]) => originals.push([2, ...args]),
        },
      },
    );
    game.exports = gameInstance.exports as Record<string, unknown>;
    const tick = game.exports.EmscriptenExeThreadMainLoop as (a: number) => void;
    const cursor = game.exports.cursor as (...args: number[]) => void;
    const ui = game.exports.ui as (...args: number[]) => void;

    tick(11);
    cursor(21, 22, 23, 24, 25);
    ui(31, 32, 33);
    assert.deepEqual(originals, [
      [0, 11],
      [1, 21, 22, 23, 24, 25],
      [2, 31, 32, 33],
    ]);
    assert.deepEqual(dispatches, []);

    (game.exports.tbl as WebAssembly.Table).set(
      0,
      callbackInstance.exports.callback as CallableFunction,
    );
    (game.exports[ENHANCEMENT_HOOK_EXPORT] as WebAssembly.Global).value = 1;
    originals.length = 0;
    tick(41);
    cursor(51, 52, 53, 54, 55);
    ui(61, 62, 63);
    assert.deepEqual(dispatches, [
      [0, 41, 0, 0, 0, 0],
      [1, 51, 52, 53, 54, 55],
      [2, 61, 62, 63, 0, 0],
    ]);
    assert.deepEqual(originals, [
      [0, 41],
      [1, 51, 52, 53, 54, 55],
      [2, 61, 62, 63],
    ]);
  });

  it("rejects an occupied slot, hash mismatch, and signature mismatch", () => {
    const occupied = fixture(true);
    assert.throws(
      () => transformEnhancementWasm(occupied, manifest(occupied)),
      /occupied/,
    );
    const input = fixture();
    assert.throws(
      () => transformEnhancementWasm(input, { ...manifest(input), sha256: "0".repeat(64) }),
      /unsupported/,
    );
    const wrongSignature = fixture(false, 0x7e);
    assert.throws(
      () => transformEnhancementWasm(wrongSignature, manifest(wrongSignature)),
      /signature/,
    );
  });
});

describe("Enhancement client chain", () => {
  it("certifies the Enhancement transform against the template-save output", () => {
    // The Enhancement transform is layered on the template-save client so opting
    // into the game cursor never costs template save/load. If either manifest
    // is recertified without the other, this pairing is what breaks first.
    for (const build of ENHANCEMENT_BUILDS) {
      const source = TEMPLATE_SAVE_BUILDS.find(
        (candidate) => candidate.outputSha256 === build.sha256,
      );
      assert.ok(
        source,
        `Enhancement build ${build.buildId} does not consume any template-save output`,
      );
    }
  });
});
