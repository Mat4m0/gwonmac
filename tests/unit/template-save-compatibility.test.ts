import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { WASM_BRIDGE_MARKERS } from "../../src/shared/contracts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(
  path.join(root, "src/renderer/template-save-compatibility.js"),
  "utf8",
);

// The canonical values, not a fourth copy of them: this is what proves the
// numbers the transform writes into the module route to the right operation.
const {
  ensureDirectory: ENSURE_DIRECTORY,
  findFiles: FIND_FILES,
  fileBaseName: FILE_BASE_NAME,
  deleteFile: DELETE_FILE,
  fileExists: FILE_EXISTS,
} = WASM_BRIDGE_MARKERS;
const RECORD_BYTES = 544;
const WANT_FILES = 17;
const WANT_DIRECTORIES = 18;
const RECORD_NAME_OFFSET = 24;

type Bridge = (
  dirfd: number,
  path: number,
  buffer: number,
  flags: number,
) => number;

function fixture(tree: Record<string, string[]> = {}, templateFsTrace = false) {
  const memory = new ArrayBuffer(65536);
  const HEAPU8 = new Uint8Array(memory);
  const made: string[] = [];
  const removed: string[] = [];
  const carrierCalls: number[][] = [];
  let next = 0x4000;
  const imports = {
    env: {
      __syscall_newfstatat(...args: number[]) {
        carrierCalls.push(args);
        return 19;
      },
    },
  };
  const FS = {
    readdir(directory: string) {
      const entries = tree[directory];
      if (!entries) throw new Error(`ENOENT ${directory}`);
      return [".", "..", ...entries];
    },
    stat(value: string) {
      if (value.endsWith("/broken")) return { mode: 0 };
      return { mode: value.endsWith("/sub") ? 2 : 1 };
    },
    isFile(mode: number) {
      if (mode === 0) throw new Error("unreadable");
      return mode === 1;
    },
    isDir(mode: number) {
      if (mode === 0) throw new Error("unreadable");
      return mode === 2;
    },
    mkdirTree(value: string) {
      made.push(value);
    },
    analyzePath(value: string) {
      const cut = value.lastIndexOf("/");
      return { exists: (tree[value.slice(0, cut)] ?? []).includes(value.slice(cut + 1)) };
    },
    unlink(value: string) {
      if (value.includes("missing")) throw new Error("ENOENT");
      removed.push(value);
    },
  };
  const window = {
    gwNative: { init: { templateFsTrace }, wasmBridgeMarkers: WASM_BRIDGE_MARKERS },
  } as {
    gwNative: {
      init: { templateFsTrace: boolean };
      wasmBridgeMarkers: typeof WASM_BRIDGE_MARKERS;
    };
    gwInstallTemplateSaveCompatibility?: (options: {
      imports: typeof imports;
      module: { HEAPU8: Uint8Array };
      exports: () => { malloc(bytes: number): number };
    }) => void;
  };
  const logs: string[] = [];
  const context = {
    ArrayBuffer,
    Math,
    RegExp,
    String,
    Uint16Array,
    Uint32Array,
    Uint8Array,
    console: {
      info(...values: unknown[]) {
        logs.push(values.map(String).join(" "));
      },
    },
    setTimeout,
    window,
    FS,
  };
  Object.assign(context, { globalThis: context });
  vm.runInNewContext(source, context);
  window.gwInstallTemplateSaveCompatibility?.({
    imports,
    module: { HEAPU8 },
    exports: () => ({
      malloc(bytes: number) {
        const pointer = next;
        next += bytes + 8;
        return pointer;
      },
    }),
  });
  return {
    bridge: imports.env.__syscall_newfstatat as unknown as Bridge,
    carrierCalls,
    HEAPU8,
    logs,
    made,
    removed,
  };
}

function writeWide(heap: Uint8Array, pointer: number, value: string) {
  const wide = new Uint16Array(heap.buffer);
  const start = pointer >>> 1;
  for (let index = 0; index < value.length; index += 1) {
    wide[start + index] = value.charCodeAt(index);
  }
  wide[start + value.length] = 0;
}

function readWide(heap: Uint8Array, pointer: number) {
  const wide = new Uint16Array(heap.buffer);
  let index = pointer >>> 1;
  let value = "";
  while (wide[index]) {
    value += String.fromCharCode(wide[index]!);
    index += 1;
  }
  return value;
}

test("passes ordinary stat calls through untouched", () => {
  const value = fixture();
  assert.equal(value.bridge(-100, 64, 128, 0), 19);
  assert.deepEqual(value.carrierCalls, [[-100, 64, 128, 0]]);
  assert.deepEqual(value.made, []);
});

// `_wsplitpath` keeps the separator that terminates the directory component
// and `_wmakepath` puts it back, so this is the shape the client passes.
test("creates the directory the client asks for, separator and all", () => {
  const value = fixture();
  writeWide(value.HEAPU8, 64, "Templates/Skills/");
  assert.equal(value.bridge(ENSURE_DIRECTORY, 64, 0, 1), 0);
  writeWide(value.HEAPU8, 256, "app:/Templates\\Equipment\\");
  assert.equal(value.bridge(ENSURE_DIRECTORY, 256, 0, 1), 0);
  writeWide(value.HEAPU8, 512, "Screens/");
  assert.equal(value.bridge(ENSURE_DIRECTORY, 512, 0, 1), 0);
  assert.deepEqual(value.made, [
    "Templates/Skills",
    "Templates/Equipment",
    "Screens",
  ]);
  assert.deepEqual(value.carrierCalls, []);
});

test("refuses to leave the mount", () => {
  const value = fixture();
  for (const escape of ["../Templates", "Templates/../../etc", ""]) {
    writeWide(value.HEAPU8, 64, escape);
    assert.notEqual(value.bridge(ENSURE_DIRECTORY, 64, 0, 1), 0);
  }
  assert.deepEqual(value.made, []);
});

// A run of separators is redundant, not a traversal. The client produces one on
// every file operation against a listed template, so rejecting it broke delete
// and, with it, the second half of rename.
test("collapses the client's doubled separator instead of rejecting it", () => {
  const value = fixture();
  writeWide(value.HEAPU8, 64, "Templates/Skills/\\");
  assert.equal(value.bridge(ENSURE_DIRECTORY, 64, 0, 1), 0);
  assert.deepEqual(value.made, ["Templates/Skills"]);

  writeWide(value.HEAPU8, 64, "Templates/Skills/\\Sub\\Deep.txt");
  assert.equal(value.bridge(DELETE_FILE, 64, 0, 0), 1);
  assert.deepEqual(value.removed, ["Templates/Skills/Sub/Deep.txt"]);
});

test("lists the files a wildcard matches, sorted, and hands over a block", () => {
  const value = fixture({
    "Templates/Skills": ["Zealot.txt", "Test.txt", "notes.md"],
  });
  writeWide(value.HEAPU8, 64, "Templates/Skills/*.txt");
  const out = 1024;
  assert.equal(value.bridge(FIND_FILES, 64, out, WANT_FILES), 0);

  const words = new Uint32Array(value.HEAPU8.buffer);
  const entries = words[out >>> 2]!;
  assert.equal(words[(out >>> 2) + 2], 2);
  assert.ok(entries > 0);
  // `notes.md` is excluded by the pattern; the client asks for `*.txt`.
  assert.deepEqual(
    [0, 1].map((index) =>
      readWide(
        value.HEAPU8,
        entries + index * RECORD_BYTES + RECORD_NAME_OFFSET,
      ),
    ),
    ["Test.txt", "Zealot.txt"],
  );
  // The 24-byte header the client strides over is left zeroed.
  assert.deepEqual(
    Array.from(value.HEAPU8.slice(entries, entries + RECORD_NAME_OFFSET)),
    Array.from<number>({ length: RECORD_NAME_OFFSET }).fill(0),
  );
});

test("honours the wildcard instead of listing the whole directory", () => {
  const value = fixture({
    "Templates/Skills": ["gw000.jpg", "gw001.jpg", "readme.txt"],
  });
  writeWide(value.HEAPU8, 64, "Templates/Skills/gw???.jpg");
  const out = 1024;
  value.bridge(FIND_FILES, 64, out, WANT_FILES);
  const words = new Uint32Array(value.HEAPU8.buffer);
  assert.equal(words[(out >>> 2) + 2], 2);
});

test("leaves the list empty for a missing or unreadable directory", () => {
  const value = fixture({ "Templates/Skills": ["broken"] });
  const words = () => new Uint32Array(value.HEAPU8.buffer);

  writeWide(value.HEAPU8, 64, "Templates/Equipment/*");
  assert.equal(value.bridge(FIND_FILES, 64, 1024, WANT_FILES), 0);
  assert.equal(words()[1024 >>> 2], 0);
  assert.equal(words()[(1024 >>> 2) + 2], 0);

  // An entry the mount cannot describe is skipped, not fatal to the listing.
  writeWide(value.HEAPU8, 64, "Templates/Skills/*");
  assert.equal(value.bridge(FIND_FILES, 64, 2048, WANT_FILES), 0);
  assert.equal(words()[(2048 >>> 2) + 2], 0);
});

test("stays silent unless the trace is explicitly requested", () => {
  const quiet = fixture({ "Templates/Skills": ["Test.txt"] });
  writeWide(quiet.HEAPU8, 64, "Templates/Skills/*.txt");
  quiet.bridge(FIND_FILES, 64, 1024, WANT_FILES);
  assert.deepEqual(quiet.logs, []);

  const traced = fixture({ "Templates/Skills": ["Test.txt"] }, true);
  writeWide(traced.HEAPU8, 64, "Templates/Skills/*.txt");
  traced.bridge(FIND_FILES, 64, 1024, WANT_FILES);
  assert.match(traced.logs[0]!, /"operation":"installed"/);
  assert.match(traced.logs[1]!, /"listed":3,"matched":1,"published":true/);
  // Counts and outcomes only: no filename, path, or content.
  assert.doesNotMatch(traced.logs.join(" "), /Test|Templates|Skills/);
});

// The client keys a template on its path below the type directory, in Windows
// form with a leading separator, and its list filter matches that prefix. A
// bare name is registered but never listed.
test("hands back the client's internal template path", () => {
  const value = fixture();
  writeWide(value.HEAPU8, 64, "Test.txt");
  assert.equal(value.bridge(FILE_BASE_NAME, 64, 256, 260), 1);
  assert.equal(readWide(value.HEAPU8, 256), String.raw`\Test`);

  writeWide(value.HEAPU8, 64, "Sub/Nested.txt");
  assert.equal(value.bridge(FILE_BASE_NAME, 64, 256, 260), 1);
  assert.equal(readWide(value.HEAPU8, 256), String.raw`\Sub\Nested`);

  writeWide(value.HEAPU8, 64, "noextension");
  assert.equal(value.bridge(FILE_BASE_NAME, 64, 256, 260), 1);
  assert.equal(readWide(value.HEAPU8, 256), String.raw`\noextension`);
});

// `Path::RemoveExtension` in this build drops the last character of the name
// along with the extension, so the name must reach it already bare.
test("keeps the last character the client's own trimmer would eat", () => {
  const value = fixture();
  for (const [file, expected] of [
    ["Two.Dots.txt", String.raw`\Two.Dots`],
    ["Sub/.hidden", String.raw`\Sub\.hidden`],
    ["trailing.", String.raw`\trailing`],
  ] as const) {
    writeWide(value.HEAPU8, 64, file);
    assert.equal(value.bridge(FILE_BASE_NAME, 64, 256, 260), 1);
    assert.equal(readWide(value.HEAPU8, 256), expected);
  }
});

test("truncates a display name to the destination the client offered", () => {
  const value = fixture();
  writeWide(value.HEAPU8, 64, "AbcdefghijName.txt");
  assert.equal(value.bridge(FILE_BASE_NAME, 64, 256, 5), 1);
  // Four characters plus the terminator, the separator among them.
  assert.equal(readWide(value.HEAPU8, 256), String.raw`\Abc`);
});

// The two template scans differ only in this flag: `*.txt` is asked for with
// files and `*` with directories. Answering both with files fills the
// subdirectory list with phantom folders named after the templates.
test("separates the file and directory requests by flag", () => {
  const tree = { "Templates/Skills": ["Test.txt", "sub"] };
  const count = (flags: number) => {
    const value = fixture(tree);
    writeWide(value.HEAPU8, 64, "Templates/Skills/*");
    value.bridge(FIND_FILES, 64, 1024, flags);
    const words = new Uint32Array(value.HEAPU8.buffer);
    const entries = words[1024 >>> 2]!;
    return {
      total: words[(1024 >>> 2) + 2],
      first: entries
        ? readWide(value.HEAPU8, entries + RECORD_NAME_OFFSET)
        : null,
    };
  };
  assert.deepEqual(count(WANT_FILES), { total: 1, first: "Test.txt" });
  assert.deepEqual(count(WANT_DIRECTORIES), { total: 1, first: "sub" });
});

// The client's own delete is `assert("not implemented")` + `unreachable`, and
// its caller reads a non-zero result as success.
test("deletes a template and reports the outcome the caller expects", () => {
  const value = fixture();
  // The shape the client actually builds: its type directory joined with `/`
  // onto a record name that already starts with `\`.
  writeWide(value.HEAPU8, 64, "Templates/Skills/\\Test.txt");
  assert.equal(value.bridge(DELETE_FILE, 64, 0, 0), 1);
  assert.deepEqual(value.removed, ["Templates/Skills/Test.txt"]);

  writeWide(value.HEAPU8, 64, "Templates/Skills/missing.txt");
  assert.equal(value.bridge(DELETE_FILE, 64, 0, 0), 0);

  writeWide(value.HEAPU8, 64, "../escape.txt");
  assert.equal(value.bridge(DELETE_FILE, 64, 0, 0), 0);
  assert.deepEqual(value.removed, ["Templates/Skills/Test.txt"]);
});

// `File::Open` mode 1 opens O_RDWR|O_CREAT in this build, so the client's own
// "is this name taken?" probe creates the file it is testing for and refuses
// every rename. The host answers without touching the file.
test("answers whether a file exists without creating it", () => {
  const value = fixture({ "Templates/Skills": ["Taken.txt"] });
  writeWide(value.HEAPU8, 64, "Templates/Skills/\\Taken.txt");
  assert.equal(value.bridge(FILE_EXISTS, 64, 0, 0), 1);

  writeWide(value.HEAPU8, 64, "Templates/Skills/\\Fresh.txt");
  assert.equal(value.bridge(FILE_EXISTS, 64, 0, 0), 0);

  // An undecidable path refuses the rename rather than overwriting a template.
  writeWide(value.HEAPU8, 64, "../escape.txt");
  assert.equal(value.bridge(FILE_EXISTS, 64, 0, 0), 1);

  assert.deepEqual(value.removed, []);
  assert.deepEqual(value.made, []);
});

// Every path shape the client is known to emit, from
// internal/upstream/client-internals.md. Four of the ten rounds it took to fix
// issue #5 were the same mistake: a fixture that used a cleaner input than the
// client actually produces. `_wsplitpath` keeps the separator that ends a
// directory, `_wmakepath` joins with `/`, and record names already start with
// `\` — so a doubled separator reaches every file operation on a listed
// template.
const CLIENT_PATH_SHAPES = [
  { emitted: "Templates/Skills/", resolves: "Templates/Skills", why: "directory, trailing separator kept by _wsplitpath" },
  { emitted: "Templates\\Equipment\\", resolves: "Templates/Equipment", why: "same, Windows separators" },
  { emitted: "app:/Templates/Skills/", resolves: "Templates/Skills", why: "mount prefix" },
  { emitted: "Screens/", resolves: "Screens", why: "screenshot directory" },
  { emitted: "Templates/Skills/*", resolves: "Templates/Skills/*", why: "directory enumeration pattern" },
  { emitted: "Templates/Skills/*.txt", resolves: "Templates/Skills/*.txt", why: "file enumeration pattern" },
  { emitted: "Templates/Skills/\\Test.txt", resolves: "Templates/Skills/Test.txt", why: "type directory joined onto a record name that already starts with a separator" },
  { emitted: "Templates/Skills/\\Sub\\Nested.txt", resolves: "Templates/Skills/Sub/Nested.txt", why: "the same, one subdirectory down" },
] as const;

test("accepts every path shape the client actually emits", () => {
  const value = fixture();
  for (const shape of CLIENT_PATH_SHAPES) {
    writeWide(value.HEAPU8, 64, shape.emitted);
    assert.equal(
      value.bridge(ENSURE_DIRECTORY, 64, 0, 1),
      0,
      `rejected ${JSON.stringify(shape.emitted)} — ${shape.why}`,
    );
  }
  assert.deepEqual(
    value.made,
    CLIENT_PATH_SHAPES.map((shape) => shape.resolves),
  );
});
