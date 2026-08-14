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
  commandBody,
  CURSOR_ONLY,
  CURSOR_TARGET,
  CURSOR_TARGET_TOOLBOX_COMMANDS,
  CURSOR_TOOLBOX,
  CURSOR_TOOLBOX_COMMANDS,
  fixture,
  manifest,
  TARGET_ONLY,
} from "../fixtures/enhancement-transform.js";

describe("Enhancement command transform", () => {
  // The command queue is the entire write surface. These are the tests that
  // decide whether this app can send a packet, so they instantiate the
  // transformed module and drive the function rather than inspecting bytes.
  it("emits the command queue only for the four command profiles", () => {
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
    }
    for (const capabilities of [
      { ...CURSOR_TOOLBOX_COMMANDS, nativeCursor: false },
      CURSOR_TOOLBOX_COMMANDS,
      { ...CURSOR_TARGET_TOOLBOX_COMMANDS, nativeCursor: false },
      CURSOR_TARGET_TOOLBOX_COMMANDS,
    ]) {
      const output = transformEnhancementWasm(input, build, capabilities);
      const exports = parseExports(sectionById(splitSections(output), 7));
      assert.equal(
        exports.filter((entry) => entry.name === build.teamApply!.thunkExport).length,
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
      assert.equal(readTrace(64), 30);
      return [...new Uint32Array(wasmMemory.buffer, 64, 30)];
    };

    new Uint32Array(wasmMemory.buffer, 0, 2).set([31, 38]);
    nativeSender(999, 8, 0);
    assert.deepEqual(trace(), [
      1,
      0, 0, 0, 0,
      0, 0, 0, 0,
      1, 0, 999, 0, 0, 0, 0, 0, 0, 8,
      31, 38, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    nativeProfession(77, 2);
    assert.deepEqual(packets, [[999, 8, 0], [999, 12, 0]]);
    assert.deepEqual([...new Uint32Array(wasmMemory.buffer, 0, 3)], [65, 77, 2]);
    assert.deepEqual(trace(), [
      1,
      1, 0, 77, 2,
      0, 0, 0, 0,
      2, 0, 999, 0, 0, 0, 0, 0, 0, 12,
      65, 77, 2, 0, 0, 0, 0, 0, 0, 0, 0,
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
      1,
      2, 1, 88, 3,
      0, 0, 0, 0,
      3, 1, 999, 0, 0, 0, 0, 0, 0, 12,
      65, 88, 3, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    const skillWords = new Uint32Array(wasmMemory.buffer, 256, 8);
    skillWords.set([1, 2, 3, 4, 5, 6, 446, 8]);
    nativeSkill(77, 8, 256);
    assert.deepEqual(trace(), [
      1,
      2, 1, 88, 3,
      1, 0, 77, 8,
      4, 0, 999, 0, 0, 0, 0, 0, 0, 44,
      93, 77, 8, 1, 2, 3, 4, 5, 6, 446, 8,
    ]);
    assert.equal(enqueue(93, 77, 8, 256, 0), 1);
    frame(3, 4);
    assert.deepEqual([...new Uint32Array(wasmMemory.buffer, 128, 11)], [
      93, 77, 8, 1, 2, 3, 4, 5, 6, 446, 8,
    ]);
    assert.deepEqual(trace(), [
      1,
      2, 1, 88, 3,
      2, 1, 77, 8,
      5, 1, 999, 0, 0, 0, 0, 0, 0, 44,
      93, 77, 8, 1, 2, 3, 4, 5, 6, 446, 8,
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
          teamApply: {
            ...build.teamApply!,
            drain: { ...build.teamApply!.drain, bodySha256: "0".repeat(64) },
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
          teamApply: {
            ...build.teamApply!,
            // The profession command has the same signature. Identity must still be
            // distinct so command execution and scheduling cannot merge.
            drain: {
              ...build.teamApply!.drain,
              functionIndex: 9,
              bodySha256: build.teamApply!.entries[2]!.bodySha256,
            },
          },
        },
        CURSOR_TOOLBOX_COMMANDS,
      ),
      /must be distinct from hooks, commands, and sender/,
    );
    assert.throws(
      () => transformEnhancementWasm(
        input,
        {
          ...build,
          teamApply: {
            ...build.teamApply!,
            drain: { ...build.teamApply!.drain, tableSlot: 0 },
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
      /traced packet sender must be distinct from hooks and commands/,
    );
  });

});
