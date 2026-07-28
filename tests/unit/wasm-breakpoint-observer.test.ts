import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { CDPSession } from "playwright";
import {
  createWasmBreakpointObserver,
  parseBreakpointFunctions,
} from "../../scripts/enhancements-live/wasm-breakpoints.js";

class FakeCdp extends EventEmitter {
  readonly calls: Array<{ method: string; params: unknown }> = [];

  async send(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "Debugger.enable") {
      queueMicrotask(() => {
        this.emit("Debugger.scriptParsed", {
          scriptId: "small",
          scriptLanguage: "WebAssembly",
        });
        this.emit("Debugger.scriptParsed", {
          scriptId: "game",
          scriptLanguage: "WebAssembly",
        });
      });
      await new Promise((resolve) => setImmediate(resolve));
      return {};
    }
    if (method === "Debugger.disassembleWasmModule") {
      const scriptId = (params as { scriptId: string }).scriptId;
      return {
        functionBodyOffsets: scriptId === "game" ? [10, 19, 20, 29] : [1, 9],
      };
    }
    if (method === "Debugger.setBreakpoint") {
      setTimeout(() => {
        this.emit("Debugger.paused", {
          hitBreakpoints: ["bp"],
          callFrames: [
            {
              callFrameId: "frame",
              functionName: "$candidate",
              scopeChain: [
                {
                  type: "local",
                  object: { objectId: "locals" },
                },
              ],
            },
          ],
        });
      }, 0);
      return { breakpointId: "bp" };
    }
    if (method === "Debugger.evaluateOnCallFrame") {
      return { result: { value: Array.from({ length: 35 }, (_, i) => i) } };
    }
    if (method === "Runtime.getProperties") {
      return (params as { objectId: string }).objectId === "locals"
        ? {
            result: [
              {
                name: "$var0",
                value: { subtype: "wasmvalue", objectId: "wasm0" },
              },
            ],
          }
        : {
            result: [
              { name: "type", value: { value: "i32" } },
              { name: "value", value: { value: 41 } },
            ],
          };
    }
    return {};
  }
}

class NoisyCdp extends FakeCdp {
  private breakpointCount = 0;

  override async send(method: string, params?: unknown): Promise<unknown> {
    if (method !== "Debugger.setBreakpoint") {
      return super.send(method, params);
    }
    this.calls.push({ method, params });
    const breakpointId = `noisy-${this.breakpointCount++}`;
    if (this.breakpointCount === 2) {
      setImmediate(() => {
        for (let index = 0; index < 70; index += 1) {
          this.emit("Debugger.paused", {
            hitBreakpoints: ["noisy-0"],
            callFrames: [{ functionName: "$noisy", scopeChain: [] }],
          });
        }
        this.emit("Debugger.paused", {
          hitBreakpoints: ["noisy-1"],
          callFrames: [{ functionName: "$rare", scopeChain: [] }],
        });
      });
    }
    return { breakpointId };
  }
}

class TemplateCdp extends FakeCdp {
  override async send(method: string, params?: unknown): Promise<unknown> {
    if (
      method === "Debugger.evaluateOnCallFrame" &&
      (params as { expression?: string }).expression?.includes("2673504")
    ) {
      this.calls.push({ method, params });
      return { result: { value: Array.from({ length: 12 }, (_, i) => i) } };
    }
    if (
      method === "Runtime.getProperties" &&
      (params as { objectId?: string }).objectId === "locals"
    ) {
      this.calls.push({ method, params });
      return {
        result: [
          {
            name: "$var1",
            value: { subtype: "wasmvalue", objectId: "wasm0" },
          },
        ],
      };
    }
    return super.send(method, params);
  }
}

describe("WASM breakpoint observation", () => {
  it("accepts a small, unique list of function indices", () => {
    assert.deepEqual(
      parseBreakpointFunctions("16592, 16959,16592"),
      [16592, 16959],
    );
    assert.throws(() => parseBreakpointFunctions("-1"));
    assert.throws(() => parseBreakpointFunctions("1,"));
    assert.throws(() =>
      parseBreakpointFunctions(
        Array.from({ length: 33 }, (_, index) => index).join(","),
      ),
    );
  });

  it("selects the containing module and records only bounded scalar locals", async () => {
    const cdp = new FakeCdp();
    const observer = await createWasmBreakpointObserver(
      cdp as unknown as CDPSession,
      1,
      [2],
    );
    const evidence = await observer.capture(20);

    assert.equal(evidence.functionImports, 1);
    assert.deepEqual(evidence.functions, [2]);
    assert.deepEqual(evidence.hits, [
      {
        atMs: evidence.hits[0]?.atMs,
        functionIndex: 2,
        locals: [{ name: "$var0", type: "i32", value: 41 }],
        stack: ["$candidate"],
      },
    ]);
    assert.deepEqual(
      cdp.calls.find((call) => call.method === "Debugger.setBreakpoint")
        ?.params,
      {
        location: { scriptId: "game", lineNumber: 0, columnNumber: 20 },
      },
    );
    assert.ok(cdp.calls.some((call) => call.method === "Debugger.resume"));
    assert.ok(
      cdp.calls.some((call) => call.method === "Debugger.removeBreakpoint"),
    );
  });

  it("reserves bounded evidence capacity for quiet candidates", async () => {
    const cdp = new NoisyCdp();
    const observer = await createWasmBreakpointObserver(
      cdp as unknown as CDPSession,
      1,
      [1, 2],
    );
    const evidence = await observer.capture(20);

    assert.equal(
      evidence.hits.filter((hit) => hit.functionIndex === 1).length,
      16,
    );
    assert.equal(
      evidence.hits.filter((hit) => hit.functionIndex === 2).length,
      1,
    );
    assert.equal(evidence.overflow, 54);
    assert.ok(
      cdp.calls.some(
        (call) =>
          call.method === "Debugger.removeBreakpoint" &&
          (call.params as { breakpointId?: string }).breakpointId === "noisy-0",
      ),
    );
  });

  it("can finish an operator-paced capture without a fixed timer", async () => {
    const cdp = new FakeCdp();
    const observer = await createWasmBreakpointObserver(
      cdp as unknown as CDPSession,
      1,
      [2],
    );
    const session = await observer.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const evidence = await session.finish();

    assert.equal(evidence.functions[0], 2);
    assert.equal(evidence.hits.length, 1);
    assert.ok(evidence.durationMs >= 0);
    assert.strictEqual(await session.finish(), evidence);
  });

  it("installs only the certified subset requested for one operator step", async () => {
    const cdp = new FakeCdp();
    const observer = await createWasmBreakpointObserver(
      cdp as unknown as CDPSession,
      1,
      [1, 2],
    );
    const session = await observer.start([2]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const evidence = await session.finish();

    assert.deepEqual(evidence.functions, [2]);
    assert.equal(
      cdp.calls.filter((call) => call.method === "Debugger.setBreakpoint")
        .length,
      1,
    );
    await assert.rejects(() => observer.start([3]), /certified functions/);
    await assert.rejects(() => observer.start([]), /certified functions/);
  });

  it("captures only the bounded template argument at the certified wrapper", async () => {
    const cdp = new TemplateCdp();
    const observer = await createWasmBreakpointObserver(
      cdp as unknown as CDPSession,
      16_958,
      [16_959],
    );
    const evidence = await observer.capture(20);

    assert.deepEqual(
      evidence.hits[0]?.templateWords,
      Array.from({ length: 35 }, (_, index) => index),
    );
    assert.deepEqual(
      evidence.hits[0]?.propertyContextWords,
      Array.from({ length: 12 }, (_, index) => index),
    );
    assert.equal(
      cdp.calls.filter((call) => call.method === "Debugger.evaluateOnCallFrame")
        .length,
      2,
    );
  });
});
