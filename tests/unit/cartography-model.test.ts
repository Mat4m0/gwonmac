import assert from "node:assert/strict";
import test from "node:test";
import type {
  CartographyContextSnapshot,
  ExplorationSpikeController,
  WorldMapAnchorSpikeController,
} from "../../src/shared/cartography-spike.js";
import type { PublishedCompanionState } from "../../src/renderer/companion-snapshot.js";
import {
  bitsetHasCell,
  readCartographyModel,
  readCartographyPresentation,
  type CartographyModelSources,
  type GridCell,
} from "../../src/renderer/cartography-spike/cartography-model.js";
import type {
  CartographyReachabilityController,
  CartographyReachabilitySnapshot,
} from "../../src/renderer/cartography-spike/reachability-kernel.js";
import {
  TOOLBOX_CARTOGRAPHY_CONTINENTS,
  isToolboxCreditableCell,
} from "../../src/renderer/cartography-spike/toolbox-cartography-data.js";

const MAP_ID = 650;
const AREA_EPOCH = 7;
const CONTINENT = 3;
const WIDTH = TOOLBOX_CARTOGRAPHY_CONTINENTS[CONTINENT]!.creditable.x0
  + TOOLBOX_CARTOGRAPHY_CONTINENTS[CONTINENT]!.creditable.width;
const HEIGHT = TOOLBOX_CARTOGRAPHY_CONTINENTS[CONTINENT]!.creditable.y0
  + TOOLBOX_CARTOGRAPHY_CONTINENTS[CONTINENT]!.creditable.height;
const CREDITABLE_CELL = findCreditableCell();

function findCreditableCell(): GridCell {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (isToolboxCreditableCell(CONTINENT, x, y)) return { x, y };
    }
  }
  throw new Error("Toolbox fixture has no creditable cell");
}

function wordsWith(cell: GridCell): Uint32Array {
  const words = new Uint32Array(Math.ceil(WIDTH * HEIGHT / 32));
  const index = cell.y * WIDTH + cell.x;
  words[index >>> 5] = 1 << (index & 31);
  return words;
}

const READY_CONTEXT: CartographyContextSnapshot = Object.freeze({
  status: 1,
  sequence: 12,
  areaEpoch: AREA_EPOCH,
  mapId: MAP_ID,
  layoutId: 1,
});

const READY_KERNEL: CartographyReachabilitySnapshot = Object.freeze({
  status: 1,
  sequence: 2,
  mapId: MAP_ID,
  areaEpoch: AREA_EPOCH,
  layoutId: 1,
  width: WIDTH,
  height: HEIGHT,
  resourceGeneration: 42,
  totalTrapezoids: 5_000,
  reachableTrapezoids: 1_000,
  groundCells: 20,
  doorwayCount: 3,
  reachableCells: Object.freeze({ words: wordsWith(CREDITABLE_CELL) }),
  walkableTerrain: Object.freeze({
    mapLeft: 100,
    mapTop: 200,
    mapUnitsPerPixel: 2,
    width: 2,
    height: 2,
    words: Uint32Array.of(0b1111),
  }),
});

const COMPANION = Object.freeze({
  status: "ready",
  mapId: MAP_ID,
  playerId: 123,
  playerX: 10,
  playerY: 20,
}) as PublishedCompanionState;

function sources(
  contexts: readonly (CartographyContextSnapshot | null)[] = [
    READY_CONTEXT,
    READY_CONTEXT,
  ],
  kernelResult: CartographyReachabilitySnapshot | null = READY_KERNEL,
): CartographyModelSources {
  let contextIndex = 0;
  const context = {
    refresh: () => true,
    snapshot: () => contexts[Math.min(contextIndex++, contexts.length - 1)] ?? null,
  };
  const exploration: ExplorationSpikeController = {
    snapshot: () => ({
      status: 1, sequence: 2, generation: AREA_EPOCH,
      width: WIDTH, height: HEIGHT,
      dwordCount: Math.ceil(WIDTH * HEIGHT / 32),
    }),
    isExplored: () => false,
    readBitmap: () => ({
      snapshot: {
        status: 1, sequence: 2, generation: AREA_EPOCH,
        width: WIDTH, height: HEIGHT,
        dwordCount: Math.ceil(WIDTH * HEIGHT / 32),
      },
      words: new Uint32Array(Math.ceil(WIDTH * HEIGHT / 32)),
    }),
  };
  const anchor: WorldMapAnchorSpikeController = {
    snapshot: () => ({
      status: 1, generation: AREA_EPOCH, continent: CONTINENT,
      worldAnchorX: 100, worldAnchorY: 200,
      mapMinX: 0, mapMinY: 0, mapMaxX: 1_000, mapMaxY: 1_000,
    }),
  };
  const kernel: CartographyReachabilityController = {
    classify: () => kernelResult,
    diagnostic: () => null,
    dispose: () => undefined,
  };
  return {
    context,
    compass: { snapshot: () => null },
    missionMap: { snapshot: () => null },
    exploration,
    anchor,
    kernel,
    companion: () => COMPANION,
    revealRadius: () => 1,
    correction: () => null,
  };
}

test("publishes one complete model for one unchanged epoch", () => {
  const model = readCartographyModel(sources());
  assert.equal(model.status, "ready");
  if (model.status !== "ready") return;
  assert.deepEqual(model.epoch, { mapId: MAP_ID, area: AREA_EPOCH, resource: 42 });
  assert.equal(bitsetHasCell(model.reachableCells, CREDITABLE_CELL), true);
  assert.equal(bitsetHasCell(model.actionableCells, CREDITABLE_CELL), true);
  assert.equal(model.surfaces.compass, null);
  assert.equal(model.surfaces.missionMap, null);
});

test("rejects an interleaved map transition instead of publishing mixed data", () => {
  const next = Object.freeze({ ...READY_CONTEXT, sequence: 14, areaEpoch: 8, mapId: 651 });
  assert.deepEqual(
    readCartographyModel(sources([READY_CONTEXT, next])),
    { status: "unavailable", reason: "epoch-mismatch" },
  );
});

test("withdraws immediately while the certified context is loading", () => {
  const loading = Object.freeze({ ...READY_CONTEXT, status: 2, sequence: 14, areaEpoch: 8 });
  assert.deepEqual(
    readCartographyModel(sources([loading])),
    { status: "unavailable", reason: "loading" },
  );
});

test("fails closed when the context cannot publish a fresh identity", () => {
  const failed = sources();
  assert.deepEqual(
    readCartographyModel({
      ...failed,
      context: { ...failed.context, refresh: () => false },
    }),
    { status: "unavailable", reason: "context" },
  );
});

test("rejects a kernel publication from another epoch", () => {
  const staleKernel = Object.freeze({ ...READY_KERNEL, areaEpoch: AREA_EPOCH - 1 });
  assert.deepEqual(
    readCartographyModel(sources(undefined, staleKernel)),
    { status: "unavailable", reason: "kernel" },
  );
});

test("semantic bitsets are not interchangeable", () => {
  const model = readCartographyModel(sources());
  assert.equal(model.status, "ready");
  if (model.status !== "ready") return;
  // @ts-expect-error A cell bitset cannot be supplied as a terrain raster.
  const terrain: typeof model.walkableTerrain = model.reachableCells;
  assert.notEqual(terrain, model.walkableTerrain);
  // @ts-expect-error Reachable input cannot masquerade as derived actionability.
  const actionable: typeof model.actionableCells = model.reachableCells;
  assert.notEqual(actionable, model.actionableCells);
});

test("refreshes frame-sensitive presentation without rerunning classification", () => {
  const model = readCartographyModel(sources());
  assert.equal(model.status, "ready");
  const current = {
    ...sources(),
    companion: () => Object.freeze({ ...COMPANION, playerX: 99 }),
  };
  const presentation = readCartographyPresentation(model, current);
  assert.deepEqual(presentation.player, { x: 99, y: 20 });
});
