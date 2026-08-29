import assert from "node:assert/strict";
import test from "node:test";
import type { PathingSpikeTrapezoid } from "../../src/shared/cartography-spike.js";
import { createCartographyCellRevealability } from
  "../../src/renderer/cartography-spike/cell-revealability.js";

const CELL_MAP_UNITS = 32;
const CELL_GAME_UNITS = CELL_MAP_UNITS * 96;

function cellGeometry(x: number, y: number): PathingSpikeTrapezoid {
  const left = x * CELL_GAME_UNITS;
  const right = left + CELL_GAME_UNITS;
  const top = -y * CELL_GAME_UNITS;
  const bottom = top - CELL_GAME_UNITS;
  return Object.freeze({
    topLeftX: left,
    topRightX: right,
    topY: top,
    bottomLeftX: left,
    bottomRightX: right,
    bottomY: bottom,
  });
}

function input(
  geometry: readonly PathingSpikeTrapezoid[],
  overrides: Partial<Parameters<typeof createCartographyCellRevealability>[0]> = {},
): Parameters<typeof createCartographyCellRevealability>[0] {
  return {
    geometry,
    worldAnchorX: 0,
    worldAnchorY: 0,
    continent: 0,
    mapMinX: 179 * CELL_MAP_UNITS,
    mapMinY: 24 * CELL_MAP_UNITS,
    mapMaxX: 188 * CELL_MAP_UNITS,
    mapMaxY: 28 * CELL_MAP_UNITS,
    revealRadius: 1,
    ...overrides,
  };
}

test("combines exact current-map pathing with Toolbox++ creditable cells", () => {
  const revealability = createCartographyCellRevealability(input([
    cellGeometry(180, 25),
    cellGeometry(182, 25),
  ]));
  assert.ok(revealability);
  assert.equal(revealability.groundCellCount, 2);
  assert.equal(revealability.canCurrentMapReveal(180, 25), true);
  assert.equal(revealability.canCurrentMapReveal(181, 26), true);
  // This is a baked continent-0 creditable cell, but current pathing cannot
  // reach it with the normal 3x3 reveal range.
  assert.equal(revealability.canCurrentMapReveal(185, 25), false);
  assert.equal(revealability.canCurrentMapReveal(189, 25), null);
});

test("uses the certified world-map anchor instead of assuming a zero origin", () => {
  const revealability = createCartographyCellRevealability(input([
    cellGeometry(0, 0),
    cellGeometry(2, 2),
  ], {
    worldAnchorX: 320,
    worldAnchorY: 640,
    mapMinX: 9 * CELL_MAP_UNITS,
    mapMinY: 19 * CELL_MAP_UNITS,
    mapMaxX: 14 * CELL_MAP_UNITS,
    mapMaxY: 24 * CELL_MAP_UNITS,
  }));
  assert.ok(revealability);
  assert.equal(revealability.canCurrentMapReveal(10, 20), true);
  assert.equal(revealability.canCurrentMapReveal(11, 21), true);
  assert.equal(revealability.canCurrentMapReveal(14, 20), null);
});

test("does not index cells touched only by a trapezoid bounding box", () => {
  const revealability = createCartographyCellRevealability(input([{
    topLeftX: 180 * CELL_GAME_UNITS,
    topRightX: 180 * CELL_GAME_UNITS,
    topY: -25 * CELL_GAME_UNITS,
    bottomLeftX: 180 * CELL_GAME_UNITS,
    bottomRightX: 182 * CELL_GAME_UNITS,
    bottomY: -27 * CELL_GAME_UNITS,
  }]));
  assert.ok(revealability);
  assert.equal(revealability.groundCellCount, 3);
});

test("ignores duplicate overlaps and zero-area native seam records", () => {
  const valid = cellGeometry(180, 25);
  const revealability = createCartographyCellRevealability(input([
    { ...valid, bottomY: valid.topY },
    valid,
    valid,
  ]));
  assert.ok(revealability);
  assert.equal(revealability.groundCellCount, 1);
  assert.equal(revealability.canCurrentMapReveal(180, 25), true);
});

test("Bird's Eye expands current-map credit without changing map ownership", () => {
  const normal = createCartographyCellRevealability(input([cellGeometry(180, 25)]));
  const birdsEye = createCartographyCellRevealability(input(
    [cellGeometry(180, 25)],
    { revealRadius: 3 },
  ));
  assert.ok(normal);
  assert.ok(birdsEye);
  assert.notEqual(normal.canCurrentMapReveal(183, 25), true);
  assert.equal(birdsEye.canCurrentMapReveal(183, 25), true);
  assert.equal(birdsEye.canCurrentMapReveal(189, 25), null);
});

test("rejects incomplete certificates and non-finite geometry", () => {
  assert.equal(createCartographyCellRevealability(input([])), null);
  assert.equal(createCartographyCellRevealability(input(
    [{ ...cellGeometry(180, 25), topLeftX: Number.NaN }],
  )), null);
  assert.equal(createCartographyCellRevealability(input(
    [cellGeometry(180, 25)],
    { mapMaxX: 0 },
  )), null);
});
