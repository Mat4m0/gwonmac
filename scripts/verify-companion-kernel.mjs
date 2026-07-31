import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const artifact = "build/renderer/companion-kernel.wasm";
const expectedImports = [
  "env.memory:memory",
  "game.enhancement_cursor_original:function",
  "game.enhancement_tick_original:function",
  "game.enhancement_ui_original:function",
];
const expectedFunctions = [
  "companion_abi",
  "companion_config_bytes",
  "companion_cursor_bytes",
  "companion_cursor_event_count",
  "companion_dispatch",
  "companion_init",
  "companion_set_first_hero_panel",
  "companion_snapshot_bytes",
  "companion_toolbox_bytes",
];
/** @param {string} output */
const rustcArgs = (output) => [
  "src/companion-kernel/lib.rs",
  "--edition=2021",
  "--target",
  "wasm32-unknown-unknown",
  "--crate-type",
  "cdylib",
  "-C",
  "opt-level=s",
  "-C",
  "panic=abort",
  "-C",
  "link-arg=--import-memory",
  "-C",
  "link-arg=--strip-all",
  "-o",
  output,
];

const bytes = readFileSync(artifact);
assert.equal(WebAssembly.validate(bytes), true, "kernel is invalid WebAssembly");
const module = new WebAssembly.Module(bytes);
assert.deepEqual(
  WebAssembly.Module.imports(module)
    .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`)
    .sort(),
  expectedImports,
);
const exports = WebAssembly.Module.exports(module);
assert.deepEqual(
  exports.filter((entry) => entry.kind === "function").map((entry) => entry.name).sort(),
  expectedFunctions,
);
assert.equal(
  exports.some((entry) => entry.kind === "memory" || entry.kind === "table"),
  false,
  "kernel must not export memory or a table",
);

const instance = new WebAssembly.Instance(module, {
  env: { memory: new WebAssembly.Memory({ initial: 256 }) },
  game: {
    enhancement_tick_original() {},
    enhancement_cursor_original() {},
    enhancement_ui_original() {},
  },
});
/** @param {string} name */
function exportedFunction(name) {
  const value = instance.exports[name];
  if (typeof value !== "function") throw new Error(`missing function ${name}`);
  return value;
}
assert.equal(exportedFunction("companion_abi")(), 2);
assert.equal(exportedFunction("companion_config_bytes")(), 156);
assert.equal(exportedFunction("companion_snapshot_bytes")(), 64);
assert.equal(exportedFunction("companion_cursor_bytes")(), 4_160);
assert.equal(exportedFunction("companion_toolbox_bytes")(), 64);
assert.equal(exportedFunction("companion_init").length, 9);
assert.equal(exportedFunction("companion_dispatch").length, 6);

const scratch = mkdtempSync(join(tmpdir(), "gw-companion-kernel-"));
try {
  const rebuilt = join(scratch, "companion-kernel.wasm");
  const result = spawnSync("rustc", rustcArgs(rebuilt), { stdio: "inherit" });
  assert.equal(result.status, 0, "kernel reproducibility compile failed");
  assert.deepEqual(readFileSync(rebuilt), bytes, "kernel build is not reproducible");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("verified companion kernel ABI and reproducible bytes");
