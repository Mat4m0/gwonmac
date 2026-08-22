import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTravelPreferences,
  updateTravelPreferences,
} from "../../src/main/core/travel-preferences.js";
import {
  parseTravelPreferences,
  parseTravelPreferencesPatch,
} from "../../src/shared/travel-preferences.js";

describe("Travel preferences", () => {
  it("preserves corrupt bytes before returning defaults and reports the backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-preferences-"));
    const path = join(dir, "travel-preferences.json");
    await writeFile(path, "{not travel json");
    let recovered = "";

    const loaded = await loadTravelPreferences(path, (backupPath) => {
      recovered = backupPath;
    });

    assert.deepEqual(loaded, {
      formatVersion: 1,
      synonyms: [],
      recentLimit: 0,
      recentMapIds: [],
    });
    assert.match(
      recovered,
      /travel-preferences\.json\.corrupt-\d+-[0-9a-f-]{36}$/u,
    );
    assert.equal(await readFile(recovered, "utf8"), "{not travel json");
  });

  it("stores the Travel-only document without adding Stable-owned settings keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-preferences-"));
    const path = join(dir, "travel-preferences.json");
    const saved = await updateTravelPreferences(path, {
      synonyms: [{ term: "home", mapId: 55 }],
    });
    assert.deepEqual(saved.recentMapIds, []);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      synonyms: [{ term: "home", mapId: 55 }],
      recentLimit: 0,
      recentMapIds: [],
    });
  });

  it("reads the released shape and clears legacy Recent data on the next write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-preferences-"));
    const path = join(dir, "travel-preferences.json");
    await writeFile(path, JSON.stringify({
      formatVersion: 1,
      synonyms: [{ term: "home", mapId: 55 }],
      recentLimit: 5,
      recentMapIds: [55, 81],
    }));

    assert.deepEqual((await loadTravelPreferences(path)).recentMapIds, [55, 81]);
    await updateTravelPreferences(path, { synonyms: [{ term: "home", mapId: 55 }] });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      synonyms: [{ term: "home", mapId: 55 }],
      recentLimit: 0,
      recentMapIds: [],
    });
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
    assert.throws(() => parseTravelPreferencesPatch({ recentLimit: 3 }), /unknown field/u);
  });
});
