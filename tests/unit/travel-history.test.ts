import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  clearTravelHistory,
  loadTravelHistory,
  recordTravelVisit,
} from "../../src/main/core/travel-history.js";
import {
  parseTravelHistoryDocument,
  recordVisitedTravel,
} from "../../src/shared/travel-history.js";

describe("Travel history", () => {
  it("keeps ten unique reviewed destinations in most-recent order", () => {
    const destinations = [148, 164, 165, 166, 163, 778, 81, 55, 20, 49, 109, 81, 85];
    const history = destinations.reduce(recordVisitedTravel, Object.freeze([]) as readonly number[]);

    assert.deepEqual(history, [85, 81, 109, 49, 20, 55, 778, 163, 166, 165]);
    assert.throws(() => recordVisitedTravel(history, 2_000), /not reviewed/u);
  });

  it("rejects duplicate, oversized, unknown, and extended stored data", () => {
    assert.throws(() => parseTravelHistoryDocument({
      formatVersion: 1,
      mapIds: [55, 55],
    }), /invalid/u);
    assert.throws(() => parseTravelHistoryDocument({
      formatVersion: 1,
      mapIds: Array.from({ length: 11 }, () => 55),
    }), /invalid/u);
    assert.throws(() => parseTravelHistoryDocument({
      formatVersion: 1,
      mapIds: [2_000],
    }), /invalid/u);
    assert.throws(() => parseTravelHistoryDocument({
      formatVersion: 1,
      mapIds: [],
      future: true,
    }), /invalid/u);
  });

  it("persists observed visits independently and clears them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-history-"));
    const path = join(dir, "travel-history.json");

    await recordTravelVisit(path, 55);
    await recordTravelVisit(path, 449);
    await recordTravelVisit(path, 55);
    assert.deepEqual(await loadTravelHistory(path), [55, 449]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      mapIds: [55, 449],
    });

    assert.deepEqual(await clearTravelHistory(path), []);
    assert.deepEqual(await loadTravelHistory(path), []);
  });

  it("quarantines an unreadable document instead of inventing history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-history-"));
    const path = join(dir, "travel-history.json");
    await writeFile(path, "not json");

    assert.deepEqual(await loadTravelHistory(path), []);
    await assert.rejects(readFile(path, "utf8"), /ENOENT/u);
  });
});
