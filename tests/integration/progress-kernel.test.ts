/** Exercises the real Rust progress reader with disposable native memory. */
import assert from "node:assert/strict";
import test from "node:test";
import { COMPANION_FEATURE_BITS } from "../../src/shared/companion-abi.ts";
import { createCompanionProgressReader } from "../../src/renderer/companion-progress-snapshot.ts";
import { ADDRESSES, POLICY_CONFIG_START, createKernel, installGameGraph } from "../fixtures/enhancements.ts";

const FEATURES = COMPANION_FEATURE_BITS.playRegionObservation | COMPANION_FEATURE_BITS.progressObservation;
const BITS = 0x1_9000;
const TITLES = 0x1_a000;

/** WorldContext `Array<u32>`: buffer, capacity, size. */
function array(view: DataView, field: number, buffer: number, words: readonly number[]) {
  view.setUint32(ADDRESSES.world + field, buffer, true);
  view.setUint32(ADDRESSES.world + field + 4, words.length, true);
  view.setUint32(ADDRESSES.world + field + 8, words.length, true);
  words.forEach((word, index) => view.setUint32(buffer + index * 4, word, true));
}

function area(view: DataView, mapId: number, words: Readonly<Record<number, number>>) {
  for (const [field, value] of Object.entries(words)) view.setUint32(ADDRESSES.areaInfo + mapId * 0x7c + Number(field), value, true);
}

function installProgress(view: DataView) {
  array(view, 0x5cc, BITS, [1 << 10, 1 << 12]);         // completed: maps 10 and 44
  array(view, 0x5dc, BITS + 0x100, [1 << 10]);           // bonus: map 10
  array(view, 0x5ec, BITS + 0x200, []);                  // nothing in hard mode yet
  array(view, 0x5fc, BITS + 0x300, []);
  array(view, 0x83c, BITS + 0x400, [1 << 13]);           // vanquished: map 13
  view.setUint32(ADDRESSES.world + 0x81c, TITLES, true);
  view.setUint32(ADDRESSES.world + 0x824, 19, true);
  for (const [id, points] of [[1, 724], [2, 415], [18, 189]] as const) {
    view.setUint32(TITLES + id * 0x2c, 1, true);
    view.setUint32(TITLES + id * 0x2c + 4, points, true);
  }
  // A mission with a map point, and two explorable areas with only icon rectangles.
  area(view, 10, { 0x00: 1, 0x08: 1, 0x0c: 5, 0x14: 7, 0x40: 500, 0x44: 600, 0x74: 77 });
  area(view, 13, { 0x00: 1, 0x08: 2, 0x0c: 2, 0x10: 0x1000_0000, 0x48: 100, 0x4c: 200, 0x50: 300, 0x54: 400, 0x74: 78 });
  area(view, 14, { 0x00: 1, 0x08: 2, 0x0c: 2, 0x58: 10, 0x5c: 20, 0x60: 30, 0x64: 60, 0x74: 79 });
}

async function fixture() {
  const kernel = await createKernel({ partyDetail: true });
  installGameGraph(kernel.view);
  installProgress(kernel.view);
  assert.equal(kernel.init({ features: FEATURES }), 1);
  const read = createCompanionProgressReader();
  return { kernel, state: () => read(kernel.memory.buffer, ADDRESSES.progress) };
}

test("progress publishes the character's records, Cartographer titles and map positions", async () => {
  const { kernel, state } = await fixture();
  kernel.tick();
  const ready = state();
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  assert.equal(ready.mapId, 133);
  assert.deepEqual(ready.missions?.completed.slice(0, 2), [1 << 10, 1 << 12]);
  assert.deepEqual(ready.missions?.bonus.slice(0, 2), [1 << 10, 0]);
  assert.equal(ready.missions?.completedHm.every((word) => word === 0), true);
  assert.equal(ready.vanquished?.[0], 1 << 13);
  assert.deepEqual(ready.cartographer, [72.4, 41.5, 18.9]);
  const rows = new Map(ready.areas.map((row) => [row.mapId, row]));
  assert.deepEqual(rows.get(10), { mapId: 10, campaign: 1, continent: 0, region: 1, type: 5, thumbnail: true, flags: 0, nameId: 77, x: 500, y: 600 });
  // An explorable area stands at the centre of its first non-empty icon rectangle.
  assert.deepEqual([rows.get(13)?.x, rows.get(13)?.y], [200, 300]);
  assert.deepEqual([rows.get(14)?.x, rows.get(14)?.y], [20, 40]);
});

test("an unreadable record leaves only its own section unknown", async () => {
  const { kernel, state } = await fixture();
  kernel.view.setUint32(ADDRESSES.world + 0x5dc, BITS + 0x102, true);  // misaligned bonus buffer
  kernel.view.setUint32(ADDRESSES.world + 0x824, 2, true);             // the title array ends before Elona
  kernel.tick();
  const ready = state();
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  assert.deepEqual([ready.missions, ready.cartographer], [null, null]);
  assert.equal(ready.vanquished?.[0], 1 << 13);
});

test("a map load never shows an old or empty record", async () => {
  const { kernel, state } = await fixture();
  kernel.tick();
  assert.equal(state().status, "ready");
  kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
  kernel.tick();
  assert.deepEqual(state(), { status: "waiting", reason: "loading" });
  kernel.view.setUint32(ADDRESSES.character + 0x23c, 0, true);
  kernel.tick();
  assert.equal(state().status, "ready");
});

test("an area table beyond memory on the first ready tick is retried once it is readable", async () => {
  const kernel = await createKernel({ partyDetail: true });
  installGameGraph(kernel.view);
  installProgress(kernel.view);
  // Move the table so rows 0..139 (maps 10, 13, 14 and the current map 133)
  // fit in memory but the other 883 rows run past its end.
  const rows = 140 * 0x7c;
  const base = kernel.memory.buffer.byteLength - rows;
  new Uint8Array(kernel.memory.buffer).copyWithin(base, ADDRESSES.areaInfo, ADDRESSES.areaInfo + rows);
  new Uint32Array(kernel.memory.buffer, ADDRESSES.config, POLICY_CONFIG_START + 1)[POLICY_CONFIG_START] = base;
  assert.equal(kernel.init({ features: FEATURES }), 1);
  const read = createCompanionProgressReader();
  const state = () => read(kernel.memory.buffer, ADDRESSES.progress);

  kernel.tick();
  const first = state();
  assert.equal(first.status, "ready");
  if (first.status !== "ready") return;
  assert.deepEqual(first.areas, []);

  kernel.memory.grow(2);
  kernel.tick();
  const later = state();
  assert.equal(later.status, "ready");
  if (later.status !== "ready") return;
  assert.equal(later.areas.find((row) => row.mapId === 10)?.nameId, 77);
});

test("an area type that would overflow its six bits leaves the row unread", async () => {
  const { kernel, state } = await fixture();
  area(kernel.view, 14, { 0x0c: 0x40 });
  kernel.tick();
  const ready = state();
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  const rows = new Map(ready.areas.map((row) => [row.mapId, row]));
  assert.equal(rows.has(14), false);
  assert.equal(rows.get(10)?.type, 5);
});
