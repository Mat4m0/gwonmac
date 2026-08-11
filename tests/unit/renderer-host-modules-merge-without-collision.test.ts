// The installers are ESM exports rather than `window.gwInstall*` globals, and
// harness.ts's boot() merges the module namespaces into one `host` object
// it calls from `instantiateWasm` and `loadGlue`. A merge is silent about a
// collision: two modules exporting the same name would leave one installer
// unreachable, and the harness would install a graphics adapter or a
// filesystem mount that never runs. The intersection type on `host` does not
// catch that — an intersection keeps the name either way.
//
// This imports the real modules, so it also fails if one renames or drops the
// export the harness calls.
import assert from "node:assert/strict";
import test from "node:test";
import { WASM_BRIDGE_MARKERS } from "../../src/shared/contracts.ts";

// All but template-save compatibility import cleanly with no page at all;
// template-save-compatibility.js reads the bridge markers as it is imported,
// which is why boot() imports it after the preload rather than before.
Object.assign(globalThis, {
  window: {
    gwNative: {
      init: { templateFsTrace: false },
      wasmBridgeMarkers: WASM_BRIDGE_MARKERS,
    },
  },
});

const namespaces = await Promise.all([
  import("../../src/renderer/client-exit.js"),
  import("../../src/renderer/graphics.js"),
  import("../../src/renderer/gl-program-cache.js"),
  import("../../src/renderer/filesystem.js"),
  import("../../src/renderer/input.js"),
  import("../../src/renderer/template-save-compatibility.js"),
  import("../../src/renderer/template-filesystem-trace.js"),
]);

test("every host module exports exactly one installer", () => {
  for (const namespace of namespaces) {
    assert.deepEqual(
      Object.keys(namespace).filter((name) => name !== "default").length,
      1,
    );
  }
});

test("merging the host modules loses no installer", () => {
  const names = namespaces.flatMap((namespace) => Object.keys(namespace));
  assert.equal(new Set(names).size, names.length, "two modules share a name");

  const host = Object.assign({}, ...namespaces) as Record<string, unknown>;
  assert.deepEqual(Object.keys(host).sort(), [
    "installClientExit",
    "installGameFilesystem",
    "installGameInput",
    "installGlProgramCache",
    "installGraphics",
    "installTemplateFilesystemTrace",
    "installTemplateSaveCompatibility",
  ]);
  for (const name of Object.keys(host)) {
    assert.equal(typeof host[name], "function", name);
  }
});
