// P5.1/P5.2, executed rather than asserted about. The real preload and the real
// renderer command router are loaded and driven: a command crosses as a typed
// object, a capture level arrives as a number rather than spliced into a string
// of JavaScript, the acknowledgement main waits on is sent only after the
// renderer's own promise settles, and launch configuration comes from the
// preload argument instead of the renderer URL.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as contracts from "../../src/shared/contracts.ts";
import {
  RENDERER_INIT_ARGUMENT,
  type GwNativeApi,
  type RendererCommand,
  type RendererInit,
} from "../../src/shared/contracts.ts";
import { preloadSource as generatePreload } from "../../scripts/generate-preload.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The preload as it ships: generated from the canonical contracts, not read
// from a checked-in copy of them.
const preloadSource: string = generatePreload(contracts, root);
// The router is a classic script — index.html loads it with a `<script>` tag
// and it exports nothing — so the only way to drive it is to run its text. It
// is TypeScript from P3, so the text is transpiled here under the same target
// and module the renderer project emits with. Reading src/ and transpiling is
// what keeps this test buildless; reading build/renderer would make it depend
// on a build the unit suite does not run.
const routerSource = ts.transpileModule(
  await readFile(path.join(root, "src/renderer/commands.ts"), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;

interface CaptureCall {
  name: string;
  argument?: unknown;
}

function harness(argv: string[]) {
  const sent: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<
    string,
    ((event: unknown, ...args: unknown[]) => void)[]
  >();
  let api: GwNativeApi | undefined;
  const ipcRenderer = {
    invoke: () => Promise.resolve(),
    send(channel: string, ...args: unknown[]) {
      sent.push({ channel, args });
    },
    on(channel: string, handler: (event: unknown, ...args: unknown[]) => void) {
      listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
    },
    removeListener() {},
  };
  vm.runInNewContext(preloadSource, {
    console,
    process: { argv },
    require(name: string) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name: string, value: GwNativeApi) {
            assert.equal(name, "gwNative");
            api = value;
          },
        },
        ipcRenderer,
      };
    },
  });
  assert.ok(api, "preload exposed no api");

  // The renderer half: the real router, over the real preload object.
  const dispatched: string[] = [];
  const capture: CaptureCall[] = [];
  let releaseFlush = (): void => {};
  const flushed = new Promise<void>((resolve) => {
    releaseFlush = resolve;
  });
  const window = {
    gwNative: api,
    gwDiagnostics: {
      resetForCapture: () => Promise.resolve(),
      captureStarted(level: unknown) {
        capture.push({ name: "captureStarted", argument: level });
      },
      captureStopped() {
        capture.push({ name: "captureStopped" });
      },
      problemMarked() {
        capture.push({ name: "problemMarked" });
      },
      flush() {
        capture.push({ name: "flush" });
        return flushed;
      },
    },
    CustomEvent: class {
      readonly type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    dispatchEvent(event: { type: string }) {
      dispatched.push(event.type);
    },
  };
  const context: Record<string, unknown> = { console, window };
  context.globalThis = context;
  vm.runInNewContext(routerSource, context);

  const deliver = (id: number, command: RendererCommand): void => {
    for (const handler of listeners.get("gw:renderer:command") ?? []) {
      handler({}, id, command);
    }
  };
  const acknowledgements = (): unknown[][] =>
    sent
      .filter((entry) => entry.channel === "gw:renderer:commandDone")
      .map((entry) => entry.args);

  return {
    api,
    capture,
    deliver,
    dispatched,
    acknowledgements,
    releaseFlush,
    window,
  };
}

const INIT: RendererInit = {
  enhancementProgram: "toolbox-foundation",
  enhancementSelection: {
    nativeCursor: false,
  },
  templateFsTrace: true,
};
const ARGV = ["electron", `${RENDERER_INIT_ARGUMENT}${JSON.stringify(INIT)}`];
const plainInit = (value: RendererInit): RendererInit => ({
  ...value,
  enhancementSelection: { ...value.enhancementSelection },
});

test("launch configuration arrives as a preload argument, not as a URL", () => {
  assert.deepEqual(plainInit(harness(ARGV).api.init), INIT);
});

test("a renderer with no readable init argument gets the production posture", () => {
  const missing: RendererInit = {
    enhancementProgram: "none",
    enhancementSelection: {
      nativeCursor: false,
    },
    templateFsTrace: false,
  };
  assert.deepEqual(plainInit(harness([]).api.init), missing);
  assert.deepEqual(
    plainInit(harness([`${RENDERER_INIT_ARGUMENT}{not json`]).api.init),
    missing,
  );
  assert.deepEqual(
    plainInit(harness([...ARGV, ...ARGV]).api.init),
    missing,
  );
  // A parameter that is present but not a boolean is not an opt-in.
  assert.deepEqual(
    plainInit(
      harness([
        `${RENDERER_INIT_ARGUMENT}{"enhancementProgram":"unknown","enhancementSelection":{"nativeCursor":"yes","targetReadout":1}}`,
      ]).api.init,
    ),
    missing,
  );
});

test("menu commands reach the renderer as events and are acknowledged", async () => {
  const fixture = harness(ARGV);
  fixture.deliver(1, { type: "input.reset" });
  fixture.deliver(2, { type: "settings.open" });
  fixture.deliver(3, { type: "diagnostics.toggle" });
  fixture.deliver(4, { type: "tools.toggle" });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.dispatched, [
    "gw:input-reset",
    "gw:settings",
    "gw:diagnostics-toggle",
    "gw:tools-toggle",
  ]);
  assert.deepEqual(fixture.acknowledgements(), [
    [1, "completed"],
    [2, "completed"],
    [3, "completed"],
    [4, "completed"],
  ]);
});

test("a capture level crosses as a number, not as interpolated source", async () => {
  const fixture = harness(ARGV);
  fixture.deliver(7, {
    type: "diagnostics.capture",
    action: "started",
    level: 2,
  });
  fixture.deliver(8, { type: "diagnostics.capture", action: "problem-marked" });
  fixture.deliver(9, { type: "diagnostics.capture", action: "stopped" });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.capture, [
    { name: "captureStarted", argument: 2 },
    { name: "problemMarked" },
    { name: "captureStopped" },
  ]);
  assert.equal(typeof fixture.capture[0]!.argument, "number");
  assert.deepEqual(fixture.acknowledgements(), [
    [7, "completed"],
    [8, "completed"],
    [9, "completed"],
  ]);
});

test("the acknowledgement waits for the renderer's own promise", async () => {
  // This is what `await executeJavaScript(...)` used to buy: main closes the
  // capture window only after the renderer's last batch has been handed over.
  const fixture = harness(ARGV);
  fixture.deliver(11, { type: "diagnostics.capture", action: "flush" });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.capture, [{ name: "flush" }]);
  assert.deepEqual(fixture.acknowledgements(), []);

  fixture.releaseFlush();
  await new Promise(setImmediate);
  assert.deepEqual(fixture.acknowledgements(), [[11, "completed"]]);
});

test("a renderer that cannot act reports failure", async () => {
  const fixture = harness(ARGV);
  fixture.window.gwDiagnostics.flush = () => Promise.reject(new Error("gone"));
  fixture.deliver(13, { type: "diagnostics.capture", action: "flush" });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.acknowledgements(), [[13, "failed"]]);

  Reflect.deleteProperty(fixture.window, "gwDiagnostics");
  fixture.deliver(14, { type: "diagnostics.capture", action: "stopped" });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.acknowledgements(), [
    [13, "failed"],
    [14, "failed"],
  ]);
});
