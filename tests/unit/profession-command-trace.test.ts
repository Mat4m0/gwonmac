import assert from "node:assert/strict";
import test from "node:test";
import {
  createProfessionCommandTrace,
  PROFESSION_COMMAND_TRACE_BYTES,
} from "../../src/renderer/profession-command-trace.js";
import type { ToolboxObservation } from "../../src/shared/builds/live-party.js";
import { PROFESSION_TRACE_SCHEMA } from "../../src/shared/profession-command-trace.js";

const professionSnapshot = (
  count: number,
  origin: number,
  target: number,
  profession: number,
  drainCount = 0,
  drainOpcode = 0,
): number[] => [
  PROFESSION_TRACE_SCHEMA,
  count, origin, target, profession,
  0, 0, 0, 0,
  count, origin, 999, 2, 555, 10, 22, 0, 1, 12,
  65, target, profession, 0, 0, 0, 0, 0, 0, 0, 0,
  drainCount, drainOpcode,
];

test("the command trace publishes exact profession and skill payloads", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousInfo = console.info;
  const fakeWindow = {};
  const logs: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  console.info = (message?: unknown) => { logs.push(String(message)); };
  try {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const pointer = 64;
    let snapshot = professionSnapshot(1, 0, 77, 2);
    const trace = createProfessionCommandTrace(memory, pointer, (at) => {
      new Uint32Array(memory.buffer, at, snapshot.length).set(snapshot);
      return snapshot.length;
    });
    const state: ToolboxObservation = {
      status: "ready",
      party: {
        status: "ready",
        slots: [{
          index: 1,
          occupied: true,
          hero: 38,
          agentId: 77,
          level: 20,
          professions: [1, 4],
          behaviour: 1,
          skills: null,
          disabled: null,
          attributes: null,
        }],
      },
    };

    assert.equal(PROFESSION_COMMAND_TRACE_BYTES, 128);
    trace.poll(state);
    trace.poll(state);
    snapshot = professionSnapshot(2, 1, 77, 4);
    trace.poll(state);
    snapshot = [
      PROFESSION_TRACE_SCHEMA,
      2, 1, 77, 4,
      1, 0, 77, 8,
      3, 0, 999, 2, 555, 10, 22, 0, 1, 44,
      93, 77, 8, 1, 2, 3, 4, 5, 6, 7, 8,
      1, 93,
    ];
    trace.poll(state);

    const probe = Reflect.get(fakeWindow, "gwProfessionCommandTrace") as {
      entries: readonly unknown[];
    };
    assert.equal(probe.entries.length, 3, "an unchanged poll adds no record");
    assert.deepEqual(probe.entries[0], {
      sequence: 1,
      changed: {
        professionBuilder: true,
        skillBuilder: false,
        sender: true,
        drain: false,
      },
      drain: { count: 0, opcode: 0 },
      professionBuilder: { count: 1, origin: "native", target: 77, profession: 2 },
      skillBuilder: { count: 0, origin: "native", target: 0, skillCount: 0 },
      sender: {
        count: 1,
        origin: "native",
        connection: 999,
        state: 2,
        transport: 555,
        cursorBefore: 10,
        cursorAfter: 22,
        flagBefore: 0,
        flagAfter: 1,
        size: 12,
        payload: [65, 77, 2],
      },
      observed: { heroId: 38, agentId: 77, professions: [1, 4] },
    });
    assert.deepEqual(probe.entries[2], {
      sequence: 3,
      changed: {
        professionBuilder: false,
        skillBuilder: true,
        sender: true,
        drain: true,
      },
      drain: { count: 1, opcode: 93 },
      professionBuilder: { count: 2, origin: "gwonmac", target: 77, profession: 4 },
      skillBuilder: { count: 1, origin: "native", target: 77, skillCount: 8 },
      sender: {
        count: 3,
        origin: "native",
        connection: 999,
        state: 2,
        transport: 555,
        cursorBefore: 10,
        cursorAfter: 22,
        flagBefore: 0,
        flagAfter: 1,
        size: 44,
        payload: [93, 77, 8, 1, 2, 3, 4, 5, 6, 7, 8],
      },
      observed: { heroId: 38, agentId: 77, professions: [1, 4] },
    });
    assert.match(logs[1]!, /"origin":"gwonmac"/);

    for (let count = 4; count <= 28; count += 1) {
      snapshot = professionSnapshot(count - 1, 1, 77, 4, count - 2, 16);
      trace.poll(state);
    }
    const boundedProbe = Reflect.get(fakeWindow, "gwProfessionCommandTrace") as {
      entries: readonly { sequence: number }[];
    };
    assert.equal(boundedProbe.entries.length, 24);
    assert.equal(boundedProbe.entries[0]?.sequence, 5);
    assert.equal(boundedProbe.entries.at(-1)?.sequence, 28);

    trace.dispose();
    assert.equal(Reflect.has(fakeWindow, "gwProfessionCommandTrace"), false);
  } finally {
    console.info = previousInfo;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a drained attribute opcode does not invent an observed target", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousInfo = console.info;
  const fakeWindow = {};
  const logs: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  console.info = (message?: unknown) => { logs.push(String(message)); };
  try {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const snapshot = professionSnapshot(0, 0, 0, 0, 1, 16);
    const trace = createProfessionCommandTrace(memory, 128, (pointer) => {
      new Uint32Array(memory.buffer, pointer, snapshot.length).set(snapshot);
      return snapshot.length;
    });
    trace.poll({ status: "ready" });

    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /"drain":\{"count":1,"opcode":16\}/u);
    assert.match(logs[0]!, /"observed":null/u);
    trace.dispose();
  } finally {
    console.info = previousInfo;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
