import assert from "node:assert/strict";
import test from "node:test";
import {
  createProfessionCommandTrace,
  PROFESSION_COMMAND_TRACE_BYTES,
} from "../../src/renderer/profession-command-trace.js";
import type { ToolboxObservation } from "../../src/shared/builds/live-party.js";

const professionSnapshot = (
  count: number,
  origin: number,
  target: number,
  profession: number,
): number[] => [
  1,
  count, origin, target, profession,
  0, 0, 0, 0,
  count, origin, 12,
  65, target, profession, 0, 0, 0, 0, 0, 0, 0, 0,
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

    assert.equal(PROFESSION_COMMAND_TRACE_BYTES, 92);
    trace.poll(state);
    trace.poll(state);
    snapshot = professionSnapshot(2, 1, 77, 4);
    trace.poll(state);
    snapshot = [
      1,
      2, 1, 77, 4,
      1, 0, 77, 8,
      3, 0, 44,
      93, 77, 8, 1, 2, 3, 4, 5, 6, 7, 8,
    ];
    trace.poll(state);

    const probe = Reflect.get(fakeWindow, "gwProfessionCommandTrace") as {
      entries: readonly unknown[];
    };
    assert.equal(probe.entries.length, 3, "an unchanged poll adds no record");
    assert.deepEqual(probe.entries[0], {
      sequence: 1,
      changed: { professionBuilder: true, skillBuilder: false, sender: true },
      professionBuilder: { count: 1, origin: "native", target: 77, profession: 2 },
      skillBuilder: { count: 0, origin: "native", target: 0, skillCount: 0 },
      sender: { count: 1, origin: "native", size: 12, payload: [65, 77, 2] },
      observed: { heroId: 38, agentId: 77, professions: [1, 4] },
    });
    assert.deepEqual(probe.entries[2], {
      sequence: 3,
      changed: { professionBuilder: false, skillBuilder: true, sender: true },
      professionBuilder: { count: 2, origin: "gwonmac", target: 77, profession: 4 },
      skillBuilder: { count: 1, origin: "native", target: 77, skillCount: 8 },
      sender: {
        count: 3,
        origin: "native",
        size: 44,
        payload: [93, 77, 8, 1, 2, 3, 4, 5, 6, 7, 8],
      },
      observed: { heroId: 38, agentId: 77, professions: [1, 4] },
    });
    assert.match(logs[1]!, /"origin":"gwonmac"/);

    for (let count = 4; count <= 28; count += 1) {
      snapshot = professionSnapshot(count - 1, 1, 77, 4);
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
