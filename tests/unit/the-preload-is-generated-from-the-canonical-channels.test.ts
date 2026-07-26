// P5.6, executed rather than asserted about. The preload's channel constants
// used to be a hand-maintained copy of `IPC`; a release test policed the copy by
// searching the preload's text for every channel string, which proved the copy
// existed and nothing about what the preload did with it.
//
// Here the generator runs over *altered* contracts and the preload it produces
// is executed in a vm: the exposed method invokes the channel the contracts
// named, so renaming a channel and rebuilding really does move the call.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as contracts from "../../src/shared/contracts.ts";
import type { GwNativeApi } from "../../src/shared/contracts.ts";
// @ts-expect-error a build script, deliberately untyped.
import {
  PRELOAD_CONSTANTS,
  preloadSource,
} from "../../scripts/generate-preload.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Loads a generated preload and returns what it exposed, plus what it called. */
function run(source: string, argv: string[] = []) {
  const invoked: { channel: string; args: unknown[] }[] = [];
  const listened: string[] = [];
  let api: GwNativeApi | undefined;
  vm.runInNewContext(source, {
    console,
    process: { argv },
    require(name: string) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(_name: string, value: GwNativeApi) {
            api = value;
          },
        },
        ipcRenderer: {
          invoke(channel: string, ...args: unknown[]) {
            invoked.push({ channel, args });
            return Promise.resolve();
          },
          on(channel: string) {
            listened.push(channel);
          },
          removeListener() {},
          send() {},
        },
      };
    },
  });
  assert.ok(api, "the generated preload exposed nothing");
  return { api, invoked, listened };
}

const plainInit = (value: GwNativeApi["init"]): GwNativeApi["init"] => ({
  ...value,
  toolboxSelection: { ...value.toolboxSelection },
});

test("the exposed method invokes the channel the contracts name", async () => {
  const { api, invoked, listened } = run(preloadSource(contracts, root));
  await api.progress.current();
  await api.credentials.save({ username: "u", password: "p" });
  api.sockets.onEvent(() => {});
  assert.deepEqual(invoked, [
    { channel: contracts.IPC.progressCurrent, args: [] },
    {
      channel: contracts.IPC.credentialsSave,
      args: [{ username: "u", password: "p" }],
    },
  ]);
  assert.deepEqual(listened, [
    contracts.IPC.rendererCommand,
    contracts.IPC.socketEvent,
  ]);
});

test("renaming a canonical channel moves the call, with no edit to the body", async () => {
  const renamed = {
    ...contracts,
    IPC: { ...contracts.IPC, progressCurrent: "gw:progress:renamedByThisTest" },
  };
  const { api, invoked } = run(preloadSource(renamed, root));
  await api.progress.current();
  assert.deepEqual(invoked, [
    { channel: "gw:progress:renamedByThisTest", args: [] },
  ]);
});

test("the derived client's bridge markers cross unchanged, and follow an edit", () => {
  const { api } = run(preloadSource(contracts, root));
  assert.deepEqual(
    { ...api.wasmBridgeMarkers },
    { ...contracts.WASM_BRIDGE_MARKERS },
  );

  // Editing the canonical value moves the renderer's copy with it. The main
  // half is held by `tsc`: template-save-compat.ts imports the same object.
  const edited = run(
    preloadSource(
      {
        ...contracts,
        WASM_BRIDGE_MARKERS: {
          ...contracts.WASM_BRIDGE_MARKERS,
          findFiles: -80_002,
        },
      },
      root,
    ),
  );
  assert.equal(edited.api.wasmBridgeMarkers.findFiles, -80_002);
});

test("the launch argument prefix comes from the contracts too", () => {
  const prefix = "--renamed-by-this-test=";
  const source = preloadSource(
    { ...contracts, RENDERER_INIT_ARGUMENT: prefix },
    root,
  );

  // The old prefix is no longer recognised, so the flags default off — which is
  // the production posture, not a developer one.
  let api: GwNativeApi | undefined;
  const load = (argv: string[]) => {
    vm.runInNewContext(source, {
      console,
      process: { argv },
      require: () => ({
        contextBridge: {
          exposeInMainWorld(_name: string, value: GwNativeApi) {
            api = value;
          },
        },
        ipcRenderer: {
          invoke: () => Promise.resolve(),
          on() {},
          removeListener() {},
          send() {},
        },
      }),
    });
    return api!;
  };

  // `{ ...init }` because the object was constructed in the vm's realm, so it
  // does not share this one's Object.prototype.
  assert.deepEqual(
    plainInit(
      load([
        contracts.RENDERER_INIT_ARGUMENT +
          JSON.stringify({
            toolboxSelection: { nativeCursor: true, targetReadout: true },
          }),
      ]).init,
    ),
    {
      toolboxAutomation: false,
      toolboxSelection: { nativeCursor: false, targetReadout: false },
      templateFsTrace: false,
    },
  );
  assert.deepEqual(
    {
      ...load([
        prefix +
          JSON.stringify({
            toolboxSelection: { nativeCursor: true, targetReadout: true },
          }),
      ]).init.toolboxSelection,
    },
    { nativeCursor: true, targetReadout: true },
  );
});

test("every canonical Toolbox tool crosses without another field list", () => {
  const futureTool = "futureTool";
  const source = preloadSource(
    {
      ...contracts,
      TOOLBOX_TOOLS: [...contracts.TOOLBOX_TOOLS, futureTool],
    },
    root,
  );
  const { api } = run(source, [
    contracts.RENDERER_INIT_ARGUMENT +
      JSON.stringify({
        toolboxSelection: {
          nativeCursor: false,
          targetReadout: false,
          [futureTool]: true,
        },
      }),
  ]);
  assert.equal(
    (api.init.toolboxSelection as Record<string, boolean>)[futureTool],
    true,
  );
});

test("a contracts export the body needs but does not have fails the build", () => {
  assert.throws(
    () => preloadSource({ IPC: contracts.IPC }, root),
    /exports no RENDERER_INIT_ARGUMENT/,
  );
  assert.deepEqual(PRELOAD_CONSTANTS, [
    "IPC",
    "RENDERER_INIT_ARGUMENT",
    "TOOLBOX_TOOLS",
    "WASM_BRIDGE_MARKERS",
  ]);
});
