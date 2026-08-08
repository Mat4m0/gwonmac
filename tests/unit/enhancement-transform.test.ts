import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  ENHANCEMENT_TRANSFORM_ABI,
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
  type EnhancementCapabilities,
} from "../../src/shared/enhancement-contracts.js";
import {
  enhancementConfigWords,
  ENHANCEMENT_LAYOUT_FIELDS,
  type EnhancementOutputHashes,
  type KnownEnhancementBuild,
} from "../../src/main/certification/enhancement-builds.js";
import {
  inspectEnhancementCandidate,
  ENHANCEMENT_HOOK_EXPORT,
  ENHANCEMENT_MANIFEST_SECTION,
  transformEnhancementWasm,
} from "../../src/main/certification/enhancement-transform.js";
import { decodeEnhancementManifest } from "../../src/renderer/enhancement-manifest.js";
import {
  parseCode,
  parseExports,
  sectionById,
  splitSections,
} from "../../src/main/core/wasm-binary.js";
const UNSUPPORTED_ALL_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  toolbox: true,
  commands: false,
});
const CURSOR_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  toolbox: false,
  commands: false,
});
const CURSOR_TARGET: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  toolbox: false,
  commands: false,
});
const TARGET_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: true,
  toolbox: false,
  commands: false,
});
const CURSOR_TOOLBOX: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  toolbox: true,
  commands: false,
});
const NO_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  toolbox: false,
  commands: false,
});
const CURSOR_TOOLBOX_COMMANDS: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  toolbox: true,
  commands: true,
});
const CURSOR_TARGET_TOOLBOX_COMMANDS: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  toolbox: true,
  commands: true,
});
const PARTY_DIRTY_MESSAGES = Object.freeze([
  0x1000_0038,
  0x1000_0039,
  0x1000_008c,
  0x1000_0098,
  0x1000_00c2,
  0x1000_0111,
  0x1000_011e,
  0x1000_011f,
  0x1000_0124,
  0x1000_0126,
] as const);

const PLACEHOLDER_OUTPUTS: EnhancementOutputHashes = Object.freeze({
  cursor: "0".repeat(64),
  target: "0".repeat(64),
  cursorTarget: "0".repeat(64),
  cursorToolbox: "0".repeat(64),
  cursorToolboxCommands: "0".repeat(64),
  cursorTargetToolboxCommands: "0".repeat(64),
});

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

function moduleWithManifest(value: unknown): WebAssembly.Module {
  const name = [...new TextEncoder().encode(ENHANCEMENT_MANIFEST_SECTION)];
  const payload = [...new TextEncoder().encode(JSON.stringify(value))];
  return new WebAssembly.Module(new Uint8Array([
    ...fixture(),
    ...section(0, [...uleb(name.length), ...name, ...payload]),
  ]));
}

// `hookParamType` is the WebAssembly value type of the main loop's single
// parameter: 0x7f is i32, the signature every certified build declares. A
// caller passes another one — 0x7e is i64 — to build the module a manifest
// does not certify, which is the only side the mismatch can come from: a
// KnownEnhancementBuild's hookParams is the literal ["i32"] and cannot say
// otherwise.
function fixture(hookParamType = 0x7f): Uint8Array {
  const type = section(1, [
    4,
    0x60, 1, hookParamType, 0,
    0x60, 5, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0,
    0x60, 3, 0x7f, 0x7f, 0x7f, 0,
    0x60, 2, 0x7f, 0x7f, 0,
  ]);
  const env = [3, 101, 110, 118];
  const imports = section(2, [
    3,
    ...env, 1, 116, 0, 0,
    ...env, 1, 99, 0, 1,
    ...env, 1, 117, 0, 2,
  ]);
  // Four defined functions: the three hooks plus one for a command to resolve
  // to. Its body deliberately differs from the tick hook's -- an identical body
  // would hash the same, and the whole point of `bodySha256` is that two
  // different functions cannot pass for each other.
  const functions = section(3, [5, 0, 1, 2, 0, 3]);
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
  const mappedSegment = [0, 0x41, 1, 0x0b, 3, 4, 3, 5];
  const elements = section(9, [1, ...mappedSegment]);
  const tick = [0, 0x20, 0, 0x10, 0, 0x0b];
  const cursor = [
    0, 0x20, 0, 0x20, 1, 0x20, 2, 0x20, 3, 0x20, 4, 0x10, 1, 0x0b,
  ];
  const ui = [0, 0x20, 0, 0x20, 1, 0x20, 2, 0x10, 2, 0x0b];
  const command = [0, 0x41, 0, 0x1a, 0x20, 0, 0x10, 0, 0x0b];
  // Two arguments, so a command that takes more than one is exercised too --
  // the real skillbar and attribute commands take three and four.
  const pair = [0, 0x20, 0, 0x10, 0, 0x20, 1, 0x10, 0, 0x0b];
  const code = section(10, [
    5,
    ...uleb(tick.length), ...tick,
    ...uleb(cursor.length), ...cursor,
    ...uleb(ui.length), ...ui,
    ...uleb(command.length), ...command,
    ...uleb(pair.length), ...pair,
  ]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type, ...imports, ...functions, ...table, ...globals, ...exports,
    ...elements, ...code,
  ]);
}

/** A fixture function body, as the transform will read it. */
function commandBody(bytes: Uint8Array, index: number): Uint8Array {
  return parseCode(sectionById(splitSections(bytes), 10))[index]!;
}

function manifest(bytes: Uint8Array): KnownEnhancementBuild {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    outputSha256: PLACEHOLDER_OUTPUTS,
    programId: 1,
    buildId: 1,
    hookFunction: 3,
    hookParams: ["i32"],
    hookResults: [],
    tableSlot: 4,
    commands: {
      thunkExport: "enhancement_command",
      entries: [{
        opcode: 31,
        functionIndex: 6,
        params: ["i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 3))
          .digest("hex"),
        label: "fixture command",
      }, {
        opcode: 93,
        functionIndex: 7,
        params: ["i32", "i32"],
        results: [],
        bodySha256: createHash("sha256")
          .update(commandBody(bytes, 4))
          .digest("hex"),
        label: "fixture pair command",
      }],
    },
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
      partyDirtyMessages: PARTY_DIRTY_MESSAGES,
      playerChatProducer: 5,
      playerChatSites: 3,
      nearbyPlayerMessages: [0x1000_007f, 0x1000_0080],
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
      // Distinct values rather than zeros: the config ABI is positional, so a
      // fixture padded with zeros would let a mis-ordered field pass.
      heroLevel: 42,
      partyPlayers: 43, partyHenchmen: 44, partyFlag: 45,
      worldContext: 46, worldHeroFlags: 47, heroFlagStride: 48,
      flagHeroId: 49, flagAgentId: 50, flagBehavior: 51,
      worldHeroInfo: 52, heroInfoStride: 53, infoHeroId: 54,
      infoAgentId: 40, infoLevel: 41,
      infoPrimary: 55, infoSecondary: 56, infoAppearanceBitmap: 57,
      worldSkillbars: 58, skillbarStride: 59, skillbarAgentId: 60,
      skillbarSkills: 61, skillSlotStride: 62, skillSlotId: 63,
      skillbarDisabled: 64,
      worldAttributes: 65,
      attributeStride: 66,
      attributeAgentId: 67,
      attributeEntries: 68,
      attributeEntryStride: 69,
      attributeEntryId: 70,
      attributeEntryRank: 71,
      areaInfo: 72,
      areaInfoCount: 73,
      areaInfoStride: 74,
      areaInfoFlags: 75,
      worldProfessionStates: 76,
      professionStateStride: 77,
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
    const first = transformEnhancementWasm(input, build, CURSOR_TOOLBOX);
    const second = transformEnhancementWasm(input, build, CURSOR_TOOLBOX);
    assert.deepEqual(first, second);
    // The transform returns a plain Uint8Array, which says nothing about the
    // buffer behind it, and WebAssembly takes only an unshared one. The copy
    // is the same bytes in a buffer the checker can see is not shared.
    const bytes = new Uint8Array(first);
    assert.equal(WebAssembly.validate(bytes), true);
    const module = new WebAssembly.Module(bytes);
    const names = WebAssembly.Module.exports(module).map((entry) => entry.name);
    assert.ok(names.includes(ENHANCEMENT_HOOK_EXPORT));
    assert.equal(names.includes("enhancement_tick_original"), false);
    assert.equal(names.includes("enhancement_cursor_original"), false);
    assert.equal(names.includes("enhancement_ui_original"), false);
    const sections = WebAssembly.Module.customSections(
      module,
      ENHANCEMENT_MANIFEST_SECTION,
    );
    assert.equal(sections.length, 1);
    assert.deepEqual(
      decodeEnhancementManifest(module, CURSOR_TOOLBOX)?.hooks,
      { tick: true, cursor: true, ui: true },
    );
    assert.equal(
      decodeEnhancementManifest(module, CURSOR_ONLY),
      null,
    );
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(sections[0])),
      {
        transformAbi: ENHANCEMENT_TRANSFORM_ABI,
        programId: build.programId,
        buildId: build.buildId,
        tableSlot: build.tableSlot,
        capabilities: CURSOR_TOOLBOX,
        hooks: {
          tick: { functionIndex: 3, params: ["i32"], results: [] },
          cursor: {
            functionIndex: 4,
            params: ["i32", "i32", "i32", "i32", "i32"],
            results: [],
            existingTableSlot: 1,
          },
          ui: {
            functionIndex: 5,
            params: ["i32", "i32", "i32"],
            results: [],
          },
        },
        messages: {
          playerChat: 0x1000_0082,
          hideHeroPanel: 0x1000_01a3,
          showHeroPanel: 0x1000_01a4,
          partyDirty: PARTY_DIRTY_MESSAGES,
        },
        configWords: enhancementConfigWords(build, CURSOR_TOOLBOX),
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
    const input = fixture();
    const build = manifest(input);
    const transformed = transformEnhancementWasm(
      input,
      build,
      CURSOR_TOOLBOX,
    );
    const originals: number[][] = [];
    const dispatches: number[][] = [];
    const order: string[] = [];
    let trapTick = false;
    let trapCallback = false;
    const callbackInstance = new WebAssembly.Instance(
      new WebAssembly.Module(
        new Uint8Array(callbackFixture()).buffer as ArrayBuffer,
      ),
      {
        env: {
          dispatch: (...args: number[]) => {
            dispatches.push(args);
            order.push(`callback:${args[0]}`);
            if (trapCallback) throw new Error("observer trapped");
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
          t: (a: number) => {
            originals.push([0, a]);
            order.push("original:0");
            if (trapTick) throw new Error("original tick trapped");
          },
          c: (...args: number[]) => {
            originals.push([1, ...args]);
            order.push("original:1");
          },
          u: (...args: number[]) => {
            originals.push([2, ...args]);
            order.push("original:2");
          },
        },
      },
    );
    const game = gameInstance.exports as Record<string, unknown>;
    const table = game.tbl as WebAssembly.Table;
    const tick = game.EmscriptenExeThreadMainLoop as (a: number) => void;
    const cursor = game.cursor as (...args: number[]) => void;
    const ui = game.ui as (...args: number[]) => void;

    tick(11);
    cursor(21, 22, 23, 24, 25);
    ui(31, 32, 33);
    assert.deepEqual(originals, [
      [0, 11],
      [1, 21, 22, 23, 24, 25],
      [2, 31, 32, 33],
    ]);
    assert.deepEqual(dispatches, []);
    assert.deepEqual(order, ["original:0", "original:1", "original:2"]);

    assert.equal(table.length, 5);
    const slotZeroSentinel = tick as CallableFunction;
    table.set(0, slotZeroSentinel);
    table.set(
      build.tableSlot,
      callbackInstance.exports.callback as CallableFunction,
    );
    (game[ENHANCEMENT_HOOK_EXPORT] as WebAssembly.Global).value =
      build.tableSlot + 1;
    originals.length = 0;
    order.length = 0;
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
    assert.deepEqual(order, [
      "original:0", "callback:0",
      "original:1", "callback:1",
      "original:2", "callback:2",
    ]);
    assert.equal(table.get(0), slotZeroSentinel);

    trapTick = true;
    dispatches.length = 0;
    order.length = 0;
    assert.throws(() => tick(71), /original tick trapped/);
    assert.deepEqual(order, ["original:0"]);
    assert.deepEqual(dispatches, []);

    trapTick = false;
    trapCallback = true;
    originals.length = 0;
    dispatches.length = 0;
    order.length = 0;
    assert.throws(() => cursor(81, 82, 83, 84, 85), /observer trapped/);
    assert.deepEqual(originals, [[1, 81, 82, 83, 84, 85]]);
    assert.deepEqual(order, ["original:1", "callback:1"]);
  });

  it("rejects a non-terminal slot, hash mismatch, and signature mismatch", () => {
    const input = fixture();
    assert.throws(
      () => transformEnhancementWasm(
        input,
        { ...manifest(input), tableSlot: 0 },
        CURSOR_TOOLBOX,
      ),
      /terminal/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        { ...manifest(input), sha256: "0".repeat(64) },
        CURSOR_TOOLBOX,
      ),
      /unsupported/,
    );
    const wrongSignature = fixture(0x7e);
    assert.throws(
      () => transformEnhancementWasm(
        wrongSignature,
        manifest(wrongSignature),
        CURSOR_TOOLBOX,
      ),
      /signature/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        manifest(input),
        NO_CAPABILITIES,
      ),
      /capability profile is not certified/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        manifest(input),
        { ...TARGET_ONLY, futureCapability: true } as EnhancementCapabilities,
      ),
      /capability selection is invalid/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        manifest(input),
        UNSUPPORTED_ALL_CAPABILITIES,
      ),
      /capability profile is not certified/,
    );
  });

  it("uses only selected hook evidence in deterministic hook order", () => {
    const input = fixture();
    const build = manifest(input);
    const brokenUi = {
      ...build,
      uiDispatcher: { ...build.uiDispatcher, functionIndex: 4 },
    };

    const first = transformEnhancementWasm(
      input,
      brokenUi,
      CURSOR_ONLY,
    );
    const second = transformEnhancementWasm(
      input,
      brokenUi,
      CURSOR_ONLY,
    );
    assert.deepEqual(first, second);
    const module = new WebAssembly.Module(new Uint8Array(first));
    const manifestSection = WebAssembly.Module.customSections(
      module,
      ENHANCEMENT_MANIFEST_SECTION,
    );
    assert.equal(manifestSection.length, 1);
    const evidence = JSON.parse(
      new TextDecoder().decode(manifestSection[0]),
    ) as Record<string, unknown>;
    assert.deepEqual(evidence.hooks, {
      tick: { functionIndex: 3, params: ["i32"], results: [] },
      cursor: {
        functionIndex: 4,
        params: ["i32", "i32", "i32", "i32", "i32"],
        results: [],
        existingTableSlot: 1,
      },
      ui: null,
    });
    assert.equal(evidence.messages, null);
    const configWords = evidence.configWords as number[];
    assert.deepEqual(evidence.capabilities, CURSOR_ONLY);
    assert.deepEqual(configWords.slice(0, 17), Array<number>(17).fill(0));
    // Everything past the cursor block belongs to Toolbox, which is off here.
    // Sized from the contract rather than written out: a literal length has to
    // be found and corrected every time the layout grows, and is just as likely
    // to be corrected into agreement with a bug.
    assert.deepEqual(
      configWords.slice(29),
      Array<number>(ENHANCEMENT_CONFIG_WORD_COUNT - 29).fill(0),
    );
    assert.deepEqual(
      decodeEnhancementManifest(module, CURSOR_ONLY)?.hooks,
      { tick: true, cursor: true, ui: false },
    );

    const cursorTargetBytes = transformEnhancementWasm(
      input,
      brokenUi,
      CURSOR_TARGET,
    );
    const cursorTargetModule = new WebAssembly.Module(
      new Uint8Array(cursorTargetBytes),
    );
    assert.notDeepEqual(cursorTargetBytes, first);
    assert.deepEqual(
      decodeEnhancementManifest(cursorTargetModule, CURSOR_TARGET)?.hooks,
      { tick: true, cursor: true, ui: false },
    );
    assert.equal(
      decodeEnhancementManifest(cursorTargetModule, CURSOR_ONLY),
      null,
    );

    const tickOnlyModule = new WebAssembly.Module(new Uint8Array(
      transformEnhancementWasm(input, brokenUi, TARGET_ONLY),
    ));
    const tickOnly = decodeEnhancementManifest(tickOnlyModule, TARGET_ONLY);
    assert.ok(tickOnly);
    assert.deepEqual(
      tickOnly.configWords.slice(17),
      Array<number>(ENHANCEMENT_CONFIG_WORD_COUNT - 17).fill(0),
    );

    const originals: number[][] = [];
    const dispatches: number[][] = [];
    const callback = new WebAssembly.Instance(
      new WebAssembly.Module(new Uint8Array(callbackFixture())),
      { env: { dispatch: (...args: number[]) => dispatches.push(args) } },
    );
    const game = new WebAssembly.Instance(module, {
      env: {
        t: (value: number) => originals.push([0, value]),
        c: (...args: number[]) => originals.push([1, ...args]),
        u: (...args: number[]) => originals.push([2, ...args]),
      },
    }).exports as Record<string, unknown>;
    (game.tbl as WebAssembly.Table).set(
      build.tableSlot,
      callback.exports.callback as CallableFunction,
    );
    (game[ENHANCEMENT_HOOK_EXPORT] as WebAssembly.Global).value =
      build.tableSlot + 1;
    (game.EmscriptenExeThreadMainLoop as (value: number) => void)(41);
    (game.cursor as (...args: number[]) => void)(51, 52, 53, 54, 55);
    (game.ui as (...args: number[]) => void)(61, 62, 63);
    assert.deepEqual(originals, [
      [0, 41],
      [1, 51, 52, 53, 54, 55],
      [2, 61, 62, 63],
    ]);
    assert.deepEqual(dispatches, [
      [0, 41, 0, 0, 0, 0],
      [1, 51, 52, 53, 54, 55],
    ]);

    assert.throws(
      () => transformEnhancementWasm(input, brokenUi, CURSOR_TOOLBOX),
      /UI dispatcher signature/,
    );
  });

  it("rejects nonzero configuration for inactive capabilities", () => {
    const input = fixture();
    const transformed = transformEnhancementWasm(
      input,
      manifest(input),
      TARGET_ONLY,
    );
    const sectionBytes = WebAssembly.Module.customSections(
      new WebAssembly.Module(new Uint8Array(transformed)),
      ENHANCEMENT_MANIFEST_SECTION,
    )[0];
    assert.ok(sectionBytes);
    const evidence = JSON.parse(
      new TextDecoder().decode(sectionBytes),
    ) as { configWords: number[] };

    for (const inactiveIndex of [17, 29, 36]) {
      const changed = structuredClone(evidence);
      changed.configWords[inactiveIndex] = 1;
      assert.equal(decodeEnhancementManifest(moduleWithManifest(changed)), null);
    }

    const cursorOnly = transformEnhancementWasm(
      input,
      manifest(input),
      CURSOR_ONLY,
    );
    const cursorSection = WebAssembly.Module.customSections(
      new WebAssembly.Module(new Uint8Array(cursorOnly)),
      ENHANCEMENT_MANIFEST_SECTION,
    )[0];
    assert.ok(cursorSection);
    const cursorEvidence = JSON.parse(
      new TextDecoder().decode(cursorSection),
    ) as { configWords: number[] };
    cursorEvidence.configWords[0] = 1;
    assert.equal(
      decodeEnhancementManifest(moduleWithManifest(cursorEvidence)),
      null,
    );
  });

  it("binds the exact party-dirty set to the Toolbox manifest and config", () => {
    const input = fixture();
    const transformed = transformEnhancementWasm(
      input,
      manifest(input),
      CURSOR_TOOLBOX,
    );
    const sectionBytes = WebAssembly.Module.customSections(
      new WebAssembly.Module(new Uint8Array(transformed)),
      ENHANCEMENT_MANIFEST_SECTION,
    )[0];
    assert.ok(sectionBytes);
    const evidence = JSON.parse(
      new TextDecoder().decode(sectionBytes),
    ) as {
      messages: { partyDirty: number[] };
      configWords: number[];
    };

    const mismatched = structuredClone(evidence);
    mismatched.messages.partyDirty[0] = 0x1000_ffff;
    assert.equal(decodeEnhancementManifest(moduleWithManifest(mismatched)), null);

    const duplicate = structuredClone(evidence);
    duplicate.messages.partyDirty[1] = duplicate.messages.partyDirty[0]!;
    duplicate.configWords[40] = duplicate.configWords[39]!;
    assert.equal(decodeEnhancementManifest(moduleWithManifest(duplicate)), null);
  });

  // The message words start where the address words stop, and three places
  // used to carry that boundary as the literal `36`: the manifest decoder, the
  // integration fixtures, and the layout field list that actually determines
  // it. Growing the layout moved the messages and two of the three did not
  // notice — the decoder went on reading party-dirty messages out of address
  // words and refused every manifest. This binds the constant to the list, so
  // the next field added moves it or fails here.
  it("starts the message words exactly where the layout words end", () => {
    assert.equal(ENHANCEMENT_LAYOUT_WORD_COUNT, ENHANCEMENT_LAYOUT_FIELDS.length);
    assert.equal(
      ENHANCEMENT_CONFIG_WORD_COUNT,
      ENHANCEMENT_LAYOUT_FIELDS.length + 3 + PARTY_DIRTY_MESSAGES.length,
    );
    // And the list itself carries no duplicate, which would make two config
    // positions the same field and hide the drift this test looks for.
    assert.equal(
      new Set(ENHANCEMENT_LAYOUT_FIELDS).size,
      ENHANCEMENT_LAYOUT_FIELDS.length,
    );
  });

  it("gives Toolbox only the target-core words its hero path reads", () => {
    const input = fixture();
    const build = manifest(input);
    const transformed = transformEnhancementWasm(
      input,
      build,
      CURSOR_TOOLBOX,
    );
    const module = new WebAssembly.Module(new Uint8Array(transformed));
    const decoded = decodeEnhancementManifest(module, CURSOR_TOOLBOX);
    assert.ok(decoded);
    assert.deepEqual(decoded.configWords.slice(0, 17), [
      build.layout.contextRoot,
      0,
      0,
      0,
      build.layout.gameContextSlot,
      build.layout.characterContext,
      build.layout.mapId,
      build.layout.isExplorable,
      build.layout.currentMapId,
      build.layout.currentInstanceType,
      build.layout.playerNumber,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    assert.deepEqual(
      decoded.configWords.slice(17, 29),
      enhancementConfigWords(build, CURSOR_TOOLBOX).slice(17, 29),
    );

    const section = WebAssembly.Module.customSections(
      module,
      ENHANCEMENT_MANIFEST_SECTION,
    )[0];
    assert.ok(section);
    const evidence = JSON.parse(
      new TextDecoder().decode(section),
    ) as { configWords: number[] };
    evidence.configWords[1] = 1;
    assert.equal(decodeEnhancementManifest(moduleWithManifest(evidence)), null);
  });

  // The command thunk is the entire write surface. These are the tests that
  // decide whether this app can send a packet, so they instantiate the
  // transformed module and drive the function rather than inspecting bytes.
  it("emits the command thunk for exactly the two certified command profiles", () => {
    const input = fixture();
    const build = manifest(input);
    for (const capabilities of [CURSOR_ONLY, TARGET_ONLY, CURSOR_TARGET, CURSOR_TOOLBOX]) {
      const output = transformEnhancementWasm(input, build, capabilities);
      const exports = parseExports(sectionById(splitSections(output), 7));
      assert.equal(
        exports.some((entry) => entry.name === build.commands.thunkExport),
        false,
        "a read profile must carry no way to reach a packet builder at all",
      );
    }
    for (const capabilities of [CURSOR_TOOLBOX_COMMANDS, CURSOR_TARGET_TOOLBOX_COMMANDS]) {
      const output = transformEnhancementWasm(input, build, capabilities);
      const exports = parseExports(sectionById(splitSections(output), 7));
      assert.equal(
        exports.filter((entry) => entry.name === build.commands.thunkExport).length,
        1,
      );
      const module = new WebAssembly.Module(new Uint8Array(output));
      assert.ok(decodeEnhancementManifest(module, capabilities));
      assert.equal(
        decodeEnhancementManifest(module, {
          ...capabilities,
          commands: false,
        }),
        null,
        "a read-only profile must not accept a command-capable manifest",
      );
    }
  });

  it("dispatches the certified opcode and refuses every other", () => {
    const input = fixture();
    const build = manifest(input);
    const output = transformEnhancementWasm(input, build, CURSOR_TOOLBOX_COMMANDS);

    const sent: number[] = [];
    const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(output)), {
      env: {
        // The fixture's command function calls this; on the real client it is
        // the packet builder.
        t: (value: number) => { sent.push(value); },
        c: () => {},
        u: () => {},
        tbl: new WebAssembly.Table({ initial: 5, maximum: 5, element: "anyfunc" }),
      },
    });
    const command = instance.exports[build.commands.thunkExport] as
      (opcode: number, a0: number, a1: number, a2: number, a3: number) => number;
    assert.equal(typeof command, "function");

    assert.equal(command(31, 4242, 0, 0, 0), 1, "certified opcode is sent");
    assert.deepEqual(sent, [4242], "the argument reaches the builder unchanged");

    // A command taking more than one argument gets all of them, in order, and
    // the arguments past its arity are ignored rather than passed on.
    assert.equal(command(93, 11, 22, 33, 44), 1);
    assert.deepEqual(sent, [4242, 11, 22]);

    // Everything else, including the neighbours of the ones we certified: the
    // opcodes are a dense range on the real client, so an off-by-one would
    // otherwise land on a real message.
    sent.length = 0;
    for (const opcode of [0, 1, 16, 21, 30, 32, 92, 94, -1, 0x7fff_ffff]) {
      assert.equal(command(opcode, 4242, 0, 0, 0), 0, `opcode ${opcode}`);
    }
    assert.deepEqual(sent, [], "and nothing was sent");
  });

  it("refuses a command whose function is not the one certified", () => {
    const input = fixture();
    const build = manifest(input);
    // The failure this whole surface was reshaped around: an index that has
    // drifted onto some other function. The type still matches -- the fixture's
    // tick hook is also `(i32) -> void` -- so only the body hash catches it.
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          commands: {
            ...build.commands,
            entries: [{ ...build.commands.entries[0]!, functionIndex: 3 }],
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /whose body is .* and not the certified/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          commands: {
            ...build.commands,
            entries: [{ ...build.commands.entries[0]!, functionIndex: 4 }],
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /command opcode 31 signature is/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          commands: {
            ...build.commands,
            entries: [{ ...build.commands.entries[0]!, functionIndex: 9_999 }],
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /out of range/,
    );
  });

  it("checks the existing cursor table relation only when cursor is selected", () => {
    const input = fixture();
    const build = manifest(input);
    const wrongCursorSlot = {
      ...build,
      cursorEvent: { ...build.cursorEvent, tableSlot: 0 },
    };
    assert.equal(
      WebAssembly.validate(
        new Uint8Array(
          transformEnhancementWasm(input, wrongCursorSlot, TARGET_ONLY),
        ),
      ),
      true,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        wrongCursorSlot,
        CURSOR_ONLY,
      ),
      /cursor table slot/,
    );
  });
});
