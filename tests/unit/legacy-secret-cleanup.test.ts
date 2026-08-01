import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { cleanupLegacySecretFiles } from "../../src/main/core/legacy-secret-cleanup.js";

describe("legacy secret cleanup", () => {
  it("removes only the two retired files and is idempotent", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gw-legacy-secrets-"));
    try {
      const preserved = new Map([
        ["settings.json", "settings"],
        ["window-state.json", "window"],
        ["unrelated.bin", "sibling"],
        ["game/chunks/hash", "chunk"],
        ["game/artifacts/manifest.json", "artifact"],
        ["game/compatibility/proof", "compatibility"],
        ["game/enhancements/cache", "enhancement"],
        ["diagnostics/session.jsonl", "diagnostics"],
        ["Partitions/default/IndexedDB/gw-app/000003.log", "idbfs"],
      ]);
      for (const [name, contents] of preserved) {
        const target = path.join(profile, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }
      await writeFile(path.join(profile, "credentials.bin"), "old credentials");
      await writeFile(path.join(profile, "steam-session.bin"), "old steam");

      const calls: Array<[string, { force: true }]> = [];
      const remove = async (target: string, options: { force: true }) => {
        calls.push([target, options]);
        await rm(target, options);
      };
      assert.deepEqual(await cleanupLegacySecretFiles(profile, remove), []);
      assert.deepEqual(await cleanupLegacySecretFiles(profile, remove), []);

      assert.deepEqual(calls, [
        [path.join(profile, "credentials.bin"), { force: true }],
        [path.join(profile, "steam-session.bin"), { force: true }],
        [path.join(profile, "credentials.bin"), { force: true }],
        [path.join(profile, "steam-session.bin"), { force: true }],
      ]);
      for (const [name, contents] of preserved) {
        assert.equal(await readFile(path.join(profile, name), "utf8"), contents);
      }
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  });

  it("unlinks a retired-name symlink without touching its target", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gw-legacy-symlink-"));
    const target = path.join(profile, "preserved");
    const link = path.join(profile, "credentials.bin");
    try {
      await writeFile(target, "keep");
      await symlink(target, link);
      assert.deepEqual(await cleanupLegacySecretFiles(profile, rm), []);
      await assert.rejects(lstat(link));
      assert.equal(await readFile(target, "utf8"), "keep");
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  });

  it("does not recursively remove a directory with a retired filename", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gw-legacy-directory-"));
    const directory = path.join(profile, "credentials.bin");
    try {
      await mkdir(directory);
      await writeFile(path.join(directory, "preserved"), "keep");
      const failures = await cleanupLegacySecretFiles(profile, rm);
      assert.equal(failures.length, 1);
      assert.equal(await readFile(path.join(directory, "preserved"), "utf8"), "keep");
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  });

  it("attempts both exact files and returns bounded failures", async () => {
    const calls: string[] = [];
    const failures = await cleanupLegacySecretFiles("/profile", async (target) => {
      calls.push(target);
      throw new Error("injected");
    });
    assert.deepEqual(calls, [
      "/profile/credentials.bin",
      "/profile/steam-session.bin",
    ]);
    assert.equal(failures.length, 2);
  });
});
