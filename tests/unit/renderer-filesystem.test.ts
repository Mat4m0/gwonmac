import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(
  path.join(root, "src/renderer/filesystem.js"),
  "utf8",
);

type SyncCallback = (error?: unknown) => void;

function fixture(options: {
  mounted?: boolean;
  restoreError?: unknown;
  persistError?: unknown;
} = {}) {
  const calls: string[] = [];
  const failures: unknown[] = [];
  const fileSystem = {
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
      callback(populate ? options.restoreError : options.persistError);
    },
    mkdirTree(value: string) {
      calls.push(`mkdirTree:${value}`);
    },
    chdir(value: string) {
      calls.push(`chdir:${value}`);
    },
  };
  const module = {
    preRun: undefined as undefined | (() => void),
    addRunDependency(value: string) {
      calls.push(`add:${value}`);
    },
    removeRunDependency(value: string) {
      calls.push(`remove:${value}`);
    },
  };
  const context = {
    FS: fileSystem,
    IDBFS: {},
    window: {} as {
      gwInstallGameFilesystem?: (options: {
        module: typeof module;
        failed(error: unknown): void;
        log(...values: unknown[]): void;
      }) => void;
    },
  };
  Object.assign(context, { globalThis: context });
  vm.runInNewContext(source, context);
  context.window.gwInstallGameFilesystem?.({
    module,
    failed(error) {
      failures.push(error);
    },
    log() {
      calls.push("ready");
    },
  });
  assert.equal(typeof module.preRun, "function");
  module.preRun();
  return { calls, failures };
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
