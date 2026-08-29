import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  LauncherStateStore,
  classifyLauncherInstallation,
  loadOrCreateLauncherState,
} from "../../src/main/core/launcher-state.ts";
import { parseProfileId } from "../../src/shared/multiple-accounts.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gw-launcher-state-"));
  roots.push(root);
  return join(root, "launcher-state.json");
}

describe("launcher presentation state", () => {
  it("classifies every supported starting state before account bootstrap", () => {
    assert.equal(classifyLauncherInstallation({ legacySingleData: false, existingWorkspace: false }), "fresh");
    assert.equal(classifyLauncherInstallation({ legacySingleData: true, existingWorkspace: false }), "migrated-single");
    assert.equal(classifyLauncherInstallation({ legacySingleData: false, existingWorkspace: true }), "migrated-multi");
    assert.equal(classifyLauncherInstallation({ legacySingleData: true, existingWorkspace: true }), "mixed");
  });

  it("creates fresh setup state once and reloads it idempotently", async () => {
    const path = await fixture();
    const first = await loadOrCreateLauncherState(path, "fresh");
    const second = await loadOrCreateLauncherState(path, "migrated-single");
    assert.equal(first.document.installationKind, "fresh");
    assert.equal(first.document.setupVersion, 0);
    assert.deepEqual(second.document, first.document);
  });

  it("skips forced setup and preserves corrupt bytes when classification is uncertain", async () => {
    const path = await fixture();
    await writeFile(path, "not json");
    const loaded = await loadOrCreateLauncherState(path, "fresh");
    assert.equal(loaded.recoveredFromCorruption, true);
    assert.equal(loaded.document.installationKind, "migrated-single");
    assert.equal(loaded.document.setupVersion, 1);
    const names = await readdir(join(path, ".."));
    const backup = names.find((name) => name.startsWith("launcher-state.json.corrupt-"));
    assert.ok(backup);
    assert.equal(await readFile(join(path, "..", backup), "utf8"), "not json");
  });

  it("normalizes remembered selection and Home order atomically", async () => {
    const path = await fixture();
    const loaded = await loadOrCreateLauncherState(path, "migrated-multi");
    const store = new LauncherStateStore(path, loaded.document, false);
    const id = parseProfileId("ba46cb0e-55c2-4c05-9808-5c35ce83b0b0");
    await store.setSelection([id, id]);
    await store.updatePreferences({ content: { news: false, first: "news" } });
    assert.deepEqual(store.get().selectedProfileIds, [id]);
    assert.equal(store.get().preferences.content.first, "dailies");
  });
});
