/** PreferencesCoordinator is the sole serialized owner of settings and Travel writes. */
import assert from "node:assert/strict";
import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PreferencesCoordinator } from "../../src/main/core/preferences-coordinator.js";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.js";
import {
  replaceTravelShortcut,
} from "../../src/shared/travel.js";

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
    const probe = await open(join(tmpdir(), `gw-preferences-probe-${process.pid}`), "w");
    const proto = Object.getPrototypeOf(probe) as {
      sync: (this: FileHandle) => Promise<void>;
    };
    await probe.close();
    const original = proto.sync;
    let refusedDirectorySync = false;
    proto.sync = async function failAfterRename(this: FileHandle): Promise<void> {
      if ((await this.stat()).isDirectory() && !refusedDirectorySync) {
        refusedDirectorySync = true;
        throw new Error("injected directory fsync failure");
      }
      return original.call(this);
    };
    try {
      await assert.rejects(
        coordinator.updateTravelPreferences({
          expected: current,
          patch: { recentLimit: 3 },
        }),
        /could not confirm whether the new value is active/u,
      );
    } finally {
      proto.sync = original;
    }

    assert.equal(refusedDirectorySync, true);
    assert.equal((await coordinator.getTravelPreferences()).recentLimit, 3);
    assert.equal(JSON.parse(await readFile(travelPreferences, "utf8")).recentLimit, 3);
  });
});
