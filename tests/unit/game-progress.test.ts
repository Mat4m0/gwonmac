/** The Progress catalogue and goals, from synthetic AreaInfo rows (no game data). */
import assert from "node:assert/strict";
import test from "node:test";
import {
  progressCatalogue,
  progressGoals,
  progressTravelTarget,
  type AreaRow,
  type GameProgressState,
  type ProgressInputs,
} from "../../src/shared/game-progress.ts";

const MISSION = 5;
const EXPLORABLE = 2;
const OUTPOST = 4;
const VANQUISHABLE = 0x1000_0000;

const row = (mapId: number, fields: Partial<AreaRow>): AreaRow => ({
  mapId, campaign: 1, continent: 0, region: 1, type: MISSION, thumbnail: true,
  flags: 0, nameId: 1_000 + mapId, x: 0, y: 0, ...fields,
});

const ROWS: readonly AreaRow[] = [
  row(10, { x: 100, y: 100 }),                      // Bloodstone Fen: a mission
  row(11, { nameId: 1_010 }),                       // The Wilds: same name as row 10, so a duplicate
  row(12, { x: 400, y: 400 }),                      // Aurora Glade: a mission
  row(14, { thumbnail: false }),                    // a mission outpost without a thumbnail is no title mission
  row(15, { flags: 0x20 }),                         // not on the world map
  row(16, { region: 7 }),                           // pre-Searing
  row(125, {}),                                     // the duplicate Titan's Tears row
  row(13, { type: EXPLORABLE, flags: VANQUISHABLE, region: 2, x: 110, y: 90 }),
  row(17, { type: EXPLORABLE }),                    // explorable but not vanquishable
  row(55, { type: OUTPOST, x: 1_000, y: 1_000 }),   // Lion's Arch
  row(81, { type: OUTPOST, x: 120, y: 120 }),       // Ascalon City
  row(215, { campaign: 2, continent: 1, region: 8 }),
  row(291, { campaign: 2, continent: 1, region: 8 }),
  row(292, { campaign: 2, continent: 1, region: 8 }),
];

function bits(...mapIds: number[]): number[] {
  const words = Array.from({ length: 28 }, () => 0);
  for (const mapId of mapIds) words[mapId >>> 5]! |= 1 << (mapId & 31);
  return words.map((word) => word >>> 0);
}

type Ready = Extract<GameProgressState, { status: "ready" }>;
function inputs(overrides: Partial<Ready> = {}, unlocked: number[] | null = [12, 81, 292]): ProgressInputs {
  return {
    progress: {
      status: "ready", sequence: 2, mapId: 81, characterKey: "00000000000000aa",
      missions: { completed: bits(12), bonus: bits(), completedHm: bits(), bonusHm: bits() },
      vanquished: bits(13),
      cartographer: [72.4, null, 18.9],
      areas: ROWS,
      ...overrides,
    },
    unlockedMapWords: unlocked === null ? null : bits(...unlocked),
  };
}

test("the catalogue keeps title missions and vanquish areas and drops look-alikes", () => {
  const catalogue = progressCatalogue(ROWS);
  assert.deepEqual(catalogue.prophecies.missions.map((item) => item.mapId), [10, 12]);
  assert.deepEqual(catalogue.prophecies.areas.map((item) => item.mapId), [13]);
  // Vizunah Square counts once; its quarters are outposts, not missions.
  assert.deepEqual(catalogue.factions.missions.map((item) => item.mapId), [215]);
  assert.equal(catalogue.eotn.missions.length, 11);
  assert.equal(catalogue.prophecies.areas[0]!.region, "Ascalon");
});

test("each goal counts only finished entries and names what is missing", () => {
  const goals = progressGoals("prophecies", inputs());
  const summary = goals.map((goal) => [goal.id, goal.done, goal.total, goal.percent]);
  assert.deepEqual(summary.slice(0, 4), [
    ["protector", 0, 2, null],
    ["guardian", 0, 2, null],
    ["vanquisher", 1, 1, null],
    ["cartographer", 0, 0, 72.4],
  ]);
  const protector = goals[0]!;
  assert.deepEqual(protector.entries.map((entry) => [entry.item.name, entry.label]), [
    ["Bloodstone Fen", "Not completed"],
    ["Aurora Glade", "Needs bonus"],
  ]);
  assert.deepEqual(progressGoals("factions", inputs())[0]!.entries.map((entry) => entry.label), ["Not completed"]);
  assert.equal(progressGoals("factions", inputs({
    missions: { completed: bits(215), bonus: bits(), completedHm: bits(), bonusHm: bits() },
  }))[0]!.entries[0]!.label, "Needs Master's");
});

test("an unreadable array removes its goal instead of showing zero", () => {
  const goals = progressGoals("prophecies", inputs({ missions: null, vanquished: null, cartographer: null }, null));
  assert.deepEqual(goals.map((goal) => [goal.id, goal.percent]), [["cartographer", null]]);
});

test("travel goes to the item's own outpost, an entrance, or the nearest unlocked outpost", () => {
  const catalogue = progressCatalogue(ROWS);
  const find = (mapId: number) => [...catalogue.prophecies.missions, ...catalogue.prophecies.areas, ...catalogue.factions.missions]
    .find((item) => item.mapId === mapId)!;
  const cases: readonly [number, Partial<Ready>, unknown][] = [
    [12, {}, { mapId: 12, name: "Aurora Glade", nearest: false, here: false }],
    [10, {}, { mapId: 81, name: "Ascalon City", nearest: true, here: true }],
    [13, { mapId: 55 }, { mapId: 81, name: "Ascalon City", nearest: true, here: false }],
    [215, {}, { mapId: 292, name: "Vizunah Square — Foreign Quarter", nearest: false, here: false }],
  ];
  for (const [mapId, overrides, expected] of cases) {
    assert.deepEqual(progressTravelTarget(find(mapId), inputs(overrides)), expected, String(mapId));
  }
  // Only an outpost on another continent is unlocked.
  assert.equal(progressTravelTarget(find(10), inputs({}, [292])), null);
});
