import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ELITE_LOCATIONS } from "../../src/shared/elite-locations.js";
import { EliteTrackingStore } from "../../src/main/core/elite-tracking.js";
import {
  DEFAULT_ELITE_VIEW, EMPTY_ELITE_TRACKING, changeEliteTracking, eliteContinent, eliteLearned, parseEliteTracking, parseEliteUpdate,
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
    assert.equal(eliteContinent("Tyria"), 0);
    assert.equal(eliteContinent("Eye of the North"), 0);
    assert.equal(eliteContinent("Cantha"), 2);
    assert.equal(eliteContinent("Elona"), 4);
    assert.equal(ELITE_LOCATIONS.find((entry) => entry.boss === "Flame Djinn")?.region, "Eye of the North");
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


describe("elite view persistence", () => {
  it("validates bounded preferences and rejects malformed or unknown choices", () => {
    const valid = { ...DEFAULT_ELITE_VIEW, search: "Hundred Blades", professions: { kind: "custom", values: ["W", "R"] } };
    const parse = (view: unknown) => parseEliteUpdate({ characterKey: characterA, change: { kind: "view", view } });
    assert.doesNotThrow(() => parse(valid));
    for (const patch of [
      { search: "x".repeat(201) }, { search: 1 }, { region: "Unknown" }, { worldMap: 1 }, { panelOpen: null },
      { hideLearned: "yes" }, { mode: "all" }, { focusedSkill: -1 }, { focusedSkill: 1.5 }, { extra: true },
      { professions: { kind: "custom", values: [] } }, { professions: { kind: "custom", values: ["W", "W"] } },
      { professions: { kind: "custom", values: ["Warrior"] } }, { professions: { kind: "mine", values: ["W"] } },
    ]) assert.throws(() => parse({ ...valid, ...patch }));
    assert.throws(() => changeEliteTracking(EMPTY_ELITE_TRACKING,
      { kind: "view", view: { ...DEFAULT_ELITE_VIEW, focusedSkill: 9999 } }, ELITE_LOCATIONS));
  });
  it("restores all preferences after a store restart without replacing capture plans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gwonmac-elite-view-"));
    const path = join(dir, "tracking.json");
    try {
      // Existing capture plans can have no saved map preferences.
      await writeFile(path, JSON.stringify({ formatVersion: 1, characters: {
        [characterA]: { skills: [338], activeLocation: lissah.id, missionMap: false },
      } }));
      const store = new EliteTrackingStore();
      assert.deepEqual((await store.get(path, characterA)).view, DEFAULT_ELITE_VIEW);
      const view = { ...DEFAULT_ELITE_VIEW, search: "Hundred Blades", professions: { kind: "mine" as const },
        panelOpen: true, worldMap: false, region: "Cantha" as const, hideLearned: false, mode: "tracked" as const };
      await store.update(path, { characterKey: characterA, change: { kind: "view", view } });
      const restart = new EliteTrackingStore();
      const saved = await restart.get(path, characterA);
      assert.deepEqual(saved.view, view);
      assert.deepEqual(saved.skills, [338]);
      assert.equal(saved.activeLocation, lissah.id);
      assert.equal(saved.missionMap, false);
      assert.deepEqual(await restart.get(path, characterB), EMPTY_ELITE_TRACKING);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
