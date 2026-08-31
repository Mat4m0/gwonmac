import assert from "node:assert/strict";
import test from "node:test";
import type {
  CompassFrameSpikeSnapshot,
  MissionMapFrameSpikeSnapshot,
  WorldMapFrameSpikeSnapshot,
} from "../../src/shared/cartography-spike.js";
import {
  cartographyCellPixelSize,
  CARTOGRAPHY_CELL_MAP_UNITS,
  cartographyCellAt,
  cartographyCellAtScreenPoint,
  projectCartographyGridToCompass,
  projectCartographyGridToMissionMap,
  projectCartographyGridToWorldMap,
} from "../../src/renderer/cartography-spike/cartography-grid-projection.js";
import {
  cartographyClusterPresentation,
  cartographyProgressClusterOrigin,
  cartographyProgressClusterSize,
} from "../../src/renderer/cartography-spike/cartography-grid-layer.js";

test("lets proven map knowledge replace a larger continent estimate", () => {
  assert.deepEqual(cartographyClusterPresentation({
    estimatedRemaining: 12,
    currentKnown: 8,
    currentRemaining: 2,
    rememberedKnown: 0,
    rememberedRemaining: 0,
  }), { count: 2, actionable: true });
  assert.equal(cartographyClusterPresentation({
    estimatedRemaining: 10,
    currentKnown: 8,
    currentRemaining: 0,
    rememberedKnown: 0,
    rememberedRemaining: 0,
  }), null);
  assert.deepEqual(cartographyClusterPresentation({
    estimatedRemaining: 12,
    currentKnown: 0,
    currentRemaining: 0,
    rememberedKnown: 8,
    rememberedRemaining: 2,
  }), { count: 2, actionable: false });
  assert.equal(cartographyClusterPresentation({
    estimatedRemaining: 10,
    currentKnown: 0,
    currentRemaining: 0,
    rememberedKnown: 8,
    rememberedRemaining: 0,
  }), null);
  assert.deepEqual(cartographyClusterPresentation({
    estimatedRemaining: 12,
    currentKnown: 0,
    currentRemaining: 0,
    rememberedKnown: 0,
    rememberedRemaining: 0,
  }), { count: 12, actionable: false });
});

const missionFrame: MissionMapFrameSpikeSnapshot = Object.freeze({
  status: 1,
  generation: 7,
  frameId: 162,
  visible: true,
  viewportWidth: 1_200,
  viewportHeight: 800,
  left: 100,
  bottom: 100,
  right: 740,
  top: 500,
  projectionStatus: 1,
  projectionSequence: 4,
  projectionGeneration: 7,
  zoom: 1,
  panX: 4_666,
  panY: 4_317,
  drawableWidth: 640,
  drawableHeight: 320,
  playerMapX: 4_666,
  playerMapY: 4_317,
  nativeMapWidth: 640,
  nativeMapHeight: 320,
});

const compassFrame: CompassFrameSpikeSnapshot = Object.freeze({
  status: 1,
  generation: 7,
  frameId: 24,
  visible: true,
  cameraSequence: 9,
  viewportWidth: 1_200,
  viewportHeight: 800,
  left: 900,
  bottom: 500,
  right: 1_145,
  top: 760,
  compassDirectionX: 0,
  compassDirectionY: 1,
});

const worldFrame: WorldMapFrameSpikeSnapshot = Object.freeze({
  status: 1,
  sequence: 11,
  generation: 7,
  frameId: 200,
  visible: true,
  viewportWidth: 1_200,
  viewportHeight: 800,
  left: 0,
  bottom: 0,
  right: 1_200,
  top: 800,
  continent: 0,
  zoom: 0,
  topLeftX: 0,
  topLeftY: 0,
  bottomRightX: 8_192,
  bottomRightY: 16_384,
});

test("matches the client's half-open cartography cell ownership", () => {
  const epsilon = 1 / 64;
  assert.deepEqual(cartographyCellAt(0, 0), { x: 0, y: -1 });
  assert.deepEqual(cartographyCellAt(32 - epsilon - 0.001, 0), { x: 0, y: -1 });
  assert.deepEqual(cartographyCellAt(32 - epsilon, 0), { x: 1, y: -1 });
  assert.deepEqual(cartographyCellAt(0, epsilon), { x: 0, y: -1 });
  assert.deepEqual(cartographyCellAt(0, epsilon + 0.001), { x: 0, y: 0 });
  assert.equal(cartographyCellAt(Number.NaN, 0), null);
});

test("keeps progress cluster boundaries fixed through pan and zoom", () => {
  assert.equal(cartographyProgressClusterSize(18), 1);
  assert.equal(cartographyProgressClusterSize(17.99), 4);
  assert.equal(cartographyProgressClusterSize(8), 4);
  assert.equal(cartographyProgressClusterSize(7.99), 16);
  assert.deepEqual(cartographyProgressClusterOrigin({ x: 17, y: -1 }, 16), {
    x: 16,
    y: -16,
  });
  assert.deepEqual(cartographyProgressClusterOrigin({ x: 31, y: -15 }, 16), {
    x: 16,
    y: -16,
  });
});

test("projects a fixed Mission Map grid through pan and zoom", () => {
  const box = Object.freeze({ left: 100, top: 200, width: 640, height: 320 });
  const projection = projectCartographyGridToMissionMap({ frame: missionFrame, box });
  assert.ok(projection);
  assert.equal(projection.surface, "mission-map");
  assert.deepEqual(projection.currentCell, cartographyCellAt(4_666, 4_317));
  assert.equal(projection.transform.a, 1);
  assert.equal(projection.transform.d, 1);
  assert.equal(
    Math.hypot(projection.transform.a, projection.transform.b)
      * CARTOGRAPHY_CELL_MAP_UNITS,
    32,
  );

  const zoomed = projectCartographyGridToMissionMap({
    frame: { ...missionFrame, zoom: 2, panX: 4_700 },
    box,
  });
  assert.ok(zoomed);
  assert.equal(zoomed.transform.a, 2);
  assert.equal(zoomed.transform.d, 2);
  assert.notEqual(zoomed.transform.e, projection.transform.e);
  assert.equal(
    Math.hypot(zoomed.transform.a, zoomed.transform.b)
      * CARTOGRAPHY_CELL_MAP_UNITS,
    64,
  );
  assert.equal(cartographyCellPixelSize(zoomed), 64);

});

test("projects the dedicated World Map context across the full continent", () => {
  const box = Object.freeze({ left: 0, top: 0, width: 800, height: 800 });
  const projection = projectCartographyGridToWorldMap({ frame: worldFrame, box });
  assert.ok(projection);
  assert.equal(projection.surface, "world-map");
  assert.equal(projection.firstCellX, -1);
  assert.equal(projection.lastCellX, 257);
  assert.equal(projection.firstCellY, -1);
  assert.equal(projection.lastCellY, 513);
  assert.deepEqual(
    cartographyCellAtScreenPoint(projection, 400, 400),
    cartographyCellAt(4_096, 8_192),
  );
  const panned = projectCartographyGridToWorldMap({
    frame: { ...worldFrame, zoom: 1, topLeftX: 2_048, bottomRightX: 6_144 },
    box,
  });
  assert.ok(panned);
  assert.equal(panned.transform.a, projection.transform.a * 2);
  assert.notEqual(panned.transform.e, projection.transform.e);
});

test("rescales Mission Map cells from the current drawable rectangle", () => {
  const regular = projectCartographyGridToMissionMap({
    frame: missionFrame,
    box: { left: 0, top: 0, width: 640, height: 320 },
  });
  const resized = projectCartographyGridToMissionMap({
    frame: missionFrame,
    box: { left: 0, top: 0, width: 960, height: 480 },
  });
  assert.ok(regular);
  assert.ok(resized);
  assert.equal(resized.transform.a, regular.transform.a * 1.5);
  assert.equal(resized.transform.d, regular.transform.d * 1.5);
});

test("resolves passive Mission Map hovers through pan and zoom", () => {
  const box = Object.freeze({ left: 100, top: 200, width: 640, height: 320 });
  const projection = projectCartographyGridToMissionMap({ frame: missionFrame, box });
  assert.ok(projection);
  assert.deepEqual(
    cartographyCellAtScreenPoint(projection, box.left + 320, box.top + 160),
    cartographyCellAt(missionFrame.panX, missionFrame.panY),
  );
  assert.equal(cartographyCellAtScreenPoint(projection, box.left - 1, box.top + 160), null);
  assert.equal(cartographyCellAtScreenPoint(projection, box.left + 640, box.top + 160), null);

  const compass = projectCartographyGridToCompass({
    frame: missionFrame,
    compass: compassFrame,
    box: { left: 0, top: 0, width: 245, height: 260 },
  });
  assert.ok(compass);
  assert.equal(cartographyCellAtScreenPoint(compass, 100, 100), null);
});

test("keeps the absolute cell phase while the Compass rotates", () => {
  const box = Object.freeze({ left: 900, top: 20, width: 245, height: 260 });
  const northUp = projectCartographyGridToCompass({
    frame: missionFrame,
    compass: compassFrame,
    box,
  });
  assert.ok(northUp);
  assert.equal(northUp.surface, "compass");
  assert.equal(northUp.clip.kind, "circle");
  assert.ok(Math.abs(northUp.transform.a - 1.8432) < 0.0001);
  assert.equal(Math.abs(northUp.transform.b), 0);
  assert.equal(northUp.transform.c, 0);
  assert.ok(Math.abs(northUp.transform.d - 1.8432) < 0.0001);

  const rotated = projectCartographyGridToCompass({
    frame: missionFrame,
    compass: { ...compassFrame, compassDirectionX: 1, compassDirectionY: 0 },
    box,
  });
  assert.ok(rotated);
  assert.equal(Math.abs(rotated.transform.a), 0);
  assert.ok(rotated.transform.b < 0);
  assert.ok(rotated.transform.c > 0);
  assert.equal(Math.abs(rotated.transform.d), 0);

  const mapX = missionFrame.playerMapX;
  const mapY = missionFrame.playerMapY;
  const northPlayerX = northUp.transform.a * mapX
    + northUp.transform.c * mapY + northUp.transform.e;
  const northPlayerY = northUp.transform.b * mapX
    + northUp.transform.d * mapY + northUp.transform.f;
  const rotatedPlayerX = rotated.transform.a * mapX
    + rotated.transform.c * mapY + rotated.transform.e;
  const rotatedPlayerY = rotated.transform.b * mapX
    + rotated.transform.d * mapY + rotated.transform.f;
  assert.ok(Math.abs(northPlayerX - 122.5) < 0.0001);
  assert.ok(Math.abs(northPlayerY - 122.5) < 0.0001);
  assert.ok(Math.abs(rotatedPlayerX - 122.5) < 0.0001);
  assert.ok(Math.abs(rotatedPlayerY - 122.5) < 0.0001);
});

test("updates the highlighted cell only after crossing a certified edge", () => {
  const before = projectCartographyGridToCompass({
    frame: { ...missionFrame, playerMapX: 31.98, playerMapY: 0 },
    compass: compassFrame,
    box: { left: 0, top: 0, width: 245, height: 260 },
  });
  const after = projectCartographyGridToCompass({
    frame: { ...missionFrame, playerMapX: 32, playerMapY: 0 },
    compass: compassFrame,
    box: { left: 0, top: 0, width: 245, height: 260 },
  });
  assert.ok(before);
  assert.ok(after);
  assert.equal(before.currentCell.x, 0);
  assert.equal(after.currentCell.x, 1);
});

test("refuses stale, hidden, malformed, and excessive projections", () => {
  const missionBox = { left: 0, top: 0, width: 640, height: 320 };
  const compassBox = { left: 0, top: 0, width: 245, height: 260 };
  assert.equal(projectCartographyGridToMissionMap({
    frame: { ...missionFrame, projectionGeneration: 6 },
    box: missionBox,
  }), null);
  assert.equal(projectCartographyGridToMissionMap({
    frame: { ...missionFrame, status: 0 },
    box: missionBox,
  }), null);
  assert.equal(projectCartographyGridToMissionMap({
    frame: { ...missionFrame, visible: false },
    box: missionBox,
  }), null);
  assert.equal(projectCartographyGridToMissionMap({
    frame: { ...missionFrame, zoom: 0.01 },
    box: missionBox,
  }), null, "more than 128 visible cells per axis must fail closed");
  assert.equal(projectCartographyGridToCompass({
    frame: missionFrame,
    compass: { ...compassFrame, generation: 8 },
    box: compassBox,
  }), null);
  assert.equal(projectCartographyGridToCompass({
    frame: missionFrame,
    compass: { ...compassFrame, compassDirectionX: 0, compassDirectionY: 0 },
    box: compassBox,
  }), null);
  assert.equal(projectCartographyGridToCompass({
    frame: missionFrame,
    compass: { ...compassFrame, visible: false },
    box: compassBox,
  }), null);
  assert.equal(projectCartographyGridToCompass({
    frame: missionFrame,
    compass: { ...compassFrame, status: 0 },
    box: compassBox,
  }), null);
});
