import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(
  path.join(root, "src/renderer/template-save-compatibility.js"),
  "utf8",
);

function fixture() {
  const memory = new ArrayBuffer(2048);
  const HEAPU8 = new Uint8Array(memory);
  const directories: string[] = [];
  const statCalls: number[][] = [];
  const imports = {
    env: {
      __syscall_stat64(...args: number[]) {
        statCalls.push(args);
        return 19;
      },
    },
  };
  const window = {} as {
    gwInstallTemplateSaveCompatibility?: (
      value: typeof imports,
      module: { HEAPU8: Uint8Array },
    ) => void;
  };
  const context = {
    ArrayBuffer,
    Set,
    String,
    Uint16Array,
    Uint8Array,
    window,
    FS: {
      mkdirTree(value: string) {
        directories.push(value);
      },
    },
  };
  Object.assign(context, { globalThis: context });
  vm.runInNewContext(source, context);
  window.gwInstallTemplateSaveCompatibility?.(imports, { HEAPU8 });
  return { directories, HEAPU8, imports, statCalls };
}

function writeWideString(heap: Uint8Array, pointer: number, value: string) {
  const wide = new Uint16Array(heap.buffer);
  const start = pointer >>> 1;
  for (let index = 0; index < value.length; index += 1) {
    wide[start + index] = value.charCodeAt(index);
  }
  wide[start + value.length] = 0;
}

test("passes ordinary stat calls through unchanged", () => {
  const value = fixture();
  assert.equal(value.imports.env.__syscall_stat64(40, 80), 19);
  assert.deepEqual(value.statCalls, [[40, 80]]);
  assert.deepEqual(value.directories, []);
});

test("creates only the marked Skills and Equipment directories", () => {
  const value = fixture();
  writeWideString(value.HEAPU8, 64, String.raw`Templates\Skills`);
  assert.equal(value.imports.env.__syscall_stat64(64, 1), 0);
  writeWideString(value.HEAPU8, 128, "app:/Templates/Equipment");
  assert.equal(value.imports.env.__syscall_stat64(128, 1), 0);
  assert.deepEqual(value.directories, [
    "Templates/Skills",
    "Templates/Equipment",
  ]);
  assert.deepEqual(value.statCalls, []);
});

test("rejects marked paths outside the two template directories", () => {
  const value = fixture();
  writeWideString(value.HEAPU8, 64, "../Templates/Skills");
  assert.notEqual(value.imports.env.__syscall_stat64(64, 1), 0);
  writeWideString(value.HEAPU8, 128, "Templates/Skills/Nested");
  assert.notEqual(value.imports.env.__syscall_stat64(128, 1), 0);
  assert.deepEqual(value.directories, []);
});
