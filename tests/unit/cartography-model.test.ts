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
  readCartographyState,
  readCartographyPresentation,
  type CartographyModelSources,
  type GridCell,
} from "../../src/renderer/cartography-spike/cartography-model.js";
import type {
  CartographyReachabilityController,
  CartographyReachabilitySnapshot,
} from "../../src/renderer/cartography-spike/reachability-kernel.js";
import { captureCartographyEvidence } from "../../src/renderer/cartography-spike/evidence-capture.js";
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
    sha256: "0".repeat(64),
    classify: () => kernelResult,
    diagnostic: () => kernelResult === null ? null : ({
      ...kernelResult,
      terrainWidth: kernelResult.walkableTerrain.width,
      terrainHeight: kernelResult.walkableTerrain.height,
    }),
    dispose: () => undefined,
  };
  return {
    context,
    compass: { snapshot: () => null },
    missionMap: { snapshot: () => null },
    worldMap: {
      snapshot: () => null,
      diagnostics: () => ({
        status: 0, sequence: 0, generation: 0, frameId: 0, visible: 0,
        continent: 0, zoom: 0,
        topLeftX: 0, topLeftY: 0, bottomRightX: 0, bottomRightY: 0,
      }),
    },
    exploration,
    anchor,
    kernel,
    companion: () => COMPANION,
    revealRadius: () => 1,
  };
}

test("publishes independent continent and current-instance state for one epoch", () => {
  const state = readCartographyState(sources());
  assert.equal(state.continent.status, "ready");
  assert.equal(state.currentInstance.status, "ready");
  if (state.continent.status !== "ready" || state.currentInstance.status !== "ready") return;
  assert.deepEqual(state.currentInstance.epoch, {
    mapId: MAP_ID, area: AREA_EPOCH, resource: 42,
  });
  assert.equal(bitsetHasCell(state.continent.remaining, CREDITABLE_CELL), true);
  assert.equal(bitsetHasCell(state.currentInstance.reachableCells, CREDITABLE_CELL), true);
  assert.equal(bitsetHasCell(state.currentInstance.actionableCells, CREDITABLE_CELL), true);
  assert.equal(state.surfaces.compass, null);
  assert.equal(state.surfaces.missionMap, null);
  assert.equal(state.surfaces.worldMap, null);
});

test("partitions every creditable cell into explored or remaining exactly once", () => {
  const state = readCartographyState(sources());
  assert.equal(state.continent.status, "ready");
  if (state.continent.status !== "ready") return;
  for (let y = 0; y < state.continent.creditable.height; y += 1) {
    for (let x = 0; x < state.continent.creditable.width; x += 1) {
      const cell = { x, y };
      const creditable: boolean = bitsetHasCell(state.continent.creditable, cell) === true;
      const explored: boolean = bitsetHasCell(
        state.continent.exploredCreditable,
        cell,
      ) === true;
      const remaining: boolean = bitsetHasCell(state.continent.remaining, cell) === true;
      assert.equal(explored && remaining, false);
      assert.equal(explored || remaining, creditable);
    }
  }
});

test("rejects an interleaved map transition instead of publishing mixed data", () => {
  const next = Object.freeze({ ...READY_CONTEXT, sequence: 14, areaEpoch: 8, mapId: 651 });
  assert.deepEqual(
    readCartographyState(sources([READY_CONTEXT, next])),
    {
      context: null,
      continent: { status: "unavailable", reason: "epoch-mismatch" },
      currentInstance: { status: "unavailable", reason: "epoch-mismatch" },
      surfaces: { compass: null, missionMap: null, worldMap: null },
    },
  );
});

test("withdraws immediately while the certified context is loading", () => {
  const loading = Object.freeze({ ...READY_CONTEXT, status: 2, sequence: 14, areaEpoch: 8 });
  assert.deepEqual(
    readCartographyState(sources([loading])),
    {
      context: null,
      continent: { status: "unavailable", reason: "loading" },
      currentInstance: { status: "unavailable", reason: "loading" },
      surfaces: { compass: null, missionMap: null, worldMap: null },
    },
  );
});

test("fails closed when the context cannot publish a fresh identity", () => {
  const failed = sources();
  assert.deepEqual(
    readCartographyState({
      ...failed,
      context: { ...failed.context, refresh: () => false },
    }),
    {
      context: null,
      continent: { status: "unavailable", reason: "context" },
      currentInstance: { status: "unavailable", reason: "context" },
      surfaces: { compass: null, missionMap: null, worldMap: null },
    },
  );
});

test("rejects a kernel publication from another epoch", () => {
  const staleKernel = Object.freeze({ ...READY_KERNEL, areaEpoch: AREA_EPOCH - 1 });
  const state = readCartographyState(sources(undefined, staleKernel));
  assert.equal(state.continent.status, "ready");
  assert.deepEqual(state.currentInstance, { status: "unavailable", reason: "kernel" });
});

test("evidence remains exportable when only live classification is unavailable", () => {
  const current = sources(undefined, null);
  const state = readCartographyState(current);
  assert.equal(state.continent.status, "ready");
  assert.deepEqual(state.currentInstance, { status: "unavailable", reason: "kernel" });
  const evidence = captureCartographyEvidence(state, current);
  assert.equal(evidence.continent.status, "ready");
  assert.equal(evidence.currentInstance.status, "unavailable");
  if (evidence.currentInstance.status === "unavailable") {
    assert.equal(evidence.currentInstance.reason, "kernel");
  }
});

test("semantic bitsets are not interchangeable", () => {
  const state = readCartographyState(sources());
  assert.equal(state.currentInstance.status, "ready");
  if (state.currentInstance.status !== "ready") return;
  // @ts-expect-error A cell bitset cannot be supplied as a terrain raster.
  const terrain: typeof state.currentInstance.walkableTerrain = state.currentInstance.reachableCells;
  assert.notEqual(terrain, state.currentInstance.walkableTerrain);
  // @ts-expect-error Reachable input cannot masquerade as derived actionability.
  const actionable: typeof state.currentInstance.actionableCells = state.currentInstance.reachableCells;
  assert.notEqual(actionable, state.currentInstance.actionableCells);
});

test("refreshes frame-sensitive presentation without rerunning classification", () => {
  const state = readCartographyState(sources());
  assert.equal(state.currentInstance.status, "ready");
  const current = {
    ...sources(),
    companion: () => Object.freeze({ ...COMPANION, playerX: 99 }),
  };
  const presentation = readCartographyPresentation(state, current);
  assert.deepEqual(presentation.player, { x: 99, y: 20 });
});
