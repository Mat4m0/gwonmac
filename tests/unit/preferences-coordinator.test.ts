/** PreferencesCoordinator is the sole serialized owner of settings and Travel writes. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PreferencesCoordinator } from "../../src/main/core/preferences-coordinator.js";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.js";
import {
  replaceTravelShortcut,
} from "../../src/shared/travel.js";

type ResetOutcome = Awaited<ReturnType<PreferencesCoordinator["resetSettings"]>>;

async function fixture(): Promise<{
  coordinator: PreferencesCoordinator;
  settings: string;
  travelPreferences: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "gw-preferences-owner-"));
  const paths = {
    settings: join(dir, "settings.json"),
    travelPreferences: join(dir, "travel-preferences.json"),
  };
  return { coordinator: new PreferencesCoordinator(() => paths), ...paths };
}

async function failSync(
  kind: "file" | "directory",
  occurrence: number,
  action: () => Promise<void>,
  beforeThrow?: () => Promise<void>,
): Promise<boolean> {
  const probe = await open(join(tmpdir(), `gw-preferences-probe-${process.pid}`), "w");
  const proto = Object.getPrototypeOf(probe) as {
    sync: (this: FileHandle) => Promise<void>;
  };
  await probe.close();
  const original = proto.sync;
  let seen = 0;
  let refused = false;
  proto.sync = async function failAfterRename(this: FileHandle): Promise<void> {
    const isDirectory = (await this.stat()).isDirectory();
    if ((kind === "directory") === isDirectory) seen += 1;
    if (seen === occurrence && !refused) {
      refused = true;
      await beforeThrow?.();
      throw new Error(`injected ${kind} fsync failure`);
    }
    return original.call(this);
  };
  try {
    await action();
  } finally {
    proto.sync = original;
  }
  return refused;
}

const failNextDirectorySync = (action: () => Promise<void>) =>
  failSync("directory", 1, action);

async function seedNonDefaultPreferences(
  coordinator: PreferencesCoordinator,
): Promise<void> {
  await coordinator.updateSettings({ showDiagnostics: true, renderScale: 1 });
  const current = await coordinator.getTravelPreferences();
  await coordinator.updateTravelPreferences({
    expected: current,
    patch: {
      synonyms: [{ term: "home", mapId: 55 }],
      recentLimit: 3,
      recentMapIds: [55],
    },
  });
}

describe("PreferencesCoordinator", () => {
  it("keeps the released district-bearing shortcut shape", async () => {
    const { coordinator, settings } = await fixture();
    const current = await coordinator.getTravelPreferences();
    const shortcuts = replaceTravelShortcut(current.shortcuts, 8, { mapId: 642 });

    const saved = await coordinator.updateTravelPreferences({
      expected: current,
      patch: { shortcuts },
    });

    assert.deepEqual(saved.shortcuts[8], { mapId: 642 });
    const disk = JSON.parse(await readFile(settings, "utf8")) as {
      travelShortcuts: unknown[];
    };
    assert.deepEqual(disk.travelShortcuts[8], {
      mapId: 642,
      district: "international",
      districtNumber: 0,
    });
  });

  it("refuses a stale second window instead of losing the first write", async () => {
    const { coordinator } = await fixture();
    const windowOne = await coordinator.getTravelPreferences();
    const windowTwo = await coordinator.getTravelPreferences();
    const shortcuts = replaceTravelShortcut(windowOne.shortcuts, 0, { mapId: 449 });

    const first = coordinator.updateTravelPreferences({
      expected: windowOne,
      patch: { shortcuts },
    });
    const second = coordinator.updateTravelPreferences({
      expected: windowTwo,
      patch: { synonyms: [{ term: "home", mapId: 55 }] },
    });

    await first;
    await assert.rejects(second, /changed in another window/u);
    const current = await coordinator.getTravelPreferences();
    assert.deepEqual(current.shortcuts, shortcuts);
    assert.deepEqual(current.synonyms, []);
  });

  it("serializes ordinary settings writes with shortcut writes", async () => {
    const { coordinator } = await fixture();
    const current = await coordinator.getTravelPreferences();
    const shortcuts = replaceTravelShortcut(current.shortcuts, 8, { mapId: 642 });

    await Promise.all([
      coordinator.updateSettings({ showDiagnostics: true }),
      coordinator.updateTravelPreferences({ expected: current, patch: { shortcuts } }),
    ]);

    const settings = await coordinator.getSettings();
    assert.equal(settings.showDiagnostics, true);
    assert.deepEqual(settings.travelShortcuts[8], {
      mapId: 642,
      district: "international",
      districtNumber: 0,
    });
  });

  it("reports a post-rename failure as unconfirmed, then reloads the active value", async () => {
    const { coordinator, settings, travelPreferences } = await fixture();
    await writeFile(settings, JSON.stringify({ formatVersion: 1, ...DEFAULT_SETTINGS }));
    const current = await coordinator.getTravelPreferences();
    const refusedDirectorySync = await failNextDirectorySync(async () => {
      await assert.rejects(
        coordinator.updateTravelPreferences({
          expected: current,
          patch: { recentLimit: 3 },
        }),
        /could not confirm whether the new value is active/u,
      );
    });

    assert.equal(refusedDirectorySync, true);
    assert.equal((await coordinator.getTravelPreferences()).recentLimit, 3);
    assert.equal(JSON.parse(await readFile(travelPreferences, "utf8")).recentLimit, 3);
  });

  it("returns an ordinary settings update that became active before fsync failed", async () => {
    const { coordinator } = await fixture();
    let saved = DEFAULT_SETTINGS;
    const refusedDirectorySync = await failNextDirectorySync(async () => {
      saved = await coordinator.updateSettings({ showDiagnostics: true });
    });

    assert.equal(refusedDirectorySync, true);
    assert.equal(saved.showDiagnostics, true);
    assert.equal((await coordinator.getSettings()).showDiagnostics, true);
  });

  it("returns a settings reset that became active before fsync failed", async () => {
    const { coordinator } = await fixture();
    await coordinator.updateSettings({ showDiagnostics: true, renderScale: 1 });
    let outcome: ResetOutcome | undefined;
    const refusedDirectorySync = await failNextDirectorySync(async () => {
      outcome = await coordinator.resetSettings();
    });

    assert.equal(refusedDirectorySync, true);
    assert.ok(outcome);
    assert.equal(outcome.status, "complete");
    assert.deepEqual(outcome.settings, DEFAULT_SETTINGS);
    assert.deepEqual(await coordinator.getSettings(), DEFAULT_SETTINGS);
  });

  it("resets settings and Travel preferences completely", async () => {
    const { coordinator } = await fixture();
    await seedNonDefaultPreferences(coordinator);

    const outcome = await coordinator.resetSettings();

    assert.equal(outcome.status, "complete");
    assert.deepEqual(outcome.settings, DEFAULT_SETTINGS);
    assert.deepEqual(outcome.travelPreferences, {
      shortcuts: (await coordinator.getTravelPreferences()).shortcuts,
      synonyms: [],
      recentLimit: 5,
      recentMapIds: [],
    });
  });

  it("does not attempt Travel when the settings reset definitively fails", async () => {
    const { coordinator } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    const before = await coordinator.getTravelPreferences();
    const refused = await failSync("file", 1, async () => {
      await assert.rejects(coordinator.resetSettings(), /injected file fsync failure/u);
    });

    assert.equal(refused, true);
    assert.deepEqual(await coordinator.getTravelPreferences(), before);
  });

  it("skips the Travel write when its document is already default", async () => {
    const { coordinator } = await fixture();
    await coordinator.updateSettings({ showDiagnostics: true });
    let outcome: ResetOutcome | undefined;
    const refused = await failSync("file", 2, async () => {
      outcome = await coordinator.resetSettings();
    });

    assert.equal(refused, false);
    assert.ok(outcome);
    assert.equal(outcome.status, "complete");
  });

  it("returns a partial result when the Travel write definitively fails", async () => {
    const { coordinator } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    let outcome: ResetOutcome | undefined;
    const refused = await failSync("file", 2, async () => {
      outcome = await coordinator.resetSettings();
    });

    assert.equal(refused, true);
    assert.ok(outcome);
    assert.equal(outcome.status, "partial");
    assert.equal(outcome.status === "partial" && outcome.pending, "travel");
    assert.deepEqual(outcome.settings, DEFAULT_SETTINGS);
    assert.deepEqual(outcome.travelPreferences?.synonyms, [{ term: "home", mapId: 55 }]);
  });

  it("reconciles a Travel reset published before directory fsync failed", async () => {
    const { coordinator } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    let outcome: ResetOutcome | undefined;
    const refused = await failSync("directory", 2, async () => {
      outcome = await coordinator.resetSettings();
    });

    assert.equal(refused, true);
    assert.ok(outcome);
    assert.equal(outcome.status, "complete");
    assert.deepEqual(outcome.travelPreferences.synonyms, []);
  });

  it("returns partial when Travel cannot be read after settings commit", async () => {
    const { coordinator, travelPreferences } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    await rm(travelPreferences);
    await mkdir(travelPreferences);

    const outcome = await coordinator.resetSettings();

    assert.equal(outcome.status, "partial");
    assert.equal(outcome.status === "partial" && outcome.pending, "travel");
    assert.equal(outcome.travelPreferences, null);
    assert.deepEqual(outcome.settings, DEFAULT_SETTINGS);
  });

  it("returns partial when an unconfirmed Travel publication cannot be reread", async () => {
    const { coordinator, travelPreferences } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    let outcome: ResetOutcome | undefined;
    const refused = await failSync(
      "directory",
      2,
      async () => {
        outcome = await coordinator.resetSettings();
      },
      async () => {
        await rm(travelPreferences);
        await mkdir(travelPreferences);
      },
    );

    assert.equal(refused, true);
    assert.ok(outcome);
    assert.equal(outcome.status, "partial");
    assert.equal(outcome.travelPreferences, null);
    assert.deepEqual(outcome.settings, DEFAULT_SETTINGS);
  });

  it("completes an idempotent retry after a partial Travel reset", async () => {
    const { coordinator } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    let partial: ResetOutcome | undefined;
    await failSync("file", 2, async () => {
      partial = await coordinator.resetSettings();
    });
    assert.ok(partial);
    assert.equal(partial.status, "partial");

    const retried = await coordinator.resetSettings();
    assert.equal(retried.status, "complete");
    assert.deepEqual(retried.travelPreferences.synonyms, []);
  });

  it("runs the next queued mutation after a partial reset", async () => {
    const { coordinator } = await fixture();
    await seedNonDefaultPreferences(coordinator);
    let partial: ResetOutcome | undefined;
    await failSync("file", 2, async () => {
      const reset = coordinator.resetSettings();
      const queued = coordinator.updateSettings({ showDiagnostics: true });
      partial = await reset;
      await queued;
    });

    assert.ok(partial);
    assert.equal(partial.status, "partial");
    assert.equal((await coordinator.getSettings()).showDiagnostics, true);
  });
});
