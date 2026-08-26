import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TravelHistoryStore } from "../../src/main/core/travel-history.js";
import {
  parseTravelHistoryDocument,
  recordVisitedTravel,
  travelCharacterKey,
} from "../../src/shared/travel-history.js";

const characterA = travelCharacterKey("0123456789abcdef");
const characterB = travelCharacterKey("fedcba9876543210");

describe("Travel history", () => {
  it("keeps ten unique reviewed destinations in most-recent order", () => {
    const destinations = [148, 164, 165, 166, 163, 778, 81, 55, 20, 49, 109, 81, 85];
    const history = destinations.reduce(recordVisitedTravel, Object.freeze([]) as readonly number[]);
    assert.deepEqual(history, [85, 81, 109, 49, 20, 55, 778, 163, 166, 165]);
    assert.throws(() => recordVisitedTravel(history, 2_000), /not reviewed/u);
  });

  it("persists histories independently per character across store instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-history-"));
    const path = join(dir, "travel-history.json");
    const first = new TravelHistoryStore(path);
    await first.record(characterA, 55);
    await first.record(characterB, 449);
    await first.record(characterA, 81);

    const restarted = new TravelHistoryStore(path);
    assert.deepEqual(await restarted.get(characterA), [81, 55]);
    assert.deepEqual(await restarted.get(characterB), [449]);
    assert.deepEqual(parseTravelHistoryDocument(JSON.parse(await readFile(path, "utf8"))), {
      formatVersion: 2,
      characters: { [characterB]: [449], [characterA]: [81, 55] },
    });
  });

  it("quarantines an unreadable document instead of sharing invented history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-travel-history-"));
    const path = join(dir, "travel-history.json");
    await writeFile(path, "not json");
    assert.deepEqual(await new TravelHistoryStore(path).get(characterA), []);
    await assert.rejects(readFile(path, "utf8"), /ENOENT/u);
  });
});
