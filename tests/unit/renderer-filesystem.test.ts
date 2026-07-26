import assert from "node:assert/strict";
import test from "node:test";
import {
  installGameFilesystem,
  type EmscriptenModule,
} from "../../src/renderer/filesystem.js";

// The module is imported, not read and evaluated in a synthetic context. What
// it still reaches for ambiently is the Emscripten runtime's `FS`/`IDBFS`,
// which only exist once the glue has loaded, so the fixture supplies them on
// globalThis for the duration of the preRun it drives and takes them away
// again — no test may observe another's runtime.
type SyncCallback = (error?: unknown) => void;

function fixture(options: {
  mounted?: boolean;
  restoreError?: unknown;
  persistError?: unknown;
  syncNever?: boolean;
} = {}) {
  const calls: string[] = [];
  const failures: unknown[] = [];
  const fileSystem = {
    lookupPath(value: string) {
      calls.push(`lookup:${value}`);
      return {};
    },
    open(value: unknown) {
      calls.push(`open:${String(value)}`);
      return {};
    },
    rename(oldPath: string, newPath: string) {
      calls.push(`rename:${oldPath}:${newPath}`);
    },
    unlink(value: string) {
      calls.push(`unlink:${value}`);
    },
    mknod(value: string) {
      calls.push(`mknod:${value}`);
      return {};
    },
    analyzePath() {
      return { error: options.mounted ? 0 : 44 };
    },
    mkdir(value: string) {
      calls.push(`mkdir:${value}`);
    },
    mount(_type: unknown, mountOptions: { autoPersist: boolean }, value: string) {
      calls.push(`mount:${value}:${mountOptions.autoPersist}`);
    },
    syncfs(populate: boolean, callback: SyncCallback) {
      calls.push(`sync:${populate}`);
      if (options.syncNever) return;
      callback(populate ? options.restoreError : options.persistError);
    },
    mkdirTree(value: string) {
      calls.push(`mkdirTree:${value}`);
    },
    rmdir(value: string) {
      calls.push(`rmdir:${value}`);
    },
    symlink(oldPath: string, newPath: string) {
      calls.push(`symlink:${oldPath}:${newPath}`);
    },
    chdir(value: string) {
      calls.push(`chdir:${value}`);
    },
  };
  // Typed as the contract rather than inferred, because the fixture stands in
  // for the module Emscripten hands the renderer. That module arrives with no
  // preRun at all — installGameFilesystem is what puts one there — so a stand-in
  // that declares the property up front, holding undefined, is a shape the real
  // caller never passes and would hide an install that never assigned.
  const module: EmscriptenModule = {
    addRunDependency(value: string) {
      calls.push(`add:${value}`);
    },
    removeRunDependency(value: string) {
      calls.push(`remove:${value}`);
    },
  };
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  Object.assign(globalThis, { FS: fileSystem, IDBFS: {} });
  if (options.syncNever) {
    Object.assign(globalThis, {
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
      clearTimeout: () => undefined,
    });
  }
  try {
    installGameFilesystem({
      module,
      failed(error) {
        failures.push(error);
      },
      log() {
        calls.push("ready");
      },
    });
    // assert.ok is the assertion of the two that narrows, so the call below is
    // the one installGameFilesystem installed rather than an optional hook the
    // checker has to be told about.
    assert.ok(
      typeof module.preRun === "function",
      "installGameFilesystem must install a preRun hook",
    );
    module.preRun();
  } finally {
    Object.assign(globalThis, {
      setTimeout: realSetTimeout,
      clearTimeout: realClearTimeout,
    });
    Reflect.deleteProperty(globalThis, "FS");
    Reflect.deleteProperty(globalThis, "IDBFS");
  }
  return { calls, failures, fileSystem };
}

test("mounts, restores, prepares, and persists the game filesystem before main", () => {
  const result = fixture();
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.calls, [
    "add:gw-persistent-filesystem",
    "mkdir:app:",
    "mount:app::true",
    "sync:true",
    "mkdirTree:app:/Templates/Skills",
    "mkdirTree:app:/Templates/Equipment",
    "chdir:app:",
    "sync:false",
    "ready",
    "remove:gw-persistent-filesystem",
  ]);
});

test("reuses an existing mount while restoring every required invariant", () => {
  const result = fixture({ mounted: true });
  assert.deepEqual(result.failures, []);
  assert.equal(result.calls.some((call) => call.startsWith("mount:")), false);
  assert.equal(result.calls.some((call) => call.startsWith("mkdir:")), false);
  assert.ok(result.calls.includes("chdir:app:"));
  assert.ok(result.calls.includes("sync:false"));
});

test("normalizes Guild Wars desktop template paths at the filesystem boundary", () => {
  const result = fixture();
  result.calls.length = 0;
  result.fileSystem.lookupPath("\\Templates\\Skills\\Test.st");
  result.fileSystem.open("Templates\\Equipment\\Test.eq");
  result.fileSystem.rename(
    "Templates\\Skills\\Old.st",
    "Templates\\Skills\\New.st",
  );
  result.fileSystem.unlink("Templates\\Skills\\New.st");
  result.fileSystem.mknod("Templates\\Skills\\Created.st");
  result.fileSystem.mkdir("Templates\\Screenshots");
  result.fileSystem.mkdirTree("Templates\\Nested\\Path");
  result.fileSystem.rmdir("Templates\\Nested\\Path");
  result.fileSystem.symlink(
    "Templates\\Skills\\Created.st",
    "Templates\\Skills\\Linked.st",
  );
  assert.deepEqual(result.calls, [
    "lookup:Templates/Skills/Test.st",
    "open:Templates/Equipment/Test.eq",
    "rename:Templates/Skills/Old.st:Templates/Skills/New.st",
    "unlink:Templates/Skills/New.st",
    "mknod:Templates/Skills/Created.st",
    "mkdir:Templates/Screenshots",
    "mkdirTree:Templates/Nested/Path",
    "rmdir:Templates/Nested/Path",
    "symlink:Templates/Skills/Created.st:Templates/Skills/Linked.st",
  ]);
});

test("blocks game startup and reports an IndexedDB restore failure", () => {
  const error = new Error("restore failed");
  const result = fixture({ restoreError: error });
  assert.deepEqual(result.failures, [error]);
  assert.equal(result.calls.includes("sync:false"), false);
  assert.equal(
    result.calls.includes("remove:gw-persistent-filesystem"),
    false,
  );
});

test("blocks game startup when the directory invariant cannot be persisted", () => {
  const error = new Error("persist failed");
  const result = fixture({ persistError: error });
  assert.deepEqual(result.failures, [error]);
  assert.equal(
    result.calls.includes("remove:gw-persistent-filesystem"),
    false,
  );
});

test("blocks game startup when IndexedDB synchronization stalls", () => {
  const result = fixture({ syncNever: true });
  assert.equal(result.failures.length, 1);
  assert.match(String(result.failures[0]), /sync timed out/);
  assert.equal(
    result.calls.includes("remove:gw-persistent-filesystem"),
    false,
  );
});
