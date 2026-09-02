// This invariant is executed rather than asserted about. The preload's channel
// constants used to be a hand-maintained copy of `IPC`; a release test policed the copy by
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
import * as enhancementContracts from "../../src/shared/enhancement-contracts.ts";
import type { GwNativeApi } from "../../src/shared/contracts.ts";
import {
  PRELOAD_CONSTANTS,
  launcherPreloadSource,
  preloadSource,
} from "../../scripts/generate-preload.js";
import type { LauncherNativeApi } from "../../src/shared/launcher-contracts.ts";
import { LAUNCHER_IPC } from "../../src/shared/launcher-contracts.ts";

const allContracts = { ...contracts, ...enhancementContracts };

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
  enhancementSelection: { ...value.enhancementSelection },
});

test("the exposed method invokes the channel the contracts name", async () => {
  const { api, invoked, listened } = run(preloadSource(allContracts, root));
  await api.credentials.load();
  await api.credentials.save({ username: "u", password: "p" });
  api.sockets.onEvent(() => {});
  assert.deepEqual(invoked, [
    { channel: contracts.IPC.credentialsLoad, args: [] },
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
    ...allContracts,
    IPC: { ...contracts.IPC, credentialsLoad: "gw:credentials:renamedByThisTest" },
  };
  const { api, invoked } = run(preloadSource(renamed, root));
  await api.credentials.load();
  assert.deepEqual(invoked, [
    { channel: "gw:credentials:renamedByThisTest", args: [] },
  ]);
});

test("the derived client's bridge markers cross unchanged, and follow an edit", () => {
  const { api } = run(preloadSource(allContracts, root));
  assert.deepEqual(
    { ...api.wasmBridgeMarkers },
    { ...contracts.WASM_BRIDGE_MARKERS },
  );

  // Editing the canonical value moves the renderer's copy with it. The main
  // half is held by `tsc`: template-save-compat.ts imports the same object.
  const edited = run(
    preloadSource(
      {
        ...allContracts,
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
    { ...allContracts, RENDERER_INIT_ARGUMENT: prefix },
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
            enhancementSelection: { nativeCursor: true, targetReadout: true },
          }),
      ]).init,
    ),
    {
      development: false,
      enhancementProgram: "none",
      enhancementSelection: { nativeCursor: false, tools: false },
      diagnosticProfile: "standard",
      templateFsTrace: false,
    },
  );
  assert.deepEqual(
    {
      ...load([
        prefix +
          JSON.stringify({
            enhancementSelection: { nativeCursor: true, targetReadout: true },
          }),
      ]).init.enhancementSelection,
    },
    { nativeCursor: true, tools: false },
  );
});

test("every canonical Enhancement tool crosses without another field list", () => {
  const futureTool = "futureTool";
  const source = preloadSource(
    {
      ...contracts,
      ...enhancementContracts,
      ENHANCEMENTS: [...enhancementContracts.ENHANCEMENTS, futureTool],
    },
    root,
  );
  const { api } = run(source, [
    contracts.RENDERER_INIT_ARGUMENT +
      JSON.stringify({
        enhancementSelection: {
          nativeCursor: false,
          [futureTool]: true,
        },
      }),
  ]);
  assert.equal(
    (api.init.enhancementSelection as Record<string, boolean>)[futureTool],
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
    "ENHANCEMENTS",
    "ENHANCEMENT_PROGRAMS",
    "DIAGNOSTIC_PROFILES",
    "WASM_BRIDGE_MARKERS",
  ]);
});

test("the launcher preload exposes only its frozen launcher bridge", async () => {
  const invoked: string[] = [];
  let exposedName = "";
  let launcher: LauncherNativeApi | undefined;
  vm.runInNewContext(launcherPreloadSource(root), {
    require(name: string) {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name: string, value: LauncherNativeApi) {
            exposedName = name;
            launcher = value;
          },
        },
        ipcRenderer: {
          invoke(channel: string) {
            invoked.push(channel);
            return Promise.resolve();
          },
          on() {},
          removeListener() {},
        },
      };
    },
  });
  assert.equal(exposedName, "launcherNative");
  assert.ok(launcher);
  assert.deepEqual(Object.keys(launcher).sort(), [
    "experience",
    "external",
    "gameFiles",
    "navigation",
    "profiles",
    "settings",
    "state",
    "tools",
    "updates",
  ]);
  assert.equal(Object.isFrozen(launcher), true);
  assert.equal(Object.values(launcher).every(Object.isFrozen), true);
  await launcher.state.get();
  await launcher.profiles.play([]);
  assert.deepEqual(invoked, [LAUNCHER_IPC.stateGet, LAUNCHER_IPC.profilesPlay]);
});
