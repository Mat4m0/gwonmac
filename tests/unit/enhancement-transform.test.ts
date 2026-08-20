import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENHANCEMENT_TRANSFORM_ABI,
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
  enhancementConfigWordActive,
  type EnhancementCapabilities,
} from "../../src/shared/enhancement-contracts.js";
import {
  enhancementConfigWords,
  ENHANCEMENT_LAYOUT_FIELDS,
  supportedEnhancementCapabilities,
} from "../../src/main/certification/enhancement-builds.js";
import { ENHANCEMENT_CONFIG_FIELDS } from "../../src/shared/enhancement-config.js";
import {
  ENHANCEMENT_HOOK_EXPORT,
  ENHANCEMENT_MANIFEST_SECTION,
  transformEnhancementWasm,
} from "../../src/main/certification/enhancement-transform.js";
import { inspectEnhancementCandidate } from "../../src/main/certification/enhancement-candidate.js";
import { decodeEnhancementManifest } from "../../src/renderer/enhancement-manifest.js";
import {
  callbackFixture,
  CURSOR_ONLY,
  CURSOR_TARGET,
  CURSOR_TOOLBOX,
  fixture,
  manifest,
  moduleWithManifest,
  NO_CAPABILITIES,
  PARTY_DIRTY_MESSAGES,
  STORAGE_ONLY,
  TARGET_ONLY,
} from "../fixtures/enhancement-transform.js";

const PARTY_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: true,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
});

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
      min: 5,
      max: 5,
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

    assert.equal(table.length, 6);
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
        {
          nativeCursor: true,
          targetObservation: true,
          partyObservation: false,
          teamApply: true,
          travelAction: false,
          xunlaiAction: false,
          chatAliases: false,
        },
      ),
      /capability profile is not certified/,
    );
  });

  it("uses only selected hook evidence in deterministic hook order", () => {
    const input = fixture();
    const build = manifest(input);
    const brokenUi = {
      ...build,
      uiDispatcher: { ...build.uiDispatcher!, functionIndex: 4 },
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
    tickOnly.configWords.forEach((word, index) => {
      if (!enhancementConfigWordActive(TARGET_ONLY, index)) {
        assert.equal(word, 0);
      }
    });

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

  it("zeroes only Xunlai proof words when Travel has no access certificate", () => {
    const input = fixture();
    const build = manifest(input);
    const certifiedWords = enhancementConfigWords(build, STORAGE_ONLY);
    assert.ok(certifiedWords.some((word, index) =>
      ENHANCEMENT_CONFIG_FIELDS[index]?.owner === "observation" && word !== 0
    ));
    assert.ok(certifiedWords.some((word, index) =>
      ENHANCEMENT_CONFIG_FIELDS[index]?.owner === "storage" && word !== 0
    ));
    certifiedWords.forEach((word, index) => {
      if (ENHANCEMENT_CONFIG_FIELDS[index]?.owner === "party") {
        assert.equal(word, 0);
      }
    });
    const prooflessStorage = {
      openExport: build.xunlaiAction!.openExport,
      configureExport: build.xunlaiAction!.configureExport,
      handler: build.xunlaiAction!.handler,
    };
    const proofless = {
      ...build,
      xunlaiAction: prooflessStorage,
    };
    const travelWithoutXunlai = {
      ...STORAGE_ONLY,
      xunlaiAction: false,
    };
    const words = enhancementConfigWords(proofless, travelWithoutXunlai);
    words.forEach((word, index) => {
      const field = ENHANCEMENT_CONFIG_FIELDS[index];
      if (field?.owner === "storage") assert.equal(word, 0);
    });
    assert.equal(
      supportedEnhancementCapabilities(proofless).travelAction,
      true,
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

  it("gives party observation shared agent state without target selection", () => {
    const input = fixture();
    const build = manifest(input);
    const partyOnlyBuild = { ...build };
    delete partyOnlyBuild.cursorEvent;
    delete partyOnlyBuild.targetObservation;
    delete partyOnlyBuild.teamApply;
    partyOnlyBuild.outputSha256 = Object.freeze({
      party: build.outputSha256.party!,
    });
    const transformed = transformEnhancementWasm(
      input,
      partyOnlyBuild,
      PARTY_ONLY,
    );
    const module = new WebAssembly.Module(new Uint8Array(transformed));
    const decoded = decodeEnhancementManifest(module, PARTY_ONLY);
    assert.ok(decoded);
    assert.deepEqual(decoded.configWords.slice(0, 17), [
      partyOnlyBuild.observationBase!.layout.contextRoot,
      partyOnlyBuild.observationBase!.layout.agentArray,
      0,
      0,
      partyOnlyBuild.observationBase!.layout.gameContextSlot,
      partyOnlyBuild.observationBase!.layout.characterContext,
      partyOnlyBuild.observationBase!.layout.mapId,
      partyOnlyBuild.observationBase!.layout.isExplorable,
      partyOnlyBuild.observationBase!.layout.currentMapId,
      partyOnlyBuild.observationBase!.layout.currentInstanceType,
      partyOnlyBuild.observationBase!.layout.playerNumber,
      partyOnlyBuild.observationBase!.layout.agentId,
      partyOnlyBuild.observationBase!.layout.agentX,
      partyOnlyBuild.observationBase!.layout.agentY,
      partyOnlyBuild.observationBase!.layout.agentType,
      partyOnlyBuild.observationBase!.layout.agentPlayerNumber,
      partyOnlyBuild.observationBase!.layout.agentModelType,
    ]);
    assert.deepEqual(
      decoded.configWords.slice(17, 29),
      enhancementConfigWords(partyOnlyBuild, PARTY_ONLY).slice(17, 29),
    );

    const section = WebAssembly.Module.customSections(
      module,
      ENHANCEMENT_MANIFEST_SECTION,
    )[0];
    assert.ok(section);
    const evidence = JSON.parse(
      new TextDecoder().decode(section),
    ) as { configWords: number[] };
    // A target-only address must remain absent from a party-only profile.
    evidence.configWords[2] = 1;
    assert.equal(decodeEnhancementManifest(moduleWithManifest(evidence)), null);
  });

  it("checks the existing cursor table relation only when cursor is selected", () => {
    const input = fixture();
    const build = manifest(input);
    const wrongCursorSlot = {
      ...build,
      cursorEvent: { ...build.cursorEvent!, tableSlot: 0 },
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
