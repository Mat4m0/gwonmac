import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ELITE_LOCATIONS } from "../../src/shared/elite-locations.js";
import { EliteTrackingStore } from "../../src/main/core/elite-tracking.js";
import {
  EMPTY_ELITE_TRACKING, changeEliteTracking, eliteLearned, parseEliteTracking, parseEliteUpdate,
} from "../../src/shared/elite-skills.js";
import { travelCharacterKey } from "../../src/shared/travel-history.js";

const characterA = travelCharacterKey("0123456789abcdef");
const characterB = travelCharacterKey("fedcba9876543210");
const lissah = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;
const fenrir = ELITE_LOCATIONS.find((entry) => entry.boss === "Fenrir")!;

describe("elite capture plans", () => {
  it("imports every distinct location with stable IDs, alternate spawns and missing positions", () => {
    assert.equal(ELITE_LOCATIONS.length, 925);
    assert.equal(new Set(ELITE_LOCATIONS.map((entry) => entry.id)).size, 925);
    assert.equal(new Set(ELITE_LOCATIONS.map((entry) => entry.skillId)).size, 302);
    assert.equal(lissah.skillId, 338);
    assert.equal(lissah.region, "Eye of the North");
    assert.deepEqual(lissah.points, [[6442, 1596]]);
    assert.ok(ELITE_LOCATIONS.some((entry) => entry.points.length > 1 && entry.note));
    assert.ok(ELITE_LOCATIONS.some((entry) => entry.boss === "Reaper of Agony" && entry.points.length === 0));
    assert.ok(ELITE_LOCATIONS.some((entry) => entry.note?.includes("impossible to capture")));
  });
  it("never interprets unobserved skills as missing or learned", () => {
    assert.equal(eliteLearned(338, null), "unknown");
    assert.equal(eliteLearned(338, { knownThrough: 338, unlocked: new Set() }), "unknown");
    assert.equal(eliteLearned(338, { knownThrough: 339, unlocked: new Set() }), "not-learned");
    assert.equal(eliteLearned(338, { knownThrough: 339, unlocked: new Set([338]) }), "learned");
  });
  it("keeps one active boss belonging to a tracked skill and rejects invalid input", () => {
    const targeted = changeEliteTracking(EMPTY_ELITE_TRACKING, { kind: "target", locationId: lissah.id }, ELITE_LOCATIONS);
    assert.deepEqual(targeted.skills, [338]);
    assert.equal(targeted.activeLocation, lissah.id);
    assert.equal(changeEliteTracking(targeted, { kind: "remove", skillId: 338 }, ELITE_LOCATIONS).activeLocation, null);
    assert.throws(() => parseEliteTracking({ ...targeted, skills: [] }, ELITE_LOCATIONS));
    assert.throws(() => parseEliteUpdate({ characterKey: characterA, change: { kind: "target", locationId: "../bad" } }));
    assert.throws(() => parseEliteUpdate({ characterKey: characterA, change: { kind: "track", skillId: 338, extra: true } }));
  });
  it("merges concurrent actions, isolates characters and profiles, and survives restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gwonmac-elites-"));
    try {
      const path = join(dir, "profile-a.json");
      const store = new EliteTrackingStore();
      await Promise.all([lissah, fenrir].map((location) => store.update(path, {
        characterKey: characterA, change: { kind: "track", skillId: location.skillId },
      })));
      const restart = new EliteTrackingStore();
      assert.deepEqual((await restart.get(path, characterA)).skills, [lissah.skillId, fenrir.skillId]);
      assert.deepEqual(await restart.get(path, characterB), EMPTY_ELITE_TRACKING);
      assert.deepEqual(await restart.get(join(dir, "profile-b.json"), characterA), EMPTY_ELITE_TRACKING);
      await writeFile(path, "broken");
      assert.deepEqual(await restart.get(path, characterA), EMPTY_ELITE_TRACKING);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
