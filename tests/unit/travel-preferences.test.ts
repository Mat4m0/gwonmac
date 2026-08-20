import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mutex } from "../../src/main/core/mutex.js";
import {
  loadTravelPreferences,
  recordConfirmedTravel,
  updateTravelPreferences,
} from "../../src/main/core/travel-preferences.js";
import { parseTravelPreferences } from "../../src/shared/travel-preferences.js";

describe("Travel preferences", () => {
  it("stores the Travel-only document without adding Stable-owned settings keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-preferences-"));
    const path = join(dir, "travel-preferences.json");
    const saved = await updateTravelPreferences(path, {
      synonyms: [{ term: "home", mapId: 55 }],
      recentLimit: 3,
      recentMapIds: [55, 449],
    });
    assert.deepEqual(saved.recentMapIds, [55, 449]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      synonyms: [{ term: "home", mapId: 55 }],
      recentLimit: 3,
      recentMapIds: [55, 449],
    });
  });

  it("serializes Clear Recent and confirmation without resurrecting old history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-preferences-"));
    const path = join(dir, "travel-preferences.json");
    await updateTravelPreferences(path, { recentMapIds: [55, 81] });
    const lock = new Mutex();

    const clear = lock.run(() => updateTravelPreferences(path, { recentMapIds: [] }));
    const record = lock.run(() => recordConfirmedTravel(path, 449));
    await Promise.all([clear, record]);

    assert.deepEqual((await loadTravelPreferences(path)).recentMapIds, [449]);
  });

  it("makes Off clear history and prevents later confirmations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-preferences-"));
    const path = join(dir, "travel-preferences.json");
    await updateTravelPreferences(path, { recentMapIds: [55], recentLimit: 0 });
    await recordConfirmedTravel(path, 449);
    assert.deepEqual((await loadTravelPreferences(path)).recentMapIds, []);
  });

  it("rejects ambiguous synonyms and unknown document fields", () => {
    const document = {
      formatVersion: 1,
      synonyms: [{ term: "kamadan", mapId: 55 }],
      recentLimit: 5,
      recentMapIds: [],
    };
    assert.throws(() => parseTravelPreferences(document), /invalid/u);
    assert.throws(() => parseTravelPreferences({
      ...document,
      synonyms: [],
      future: true,
    }), /invalid/u);
  });
});
