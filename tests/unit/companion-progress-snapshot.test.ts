/** The renderer's strict decoder for the companion progress publication. */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANION_ABI } from "../../src/shared/companion-abi.ts";
import { createCompanionProgressReader, sameGameProgress } from "../../src/renderer/companion-progress-snapshot.ts";

const ABI = COMPANION_ABI.progress;
const POINTER = 64;
const MISSIONS = 32;
const VANQUISHED = MISSIONS + ABI.missionSets * 28 * 4;
const TITLES = VANQUISHED + 28 * 4;
const AREAS = TITLES + ABI.titles * 8;
const FLAGS = { ready: 1, loading: 2, missions: 4, vanquishes: 8, titles: 16, areas: 32 };

type Publication = Partial<{ sequence: number; magic: number; flags: number; mapId: number; keyLow: number; keyHigh: number; areaCount: number }>;

function publication(fields: Publication = {}): ArrayBuffer {
  const buffer = new ArrayBuffer(POINTER + ABI.bytes);
  const view = new DataView(buffer, POINTER);
  const all = FLAGS.ready | FLAGS.missions | FLAGS.vanquishes | FLAGS.titles | FLAGS.areas;
  const { sequence = 4, magic = 0x5047_5747, flags = all, mapId = 81, keyLow = 0xaa, keyHigh = 1, areaCount = 3 } = fields;
  view.setUint32(0, magic, true);
  view.setUint16(4, ABI.abi, true);
  view.setUint16(6, ABI.bytes, true);
  view.setUint32(8, sequence, true);
  view.setUint32(12, flags, true);
  view.setUint32(16, mapId, true);
  view.setUint32(20, keyLow, true);
  view.setUint32(24, keyHigh, true);
  view.setUint32(28, areaCount, true);
  view.setUint32(MISSIONS, 1 << 12, true);                  // completed: map 12
  view.setUint32(MISSIONS + 28 * 4, 1 << 10, true);         // bonus: map 10
  view.setUint32(VANQUISHED, 1 << 13, true);
  [[1, 724], [0, 300], [1, 1_001]].forEach(([props, points], index) => {
    view.setUint32(TITLES + index * 8, props!, true);
    view.setUint32(TITLES + index * 8 + 4, points!, true);
  });
  // Row 0 was not read; row 1 is a Prophecies mission with a thumbnail; row 2 an Elona area.
  const area = (mapId: number, words: number[]) => words.forEach((word, index) => view.setUint32(AREAS + (mapId * 5 + index) * 4, word, true));
  area(1, [(1 << 31 | 1 << 30 | 5 << 24 | 2 << 16 | 0 << 8 | 1) >>> 0, 0x20, 900, 120, 340]);
  area(2, [(1 << 31 | 2 << 24 | 15 << 16 | 4 << 8 | 3) >>> 0, 0x1000_0000, 901, 50, 60]);
  return buffer;
}

test("a complete publication decodes bits, Cartographer percent and read area rows", () => {
  const state = createCompanionProgressReader()(publication(), POINTER);
  assert.equal(state.status, "ready");
  if (state.status !== "ready") return;
  assert.equal(state.characterKey, "00000001000000aa");
  assert.equal(state.missions?.completed[0], 1 << 12);
  assert.equal(state.missions?.bonus[0], 1 << 10);
  assert.equal(state.vanquished?.[0], 1 << 13);
  // Elona's 1,001 points are out of range, Cantha's props say it is no percent title.
  assert.deepEqual(state.cartographer, [72.4, null, null]);
  assert.deepEqual(state.areas, [
    { mapId: 1, campaign: 1, continent: 0, region: 2, type: 5, thumbnail: true, flags: 0x20, nameId: 900, x: 120, y: 340 },
    { mapId: 2, campaign: 3, continent: 4, region: 15, type: 2, thumbnail: false, flags: 0x1000_0000, nameId: 901, x: 50, y: 60 },
  ]);
});

test("missing sections stay unknown while the rest decodes", () => {
  const state = createCompanionProgressReader()(publication({ flags: FLAGS.ready | FLAGS.vanquishes, areaCount: 0 }), POINTER);
  assert.equal(state.status, "ready");
  if (state.status !== "ready") return;
  assert.deepEqual([state.missions, state.cartographer, state.areas], [null, null, []]);
  assert.equal(state.vanquished?.[0], 1 << 13);
});

test("a torn, foreign or incomplete publication withdraws progress", () => {
  const cases: readonly [string, Publication, unknown][] = [
    ["odd sequence", { sequence: 5 }, { status: "waiting", reason: "snapshot" }],
    ["wrong magic", { magic: 0 }, { status: "waiting", reason: "snapshot" }],
    ["unknown flag", { flags: FLAGS.ready | 64 }, { status: "waiting", reason: "snapshot" }],
    ["areas flag without rows", { flags: FLAGS.ready | FLAGS.areas, areaCount: 0 }, { status: "waiting", reason: "snapshot" }],
    ["too many rows", { areaCount: ABI.areaRows + 1 }, { status: "waiting", reason: "snapshot" }],
    ["ready without a map", { mapId: 0 }, { status: "waiting", reason: "snapshot" }],
    ["ready without a character", { keyLow: 0, keyHigh: 0 }, { status: "waiting", reason: "snapshot" }],
    ["map loading", { flags: FLAGS.loading, areaCount: 0 }, { status: "waiting", reason: "loading" }],
    ["PvP or character select", { flags: 0, areaCount: 0 }, { status: "waiting", reason: "unavailable" }],
  ];
  for (const [name, fields, expected] of cases) {
    assert.deepEqual(createCompanionProgressReader()(publication(fields), POINTER), expected, name);
  }
  assert.deepEqual(createCompanionProgressReader()(publication(), POINTER + 2), { status: "waiting", reason: "unavailable" });
});

test("the kernel's identical republish is the same state for subscribers", () => {
  const read = createCompanionProgressReader();
  const first = read(publication({ sequence: 4 }), POINTER);
  const again = read(publication({ sequence: 6 }), POINTER);
  assert.equal(sameGameProgress(first, again), true);
  assert.equal(sameGameProgress(first, read(publication({ sequence: 8, mapId: 82 }), POINTER)), false);
});
