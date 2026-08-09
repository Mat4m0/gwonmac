import assert from "node:assert/strict";
import test from "node:test";
import {
  createProfessionCommandTrace,
  PROFESSION_COMMAND_TRACE_BYTES,
} from "../../src/renderer/profession-command-trace.js";
import type { ToolboxObservation } from "../../src/shared/builds/live-party.js";

test("the profession trace publishes only changed bounded snapshots", () => {
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
    let snapshot = [1, 1, 0, 77, 2, 1, 0, 12, 65, 77, 2];
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

    assert.equal(PROFESSION_COMMAND_TRACE_BYTES, 44);
    trace.poll(state);
    trace.poll(state);
    snapshot = [1, 2, 1, 77, 4, 2, 1, 12, 65, 77, 4];
    trace.poll(state);

    const probe = Reflect.get(fakeWindow, "gwProfessionCommandTrace") as {
      entries: readonly unknown[];
    };
    assert.equal(probe.entries.length, 2, "an unchanged poll adds no record");
    assert.deepEqual(probe.entries[0], {
      sequence: 1,
      builder: { count: 1, origin: "native", target: 77, profession: 2 },
      sender: {
        count: 1,
        origin: "native",
        size: 12,
        opcode: 65,
        target: 77,
        profession: 2,
      },
      observed: { heroId: 38, agentId: 77, professions: [1, 4] },
    });
    assert.match(logs[1]!, /"origin":"gwonmac"/);

    for (let count = 3; count <= 27; count += 1) {
      snapshot = [1, count, 1, 77, 4, count, 1, 12, 65, 77, 4];
      trace.poll(state);
    }
    const boundedProbe = Reflect.get(fakeWindow, "gwProfessionCommandTrace") as {
      entries: readonly { sequence: number }[];
    };
    assert.equal(boundedProbe.entries.length, 24);
    assert.equal(boundedProbe.entries[0]?.sequence, 4);
    assert.equal(boundedProbe.entries.at(-1)?.sequence, 27);

    trace.dispose();
    assert.equal(Reflect.has(fakeWindow, "gwProfessionCommandTrace"), false);
  } finally {
    console.info = previousInfo;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
