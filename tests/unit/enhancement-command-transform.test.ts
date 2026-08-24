import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  transformEnhancementWasm,
} from "../../src/main/certification/enhancement-transform.js";
import { decodeEnhancementManifest } from "../../src/renderer/enhancement-manifest.js";
import {
  parseExports,
  sectionById,
  splitSections,
} from "../../src/main/core/wasm-binary.js";
import {
  intersectEnhancementCapabilities,
} from "../../src/shared/enhancement-contracts.js";
import {
  PROFESSION_TRACE_SCHEMA,
  PROFESSION_TRACE_WORDS,
} from "../../src/shared/profession-command-trace.js";
import {
  commandBody,
  CURSOR_ONLY,
  CURSOR_TARGET,
  CURSOR_TARGET_TOOLBOX_COMMANDS,
  CURSOR_TOOLBOX,
  CURSOR_TOOLBOX_COMMANDS,
  CURSOR_TOOLBOX_STORAGE,
  fixture,
  manifest,
  STORAGE_ONLY,
  TARGET_ONLY,
} from "../fixtures/enhancement-transform.js";

describe("Enhancement command transform", () => {
  // The command queue is the entire write surface. These are the tests that
  // decide whether this app can send a packet, so they instantiate the
  // transformed module and drive the function rather than inspecting bytes.
  it("emits Team Apply and local action authority independently", () => {
    const input = fixture();
    const build = manifest(input);
    const partyOnly = { ...CURSOR_TOOLBOX, nativeCursor: false };
    const targetParty = { ...partyOnly, targetObservation: true };
    for (const capabilities of [
      CURSOR_ONLY,
      TARGET_ONLY,
      CURSOR_TARGET,
      partyOnly,
      CURSOR_TOOLBOX,
      targetParty,
      { ...CURSOR_TOOLBOX, targetObservation: true },
    ]) {
      const output = transformEnhancementWasm(input, build, capabilities);
      const exports = parseExports(sectionById(splitSections(output), 7));
      assert.equal(
        exports.some((entry) => entry.name === build.teamApply!.thunkExport),
        false,
        "a read profile must carry no way to reach a packet builder at all",
      );
      assert.equal(
        exports.some((entry) => entry.name === build.xunlaiAction!.openExport),
        false,
      );
    }
    const commandsOnly = {
      ...CURSOR_TOOLBOX_COMMANDS,
      travelAction: false,
      xunlaiAction: false,
      chatAliases: false,
    skillSlotGeometry: false,
    };
    const commandsOutput = transformEnhancementWasm(input, build, commandsOnly);
    const commandsExports = parseExports(sectionById(splitSections(commandsOutput), 7));
    assert.equal(
      commandsExports.some((entry) => entry.name === build.teamApply!.thunkExport),
      true,
    );
    assert.equal(
      commandsExports.some((entry) => entry.name === build.xunlaiAction!.openExport),
      false,
      "Team Apply must not compile or export the storage action",
    );

    const storageOutput = transformEnhancementWasm(input, build, CURSOR_TOOLBOX_STORAGE);
    const storageExports = parseExports(sectionById(splitSections(storageOutput), 7));
    assert.equal(
      storageExports.some((entry) => entry.name === build.teamApply!.thunkExport),
      false,
      "storage must not compile or export the packet-builder thunk",
    );
    assert.equal(
      storageExports.some((entry) => entry.name === build.xunlaiAction!.openExport),
      true,
    );
    assert.equal(
      storageExports.some((entry) => entry.name === build.travelAction!.enqueueExport),
      true,
    );
    assert.equal(
      storageExports.some((entry) => entry.name === build.travelAction!.toggleExport),
      true,
    );

    for (const capabilities of [CURSOR_TOOLBOX_COMMANDS, CURSOR_TARGET_TOOLBOX_COMMANDS]) {
      const output = transformEnhancementWasm(input, build, capabilities);
      const exports = parseExports(sectionById(splitSections(output), 7));
      assert.equal(
        exports.filter((entry) => entry.name === build.teamApply!.thunkExport).length,
        1,
      );
      assert.equal(
        exports.filter((entry) => entry.name === build.xunlaiAction!.openExport).length,
        1,
      );
      assert.equal(
        exports.filter(
          (entry) => entry.name === build.xunlaiAction!.configureExport,
        ).length,
        1,
      );
      const module = new WebAssembly.Module(new Uint8Array(output));
      assert.ok(decodeEnhancementManifest(module, capabilities));
      assert.equal(
        decodeEnhancementManifest(module, {
          ...capabilities,
          teamApply: false,
        }),
        null,
        "a read-only profile must not accept a command-capable manifest",
      );
      assert.equal(
        decodeEnhancementManifest(module, {
          ...capabilities,
          travelAction: false,
          xunlaiAction: false,
          chatAliases: false,
    skillSlotGeometry: false,
        }),
        null,
        "a profile without local actions must not accept their manifest",
      );
    }

    const storageModule = new WebAssembly.Module(new Uint8Array(
      transformEnhancementWasm(input, build, STORAGE_ONLY),
    ));
    assert.equal(
      decodeEnhancementManifest(storageModule, {
        ...STORAGE_ONLY,
        travelAction: false,
        xunlaiAction: false,
        chatAliases: false,
    skillSlotGeometry: false,
      }),
      null,
      "manifest comparison must reject unexpected storage authority",
    );
    const cursorModule = new WebAssembly.Module(new Uint8Array(
      transformEnhancementWasm(input, build, CURSOR_ONLY),
    ));
    assert.equal(
      decodeEnhancementManifest(cursorModule, {
        ...CURSOR_ONLY,
        travelAction: true,
        xunlaiAction: true,
        chatAliases: true,
    skillSlotGeometry: false,
      }),
      null,
      "manifest comparison must reject missing storage authority",
    );
  });

  it("derives local actions without installing the party dispatcher hook", () => {
    const input = fixture();
    const build = manifest(input);
    const output = transformEnhancementWasm(input, build, STORAGE_ONLY);
    const module = new WebAssembly.Module(new Uint8Array(output));
    assert.deepEqual(decodeEnhancementManifest(module, STORAGE_ONLY)?.hooks, {
      tick: true,
      cursor: false,
      ui: false,
    });

    const dispatches: number[][] = [];
    const runtime: { memory?: WebAssembly.Memory } = {};
    const instance = new WebAssembly.Instance(module, {
      env: {
        t: () => {},
        c: () => {},
        u: (...args: number[]) => {
          if (args[0] === 81) {
            new Int32Array(runtime.memory!.buffer)[args[1]! / 4] = -2;
            new Int32Array(runtime.memory!.buffer)[args[2]! / 4] = 0;
          } else dispatches.push(args);
        },
        tbl: new WebAssembly.Table({ initial: 6, maximum: 6, element: "anyfunc" }),
      },
    });
    runtime.memory = instance.exports.memory as WebAssembly.Memory;
    const configure = instance.exports[build.travelAction!.configureExport] as
      (payload: number, enabled: number) => number;
    const enqueue = instance.exports[build.travelAction!.enqueueExport] as
      (mapId: number) => number;
    const frame = instance.exports.frame as (value: number, context: number) => void;
    assert.equal(configure(128, 1), 1);
    assert.equal(enqueue(81), 1);
    frame(70, 700);
    assert.deepEqual(dispatches, [[build.travelAction!.messageId, 128, 0]]);
  });

  it("never advertises aliases without an effective named action", () => {
    const input = fixture();
    const build = manifest(input);
    const aliasesOnly = {
      nativeCursor: false,
      targetObservation: false,
      partyObservation: false,
      teamApply: false,
      travelAction: false,
      xunlaiAction: false,
      chatAliases: true,
    skillSlotGeometry: false,
    } as const;
    assert.equal(
      intersectEnhancementCapabilities(aliasesOnly, aliasesOnly).chatAliases,
      false,
    );
    assert.throws(
      () => transformEnhancementWasm(input, build, aliasesOnly),
      /capability profile is not certified/,
    );

    for (const action of ["travelAction", "xunlaiAction"] as const) {
      const capabilities = { ...aliasesOnly, [action]: true };
      const effective = intersectEnhancementCapabilities(capabilities, capabilities);
      assert.equal(effective.chatAliases, true, action);
      const output = transformEnhancementWasm(input, build, effective);
      const exports = parseExports(sectionById(splitSections(output), 7));
      assert.equal(
        exports.some((entry) => entry.name === build.teamApply!.thunkExport),
        false,
        action,
      );
      assert.equal(
        exports.some((entry) => entry.name === build.travelAction!.enqueueExport),
        action === "travelAction",
        action,
      );
      assert.equal(
        exports.some((entry) => entry.name === build.xunlaiAction!.openExport),
        action === "xunlaiAction",
        action,
      );
    }
  });

  it("queues the named storage action and drains DataWindow on the game thread", () => {
    const input = fixture();
    const build = manifest(input);
    const output = transformEnhancementWasm(input, build, CURSOR_TOOLBOX_COMMANDS);
    const gameCalls: number[] = [];
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(new Uint8Array(output)),
      {
        env: {
          t: (value: number) => { gameCalls.push(value); },
          c: () => {},
          u: () => {},
          tbl: new WebAssembly.Table({ initial: 6, maximum: 6, element: "anyfunc" }),
        },
      },
    );
    const memory = instance.exports.memory as WebAssembly.Memory;
    const words = new Uint32Array(memory.buffer);
    const frame = instance.exports.frame as (value: number, context: number) => void;
    const open = instance.exports[build.xunlaiAction!.openExport] as () => number;
    const configure = instance.exports[build.xunlaiAction!.configureExport] as
      (payload: number, enabled: number) => number;
    const payload = 64;
    words.set([0, 0, 3], payload / 4);

    assert.equal(open(), 0, "storage refuses before its payload and policy are installed");
    assert.equal(configure(payload, 1), 1);
    assert.equal(open(), 1, "configured storage accepts a named action");
    assert.equal(open(), 0, "a second action cannot replace the queued one");
    assert.deepEqual(gameCalls, [], "the named action never calls client code re-entrantly");
    frame(70, 700);
    assert.deepEqual(gameCalls, [payload, 70]);

    assert.equal(open(), 1);
    assert.equal(configure(payload, 0), 1, "disabling cancels a queued storage action");
    frame(80, 800);
    assert.deepEqual(gameCalls.slice(-1), [80]);
  });

  it("queues one bounded Travel request and dispatches it on the game thread", () => {
    const input = fixture();
    const build = manifest(input);
    const output = transformEnhancementWasm(input, build, CURSOR_TOOLBOX_STORAGE);
    const dispatches: number[][] = [];
    const runtime: { memory?: WebAssembly.Memory } = {};
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(new Uint8Array(output)),
      {
        env: {
          t: () => {},
          c: () => {},
          u: (first: number, second: number, third: number) => {
            if (first === 81) {
              new Int32Array(runtime.memory!.buffer)[second / 4] = -2;
              new Int32Array(runtime.memory!.buffer)[third / 4] = 0;
            } else if (first === 55) {
              // Leave the two sentinels untouched to model an unresolved map context.
            } else {
              dispatches.push([first, second, third]);
            }
          },
          tbl: new WebAssembly.Table({ initial: 6, maximum: 6, element: "anyfunc" }),
        },
      },
    );
    const memory = instance.exports.memory as WebAssembly.Memory;
    runtime.memory = memory;
    const frame = instance.exports.frame as (value: number, context: number) => void;
    const enqueue = instance.exports[build.travelAction!.enqueueExport] as
      (mapId: number) => number;
    const configure = instance.exports[build.travelAction!.configureExport] as
      (payload: number, enabled: number) => number;
    const payload = 128;

    assert.equal(enqueue(81), 0, "Travel refuses before installation");
    assert.equal(configure(payload, 1), 1);
    assert.equal(enqueue(81), 1);
    assert.equal(enqueue(55), 0, "a queued trip owns the action mailbox");
    assert.deepEqual(dispatches, [], "enqueue never calls client code re-entrantly");
    frame(70, 700);
    assert.deepEqual([...new Int32Array(memory.buffer, payload, 4)], [81, -2, 0, 0]);
    assert.deepEqual(dispatches, [[build.travelAction!.messageId, payload, 0]]);

    assert.equal(enqueue(55), 1);
    frame(80, 800);
    assert.deepEqual(
      dispatches,
      [[build.travelAction!.messageId, payload, 0]],
      "an unresolved live district context must fail closed without dispatching",
    );

    for (const mapId of [0, 2_001, 266, 307] as const) {
      assert.equal(
        enqueue(mapId),
        0,
        `refuses unreviewed map ${mapId}`,
      );
    }
    assert.deepEqual(dispatches, [[build.travelAction!.messageId, payload, 0]]);
  });

  it("consumes /trade, /tp and exact storage commands at their named boundaries", () => {
    const input = fixture();
    const build = manifest(input);
    const output = transformEnhancementWasm(input, build, CURSOR_TOOLBOX_COMMANDS);
    const gameCalls: number[] = [];
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(new Uint8Array(output)),
      {
        env: {
          t: (value: number) => { gameCalls.push(value); },
          c: () => {},
          u: () => {},
          tbl: new WebAssembly.Table({ initial: 6, maximum: 6, element: "anyfunc" }),
        },
      },
    );
    const memory = instance.exports.memory as WebAssembly.Memory;
    const words = new Uint32Array(memory.buffer);
    const slash = instance.exports.slash as (context: number, message: number) => number;
    const frame = instance.exports.frame as (value: number, context: number) => void;
    const command = instance.exports[build.teamApply!.thunkExport] as
      (opcode: number, a0: number, a1: number, a2: number, a3: number) => number;
    const configure = instance.exports[build.xunlaiAction!.configureExport] as
      (payload: number, enabled: number) => number;
    const configureTravel = instance.exports[build.travelAction!.configureExport] as
      (payload: number, enabled: number) => number;
    const takeTravelToggle = instance.exports[build.travelAction!.toggleExport] as
      () => number;
    const configureTrade = instance.exports.enhancement_configure_trade_toggle as
      (enabled: number) => number;
    const takeTradeToggle = instance.exports.enhancement_take_trade_toggle as
      () => number;
    const payload = 64;
    const message = 256;
    words.set([0, 0, 3], payload / 4);
    const writeMessage = (value: string) => {
      const dirtyBuffer = new Uint16Array(memory.buffer, message, 32);
      dirtyBuffer.fill(0x4141);
      const destination = dirtyBuffer.subarray(0, value.length + 1);
      destination.set([...value].map((character) => character.charCodeAt(0)));
      destination[value.length] = 0;
    };

    writeMessage("/chest");
    assert.equal(slash(11, message), 0, "a disabled feature preserves Guild Wars parsing");
    assert.deepEqual(gameCalls, [11]);

    writeMessage("/tp");
    assert.equal(slash(11, message), 0, "disabled Travel preserves Guild Wars parsing");
    assert.deepEqual(gameCalls, [11, 11]);
    assert.equal(takeTravelToggle(), 0);

    writeMessage("/trade");
    assert.equal(slash(11, message), 0, "disabled Trade Chat preserves Guild Wars parsing");
    assert.equal(takeTradeToggle(), 0);
    assert.equal(configureTrade(1), 1);
    assert.equal(slash(11, message), 1, "the exact Trade Chat command is consumed");
    assert.equal(takeTradeToggle(), 1, "the renderer receives one Trade Chat toggle");
    assert.equal(takeTradeToggle(), 0, "taking the Trade Chat request clears it");
    assert.equal(configureTrade(0), 1);

    assert.equal(configureTravel(128, 1), 1);
    writeMessage("/tp");
    assert.equal(slash(11, message), 1, "the exact Travel command is consumed");
    assert.equal(takeTravelToggle(), 1, "the renderer receives one toggle request");
    assert.equal(takeTravelToggle(), 0, "taking the request clears it");

    assert.equal(configure(payload, 1), 1);
    writeMessage("/chest");
    assert.equal(slash(12, message), 1, "the exact command is consumed");
    assert.deepEqual(gameCalls, [11, 11, 11], "slash handling only queues the action");
    frame(70, 700);
    assert.deepEqual(gameCalls, [11, 11, 11, payload, 70]);

    writeMessage("/xunlai");
    assert.equal(slash(13, message), 1, "the alias uses the same mailbox");
    frame(80, 800);
    assert.deepEqual(gameCalls, [11, 11, 11, payload, 70, payload, 80]);

    assert.equal(command(31, 4242, 0, 0, 0), 1);
    writeMessage("/chest");
    assert.equal(
      slash(14, message),
      1,
      "a recognized alias remains consumed while another action owns the mailbox",
    );
    frame(90, 900);
    assert.deepEqual(
      gameCalls.slice(-2),
      [4242, 90],
      "the busy alias neither replaces nor duplicates the queued action",
    );

    for (const nearMiss of [
      "/Trade", "/trade ", "/trade foo", "/TP", "/tpp", "/tp ",
      "/Chest", "/chests", "/chest extra", "/xunlaii", "/storage",
    ]) {
      writeMessage(nearMiss);
      assert.equal(slash(99, message), 0, nearMiss);
    }
    assert.deepEqual(gameCalls.slice(-11), Array(11).fill(99));
  });

  it("dispatches queued commands only from the certified game-thread callback", () => {
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
        tbl: new WebAssembly.Table({ initial: 6, maximum: 6, element: "anyfunc" }),
      },
    });
    const command = instance.exports[build.teamApply!.thunkExport] as
      (opcode: number, a0: number, a1: number, a2: number, a3: number) => number;
    const tick = instance.exports.EmscriptenExeThreadMainLoop as (value: number) => void;
    const frame = instance.exports.frame as (value: number, context: number) => void;
    const cursor = instance.exports.cursor as
      (a: number, b: number, c: number, d: number, e: number) => void;
    assert.equal(typeof command, "function");

    assert.equal(command(31, 4242, 0, 0, 0), 1, "certified opcode is queued");
    assert.deepEqual(sent, [], "enqueue never calls client code re-entrantly");
    assert.equal(command(93, 11, 22, 33, 44), 0, "a pending command owns the mailbox");
    cursor(1, 2, 3, 4, 5);
    assert.deepEqual(sent, [], "an observer hook cannot dispatch commands");
    tick(7);
    assert.deepEqual(sent, [7], "the observer tick cannot dispatch commands");
    frame(70, 700);
    assert.deepEqual(
      sent,
      [7, 4242, 70],
      "the command runs before the original frame boundary",
    );

    // A command taking more than one argument gets all of them, in order, and
    // the arguments past its arity are ignored rather than passed on.
    assert.equal(command(93, 11, 22, 33, 44), 1);
    assert.deepEqual(sent, [7, 4242, 70], "the second command also waits");
    tick(8);
    assert.deepEqual(sent, [7, 4242, 70, 8]);
    frame(80, 800);
    assert.deepEqual(sent, [7, 4242, 70, 8, 80]);

    assert.equal(command(31, 99, 0, 0, 0), 1);
    assert.equal(command(0, 0, 0, 0, 0), 1, "opcode zero cancels the pending command");
    frame(90, 900);
    assert.deepEqual(sent, [7, 4242, 70, 8, 80, 90]);

    // Everything else, including the neighbours of the ones we certified: the
    // opcodes are a dense range on the real client, so an off-by-one would
    // otherwise land on a real message.
    sent.length = 0;
    assert.equal(command(0, 4242, 0, 0, 0), 1, "opcode zero also cancels an empty mailbox");
    for (const opcode of [1, 16, 21, 30, 32, 92, 94, -1, 0x7fff_ffff]) {
      assert.equal(command(opcode, 4242, 0, 0, 0), 0, `opcode ${opcode}`);
    }
    assert.deepEqual(sent, [], "and nothing was sent");
  });

  it("distinguishes native and GWonMac command packets without changing them", () => {
    const input = fixture();
    const build = manifest(input);
    const output = transformEnhancementWasm(input, build, CURSOR_TOOLBOX_COMMANDS);
    const packets: number[][] = [];
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(new Uint8Array(output)),
      {
        env: {
          t: () => {},
          c: () => {},
          u: (connection: number, size: number, pointer: number) => {
            packets.push([connection, size, pointer]);
          },
        },
      },
    );
    const wasmMemory = instance.exports.memory as WebAssembly.Memory;
    const nativeProfession = instance.exports.profession as
      (target: number, profession: number) => void;
    const nativeSkill = instance.exports.skill as
      (target: number, count: number, skills: number) => void;
    const nativeSender = instance.exports.sender as
      (connection: number, size: number, pointer: number) => void;
    const enqueue = instance.exports[build.teamApply!.thunkExport] as
      (opcode: number, a0: number, a1: number, a2: number, a3: number) => number;
    const frame = instance.exports.frame as (value: number, context: number) => void;
    const readTrace = instance.exports[build.teamApply!.professionTrace.readerExport] as
      (pointer: number) => number;
    const trace = () => {
      assert.equal(readTrace(64), PROFESSION_TRACE_WORDS);
      return [...new Uint32Array(wasmMemory.buffer, 64, PROFESSION_TRACE_WORDS)];
    };

    new Uint32Array(wasmMemory.buffer, 0, 2).set([31, 38]);
    nativeSender(999, 8, 0);
    assert.deepEqual(trace(), [
      PROFESSION_TRACE_SCHEMA,
      0, 0, 0, 0,
      0, 0, 0, 0,
      1, 0, 999, 0, 0, 0, 0, 0, 0, 8,
      31, 38, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ]);

    nativeProfession(77, 2);
    assert.deepEqual(packets, [[999, 8, 0], [999, 12, 0]]);
    assert.deepEqual([...new Uint32Array(wasmMemory.buffer, 0, 3)], [65, 77, 2]);
    assert.deepEqual(trace(), [
      PROFESSION_TRACE_SCHEMA,
      1, 0, 77, 2,
      0, 0, 0, 0,
      2, 0, 999, 0, 0, 0, 0, 0, 0, 12,
      65, 77, 2, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ]);

    assert.equal(enqueue(65, 88, 3, 0, 0), 1);
    frame(1, 2);
    assert.deepEqual(packets, [
      [999, 8, 0],
      [999, 12, 0],
      [999, 12, 0],
    ]);
    assert.deepEqual([...new Uint32Array(wasmMemory.buffer, 0, 3)], [65, 88, 3]);
    assert.deepEqual(trace(), [
      PROFESSION_TRACE_SCHEMA,
      2, 1, 88, 3,
      0, 0, 0, 0,
      3, 1, 999, 0, 0, 0, 0, 0, 0, 12,
      65, 88, 3, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 65,
    ]);

    const skillWords = new Uint32Array(wasmMemory.buffer, 256, 8);
    skillWords.set([1, 2, 3, 4, 5, 6, 446, 8]);
    nativeSkill(77, 8, 256);
    assert.deepEqual(trace(), [
      PROFESSION_TRACE_SCHEMA,
      2, 1, 88, 3,
      1, 0, 77, 8,
      4, 0, 999, 0, 0, 0, 0, 0, 0, 44,
      93, 77, 8, 1, 2, 3, 4, 5, 6, 446, 8,
      1, 65,
    ]);
    assert.equal(enqueue(93, 77, 8, 256, 0), 1);
    frame(3, 4);
    assert.deepEqual([...new Uint32Array(wasmMemory.buffer, 128, 11)], [
      93, 77, 8, 1, 2, 3, 4, 5, 6, 446, 8,
    ]);
    assert.deepEqual(trace(), [
      PROFESSION_TRACE_SCHEMA,
      2, 1, 88, 3,
      2, 1, 77, 8,
      5, 1, 999, 0, 0, 0, 0, 0, 0, 44,
      93, 77, 8, 1, 2, 3, 4, 5, 6, 446, 8,
      2, 93,
    ]);
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
          teamApply: {
            ...build.teamApply!,
            entries: [{ ...build.teamApply!.entries[0]!, functionIndex: 3 }],
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
          teamApply: {
            ...build.teamApply!,
            entries: [{ ...build.teamApply!.entries[0]!, functionIndex: 4 }],
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
          teamApply: {
            ...build.teamApply!,
            entries: [{ ...build.teamApply!.entries[0]!, functionIndex: 9_999 }],
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /out of range/,
    );
  });

  it("refuses an uncertified or shared command drain boundary", () => {
    const input = fixture();
    const build = manifest(input);
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          gameThread: {
            drain: { ...build.gameThread!.drain, bodySha256: "0".repeat(64) },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /command drain boundary resolves .* not the certified/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          // The profession command has the same signature. Identity must still be
          // distinct so command execution and scheduling cannot merge.
          gameThread: {
            drain: {
              ...build.gameThread!.drain,
              functionIndex: 9,
              bodySha256: build.teamApply!.entries[2]!.bodySha256,
            },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /command drain boundary must be distinct from command opcode 65/u,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          gameThread: {
            drain: { ...build.gameThread!.drain, tableSlot: 0 },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /command drain table slot 0 does not map/,
    );
  });

  it("refuses an uncertified or shared traced packet sender", () => {
    const input = fixture();
    const build = manifest(input);
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          teamApply: {
            ...build.teamApply!,
            professionTrace: {
              ...build.teamApply!.professionTrace,
              sender: {
                ...build.teamApply!.professionTrace.sender,
                bodySha256: "0".repeat(64),
              },
            },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /traced packet sender resolves .* not the certified/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          teamApply: {
            ...build.teamApply!,
            professionTrace: {
              ...build.teamApply!.professionTrace,
              sender: {
                ...build.teamApply!.professionTrace.sender,
                functionIndex: 5,
                bodySha256: createHash("sha256")
                  .update(commandBody(input, 2))
                  .digest("hex"),
              },
            },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /traced packet sender must be distinct from dispatch hook 2/u,
    );
  });

  it("refuses an uncertified storage slash parser", () => {
    const input = fixture();
    const build = manifest(input);
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          chatAliases: {
            parser: {
              ...build.chatAliases!.parser,
              bodySha256: "0".repeat(64),
            },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /storage slash parser body does not match its semantic fingerprint/,
    );
  });

  it("refuses an uncertified Xunlai access reader", () => {
    const input = fixture();
    const build = manifest(input);
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          xunlaiAction: {
            ...build.xunlaiAction!,
            accessProof: {
              ...build.xunlaiAction!.accessProof!,
              readers: {
                ...build.xunlaiAction!.accessProof!.readers,
                "access-flags": {
                  ...build.xunlaiAction!.accessProof!.readers["access-flags"],
                  bodySha256: "0".repeat(64),
                },
              },
            },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /access-flags reader body does not match its semantic fingerprint/,
    );
  });

  it("refuses a travel producer that aliases a selected dispatch hook", () => {
    const input = fixture();
    const build = manifest(input);
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          travelAction: {
              ...build.travelAction!,
              producer: {
                ...build.travelAction!.producer,
                functionIndex: build.cursorEvent!.functionIndex,
                bodySha256: build.cursorEvent!.bodySha256,
              },
          },
        },
        CURSOR_TARGET_TOOLBOX_COMMANDS,
      ),
      /travel payload producer must be distinct from dispatch hook 1/u,
    );
  });

});
