import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const artifact = "build/renderer/companion-kernel.wasm";
const expectedImports = [
  "env.__indirect_function_table:table",
  "env.__memory_base:global",
  "env.__stack_pointer:global",
  "env.__table_base:global",
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

/** @param {Uint8Array} binary */
function sectionIds(binary) {
  let offset = 8;
  const readUleb = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      assert.ok(offset < binary.byteLength, "truncated kernel section");
      const byte = binary[offset++]
        ?? assert.fail("truncated kernel section byte");
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      assert.ok(shift <= 35, "oversized kernel section length");
    }
  };
  const ids = [];
  while (offset < binary.byteLength) {
    const id = binary[offset++] ?? assert.fail("missing kernel section id");
    const size = readUleb();
    ids.push(id);
    offset += size;
    assert.ok(offset <= binary.byteLength, "kernel section exceeds binary");
  }
  return ids;
}
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
  "relocation-model=pic",
  "-C",
  "link-arg=--import-memory",
  "-C",
  "link-arg=--experimental-pic",
  "-C",
  "link-arg=--shared",
  "-C",
  "link-arg=--strip-all",
  "-o",
  output,
];

const bytes = readFileSync(artifact);
assert.equal(WebAssembly.validate(bytes), true, "kernel is invalid WebAssembly");
assert.equal(
  sectionIds(bytes).includes(8),
  false,
  "kernel must not run a start function against game memory",
);
const module = new WebAssembly.Module(bytes);
assert.deepEqual(
  WebAssembly.Module.customSections(module, "dylink.0").map((section) => [
    ...new Uint8Array(section),
  ]),
  [[0x01, 0x05, 0xa0, 0x02, 0x02, 0x00, 0x00]],
  "kernel must reserve exactly 288 aligned bytes and no table entries",
);
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

const memory = new WebAssembly.Memory({ initial: 256 });
const lowGameMemory = new Uint8Array(memory.buffer, 0x10_0000, 512);
lowGameMemory.fill(0xa5);
const beforeInstantiation = lowGameMemory.slice();
/** @param {number} value */
const immutableI32 = (value) => new WebAssembly.Global(
  { value: "i32", mutable: false },
  value,
);
const instance = new WebAssembly.Instance(module, {
  env: {
    memory,
    __indirect_function_table: new WebAssembly.Table({
      initial: 0,
      maximum: 0,
      element: "anyfunc",
    }),
    __memory_base: immutableI32(0x20_0000),
    __stack_pointer: new WebAssembly.Global(
      { value: "i32", mutable: true },
      0x21_0000,
    ),
    __table_base: immutableI32(0),
  },
  game: {
    enhancement_tick_original() {},
    enhancement_cursor_original() {},
    enhancement_ui_original() {},
  },
});
assert.deepEqual(
  lowGameMemory,
  beforeInstantiation,
  "kernel instantiation wrote through its old fixed game-memory addresses",
);
/** @param {string} name */
function exportedFunction(name) {
  const value = instance.exports[name];
  if (typeof value !== "function") throw new Error(`missing function ${name}`);
  return value;
}
assert.equal(exportedFunction("companion_abi")(), 4);
assert.equal(exportedFunction("companion_config_bytes")(), 160);
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
