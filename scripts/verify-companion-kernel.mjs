import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companionKernelRustcArgs } from "./build.mjs";
import {
  COMPANION_KERNEL_EXPORT_VALUES,
  validateCompanionKernelContract,
} from "./companion-kernel-contract.mjs";
import {
  COMPANION_KERNEL_ARTIFACT,
  COMPANION_RENDERER,
  companionKernelSha256,
  verifySealedCompanionRenderer,
} from "./seal-companion-kernel.mjs";

const artifact = COMPANION_KERNEL_ARTIFACT;
const source = readFileSync("src/companion-kernel/lib.rs", "utf8");

const panicStart = source.indexOf("fn panic(");
const panicEnd = source.indexOf("\n}", panicStart);
assert.notEqual(panicStart, -1, "kernel panic handler is missing");
assert.notEqual(panicEnd, -1, "kernel panic handler is malformed");
const panicSource = source.slice(panicStart, panicEnd + 2);
assert.match(
  panicSource,
  /wasm32::unreachable\(\)/u,
  "kernel panic handler must terminate as a bounded Wasm trap",
);
assert.doesNotMatch(
  panicSource,
  /loop\s*\{/u,
  "kernel panic handler must never spin on the game callback stack",
);

const bytes = readFileSync(artifact);
const module = validateCompanionKernelContract(bytes);
verifySealedCompanionRenderer(
  readFileSync(COMPANION_RENDERER, "utf8"),
  companionKernelSha256(bytes),
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
// From the contract module rather than written out here. This script needs a
// built artifact, so it is not part of `pnpm check` and nothing ran it — which
// is how it came to assert ABI 6 and a 196-byte config block for a kernel that
// had moved to 7 and 296. Numbers that only one uncalled script knows are
// numbers that go stale.
for (const [name, expected] of Object.entries(COMPANION_KERNEL_EXPORT_VALUES)) {
  assert.equal(exportedFunction(name)(), expected, name);
}
assert.equal(exportedFunction("companion_cursor_event_count")(), 0);
assert.equal(
  exportedFunction("companion_dispatch")(0xffff_ffff, 0, 0, 0, 0, 0),
  undefined,
  "companion dispatch must return void for the game table signature",
);
for (const kind of [0, 1, 2, 3, 0x7fff_ffff, 0xffff_ffff]) {
  assert.doesNotThrow(
    () => exportedFunction("companion_dispatch")(
      kind,
      0xffff_ffff,
      0x8000_0000,
      0x7fff_ffff,
      0xffff_ffff,
      0x8000_0000,
    ),
    `uninitialised dispatch kind ${kind} did not return safely`,
  );
}

const scratch = mkdtempSync(join(tmpdir(), "gw-companion-kernel-"));
try {
  const rebuilt = join(scratch, "companion-kernel.wasm");
  const result = spawnSync("rustc", companionKernelRustcArgs(rebuilt), {
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "kernel reproducibility compile failed");
  assert.deepEqual(readFileSync(rebuilt), bytes, "kernel build is not reproducible");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("verified companion kernel ABI and reproducible bytes");
