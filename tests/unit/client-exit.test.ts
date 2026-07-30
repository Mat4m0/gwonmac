import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installClientExit,
  type ClientExitImports,
} from "../../src/renderer/client-exit.js";

type Callback = (...args: number[]) => unknown;

function uleb(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

function realMainLoopInstance(): WebAssembly.Instance {
  const loopName = [
    ...new TextEncoder().encode("EmscriptenExeThreadMainLoop"),
  ];
  const tableName = [
    ...new TextEncoder().encode("__indirect_function_table"),
  ];
  const bytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 1, 0x7f, 0]),
    ...section(3, [1, 0]),
    ...section(4, [1, 0x70, 1, 1, 1]),
    ...section(7, [
      2,
      ...uleb(loopName.length), ...loopName, 0, 0,
      ...uleb(tableName.length), ...tableName, 1, 0,
    ]),
    ...section(9, [1, 0, 0x41, 0, 0x0b, 1, 0]),
    ...section(10, [1, 2, 0, 0x0b]),
  ]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes));
}

function fixture() {
  const frames: FrameRequestCallback[] = [];
  const delegated: number[][] = [];
  const failures: unknown[] = [];
  let exits = 0;
  let mainLoop: Callback = () => undefined;
  const table = new WebAssembly.Table({
    element: "anyfunc",
    initial: 2,
  });
  // Node cannot put an ordinary JavaScript function in a funcref table. The
  // installer only relies on reference identity, so this fixture supplies the
  // same WebAssembly-shaped exports through a narrow test table.
  const tableView = {
    get(index: number): Callback | null {
      return index === 1 ? mainLoop : null;
    },
  };
  const imports: ClientExitImports = {
    env: {
      emscripten_async_call: (...args) => {
        delegated.push(args);
      },
    },
  };
  const instance = {
    exports: {
      EmscriptenExeThreadMainLoop: mainLoop,
      __indirect_function_table: table,
    },
  };
  Object.defineProperty(table, "get", {
    value: tableView.get.bind(tableView),
  });
  installClientExit({
    imports,
    instance: () => instance,
    onExit: () => {
      exits += 1;
    },
    onFailure: (error) => failures.push(error),
    log: () => undefined,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    promising: (callback) => async (...args) => callback(...args),
  });
  return {
    delegated,
    failures,
    frames,
    imports,
    setMainLoop(callback: Callback) {
      mainLoop = callback;
      instance.exports.EmscriptenExeThreadMainLoop = callback;
    },
    get exits() {
      return exits;
    },
  };
}

async function runFrame(value: ReturnType<typeof fixture>): Promise<void> {
  const frame = value.frames.shift();
  assert.ok(frame, "no animation frame was scheduled");
  frame(0);
  await Promise.resolve();
  await Promise.resolve();
}

describe("client clean-exit adapter", () => {
  it("recognizes the real exported function stored in a WebAssembly table", async () => {
    const instance = realMainLoopInstance();
    const frames: FrameRequestCallback[] = [];
    let exits = 0;
    const imports: ClientExitImports = {
      env: { emscripten_async_call: () => assert.fail("unexpected delegation") },
    };
    installClientExit({
      imports,
      instance: () => instance,
      onExit: () => {
        exits += 1;
      },
      onFailure: (error) => {
        assert.fail(error instanceof Error ? error : String(error));
      },
      log: () => undefined,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      promising: (callback) => async (...args) => callback(...args),
    });

    imports.env!.emscripten_async_call!(0, 0, -1);
    const frame = frames.shift();
    assert.ok(frame);
    frame(0);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(exits, 1);
  });

  it("delegates timers and callbacks that are not the exported main loop", () => {
    const value = fixture();
    value.imports.env!.emscripten_async_call!(1, 7, 10);
    value.imports.env!.emscripten_async_call!(0, 8, -1);
    assert.deepEqual(value.delegated, [
      [1, 7, 10],
      [0, 8, -1],
    ]);
    assert.equal(value.frames.length, 0);
  });

  it("keeps running while the main loop schedules a successor", async () => {
    const value = fixture();
    let ticks = 0;
    value.setMainLoop(() => {
      ticks += 1;
      if (ticks < 2) {
        value.imports.env!.emscripten_async_call!(1, 0, -1);
      }
    });

    value.imports.env!.emscripten_async_call!(1, 0, -1);
    await runFrame(value);
    assert.equal(value.exits, 0);
    assert.equal(value.frames.length, 1);

    await runFrame(value);
    assert.equal(value.exits, 1);
    assert.equal(value.failures.length, 0);
  });

  it("reports a successful final tick as one clean exit", async () => {
    const value = fixture();
    value.setMainLoop(() => undefined);

    value.imports.env!.emscripten_async_call!(1, 0, -1);
    await runFrame(value);
    assert.equal(value.exits, 1);

    value.imports.env!.emscripten_async_call!(1, 0, -1);
    assert.equal(value.frames.length, 0);
    assert.equal(value.exits, 1);
  });

  it("reports a rejected main-loop tick as a failure, not a clean exit", async () => {
    const value = fixture();
    const failure = new Error("main loop failed");
    value.setMainLoop(() => Promise.reject(failure));

    value.imports.env!.emscripten_async_call!(1, 0, -1);
    await runFrame(value);
    assert.deepEqual(value.failures, [failure]);
    assert.equal(value.exits, 0);
  });
});
