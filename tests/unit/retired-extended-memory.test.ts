import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discardRetiredExtendedMemoryCache,
  retireExtendedMemorySetting,
} from "../../src/main/core/retired-extended-memory.js";

async function profile(document: unknown): Promise<{
  root: string;
  settingsPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "gw-retire-memory-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify(document));
  return { root, settingsPath };
}

describe("retired extended-memory profile", () => {
  it("removes a true opt-in once and preserves every other raw field", async () => {
    const fixture = await profile({
      formatVersion: 1,
      extendedMemoryEnabled: true,
      showDiagnostics: true,
      unknownFutureField: { value: 7 },
    });

    assert.deepEqual(await retireExtendedMemorySetting(fixture.settingsPath), {
      wasEnabled: true,
      persistenceError: null,
    });
    assert.deepEqual(JSON.parse(await readFile(fixture.settingsPath, "utf8")), {
      formatVersion: 1,
      showDiagnostics: true,
      unknownFutureField: { value: 7 },
    });
    assert.deepEqual(await retireExtendedMemorySetting(fixture.settingsPath), {
      wasEnabled: false,
      persistenceError: null,
    });
  });

  it("silently retires false and leaves an absent key untouched", async () => {
    const disabled = await profile({
      formatVersion: 1,
      extendedMemoryEnabled: false,
      renderScale: 1.5,
    });
    assert.deepEqual(await retireExtendedMemorySetting(disabled.settingsPath), {
      wasEnabled: false,
      persistenceError: null,
    });
    assert.deepEqual(JSON.parse(await readFile(disabled.settingsPath, "utf8")), {
      formatVersion: 1,
      renderScale: 1.5,
    });

    const absent = await profile({ formatVersion: 1, renderScale: 2 });
    const before = await readFile(absent.settingsPath);
    assert.deepEqual(await retireExtendedMemorySetting(absent.settingsPath), {
      wasEnabled: false,
      persistenceError: null,
    });
    assert.deepEqual(await readFile(absent.settingsPath), before);
  });

  it("leaves malformed settings to the existing corruption recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-retire-memory-"));
    const settingsPath = join(root, "settings.json");
    await writeFile(settingsPath, "{broken");
    assert.deepEqual(await retireExtendedMemorySetting(settingsPath), {
      wasEnabled: false,
      persistenceError: null,
    });
    assert.equal(await readFile(settingsPath, "utf8"), "{broken");
  });

  it("reports an atomic-write failure without making the old opt-in executable", async () => {
    const fixture = await profile({
      formatVersion: 1,
      extendedMemoryEnabled: true,
    });
    const failure = new Error("disk full");
    const result = await retireExtendedMemorySetting(
      fixture.settingsPath,
      async () => { throw failure; },
    );
    assert.equal(result.wasEnabled, true);
    assert.equal(result.persistenceError, failure);
    assert.equal(
      JSON.parse(await readFile(fixture.settingsPath, "utf8")).extendedMemoryEnabled,
      true,
    );
  });

  it("deletes only the exact derived cache directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gw-retire-memory-cache-"));
    const retired = join(root, "extended-memory");
    const sibling = join(root, "enhancements");
    await mkdir(retired);
    await mkdir(sibling);
    await writeFile(join(retired, "derived.wasm"), "retired");
    await writeFile(join(sibling, "derived.wasm"), "preserved");

    assert.equal(await discardRetiredExtendedMemoryCache(root), null);
    await assert.rejects(stat(retired), { code: "ENOENT" });
    assert.equal(await readFile(join(sibling, "derived.wasm"), "utf8"), "preserved");
  });
});
