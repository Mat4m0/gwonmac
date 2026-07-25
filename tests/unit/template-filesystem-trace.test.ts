import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(
  path.join(root, "src/renderer/template-filesystem-trace.js"),
  "utf8",
);

function fixture(search = "?template-fs-trace=1", openResult = 17) {
  const memory = new ArrayBuffer(4096);
  const HEAPU8 = new Uint8Array(memory);
  const HEAPU32 = new Uint32Array(memory);
  const logs: string[] = [];
  const calls: string[] = [];
  const openat = (...args: number[]) => {
    void args;
    calls.push("openat");
    return openResult;
  };
  const fdWrite = (
    _fd: number,
    _iov: number,
    _iovcnt: number,
    pnum: number,
  ) => {
    calls.push("fd_write");
    HEAPU32[pnum >>> 2] = 37;
    return 0;
  };
  const fdClose = (...args: number[]) => {
    void args;
    calls.push("fd_close");
    return 0;
  };
  const imports = {
    env: { __syscall_openat: openat },
    wasi_snapshot_preview1: {
      fd_write: fdWrite,
      fd_close: fdClose,
    },
  };
  const window = {} as {
    gwInstallTemplateFilesystemTrace?: (options: {
      imports: typeof imports;
      module: { HEAPU8: Uint8Array; HEAPU32: Uint32Array };
    }) => void;
    gwTemplateFilesystemTrace?: () => ReadonlyArray<Record<string, unknown>>;
  };
  const context = {
    ArrayBuffer,
    Map,
    Number,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    URL,
    console: {
      info(...values: unknown[]) {
        logs.push(values.map(String).join(" "));
      },
    },
    location: { href: `gw://app/${search}` },
    window,
  };
  Object.assign(context, { globalThis: context });
  vm.runInNewContext(source, context);

  return {
    calls,
    HEAPU8,
    HEAPU32,
    imports,
    logs,
    module: { HEAPU8, HEAPU32 },
    openat,
    fdWrite,
    window,
  };
}

function writeCString(heap: Uint8Array, pointer: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  heap.set(encoded, pointer);
  heap[pointer + encoded.length] = 0;
}

test("is dormant unless the packaged-app trace query is explicitly enabled", () => {
  const value = fixture("");
  value.window.gwInstallTemplateFilesystemTrace?.({
    imports: value.imports,
    module: value.module,
  });
  assert.equal(value.imports.env.__syscall_openat, value.openat);
  assert.equal(value.imports.wasi_snapshot_preview1.fd_write, value.fdWrite);
  assert.equal(value.window.gwTemplateFilesystemTrace, undefined);
  assert.deepEqual(value.logs, []);
});

test("captures the real template open, write, and close result without a path", () => {
  const value = fixture();
  value.window.gwInstallTemplateFilesystemTrace?.({
    imports: value.imports,
    module: value.module,
  });

  const pathPointer = 64;
  const modePointer = 192;
  const iovPointer = 256;
  const writtenPointer = 320;
  writeCString(
    value.HEAPU8,
    pathPointer,
    "app:/Templates/Skills/Private Test.txt",
  );
  value.HEAPU32[modePointer >>> 2] = 0o666;
  value.HEAPU32[iovPointer >>> 2] = 512;
  value.HEAPU32[(iovPointer >>> 2) + 1] = 37;

  const fd = value.imports.env.__syscall_openat(
    -100,
    pathPointer,
    1 | 64 | 512,
    modePointer,
  );
  value.imports.wasi_snapshot_preview1.fd_write(
    fd,
    iovPointer,
    1,
    writtenPointer,
  );
  value.imports.wasi_snapshot_preview1.fd_close(fd);

  assert.deepEqual(value.calls, ["openat", "fd_write", "fd_close"]);
  assert.deepEqual(
    Array.from(
      value.window.gwTemplateFilesystemTrace?.() ?? [],
      (event) => event.operation,
    ),
    ["enabled", "openat", "fd_write", "fd_close"],
  );
  const open = value.window.gwTemplateFilesystemTrace?.()[1];
  assert.equal(open?.kind, "skills");
  assert.equal(open?.errno, 0);
  assert.equal(open?.create, true);
  assert.equal(open?.truncate, true);
  assert.equal(open?.separator, "slash");
  assert.equal(open?.txtSuffix, true);
  const write = value.window.gwTemplateFilesystemTrace?.()[2];
  assert.equal(write?.requested, 37);
  assert.equal(write?.written, 37);
  assert.equal(write?.errno, 0);

  const serialized = JSON.stringify({
    events: value.window.gwTemplateFilesystemTrace?.(),
    logs: value.logs,
  });
  assert.doesNotMatch(serialized, /Private Test|Templates\/Skills|app:/);
});

test("records an open errno and ignores unrelated filesystem traffic", () => {
  const value = fixture("?template-fs-trace=1", -44);
  value.window.gwInstallTemplateFilesystemTrace?.({
    imports: value.imports,
    module: value.module,
  });

  writeCString(value.HEAPU8, 64, "preferences.dat");
  value.imports.env.__syscall_openat(-100, 64, 0, 0);
  writeCString(value.HEAPU8, 64, String.raw`Templates\Equipment\Build.txt`);
  value.imports.env.__syscall_openat(-100, 64, 65, 192);

  const events = value.window.gwTemplateFilesystemTrace?.() ?? [];
  assert.equal(events.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(events[1])), {
    sequence: 2,
    operation: "openat",
    kind: "equipment",
    errno: 44,
    flags: 65,
    access: 1,
    create: true,
    exclusive: false,
    truncate: false,
    append: false,
    mode: 0,
    separator: "backslash",
    txtSuffix: true,
  });
});
