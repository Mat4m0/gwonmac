import assert from "node:assert/strict";
import test from "node:test";
import type {
  CompassFrameSpikeSnapshot,
  MissionMapFrameSpikeSnapshot,
} from "../../src/shared/cartography-spike.js";
import {
  advanceCartographyGridAnchor,
  CARTOGRAPHY_CELL_MAP_UNITS,
  cartographyCellAt,
  createCartographyGridAnchor,
  projectCartographyGridToCompass,
  projectCartographyGridToMissionMap,
} from "../../src/renderer/cartography-spike/cartography-grid-projection.js";

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

test("matches the client's half-open cartography cell ownership", () => {
  const epsilon = 1 / 64;
  assert.deepEqual(cartographyCellAt(0, 0), { x: 0, y: -1 });
  assert.deepEqual(cartographyCellAt(32 - epsilon - 0.001, 0), { x: 0, y: -1 });
  assert.deepEqual(cartographyCellAt(32 - epsilon, 0), { x: 1, y: -1 });
  assert.deepEqual(cartographyCellAt(0, epsilon), { x: 0, y: -1 });
  assert.deepEqual(cartographyCellAt(0, epsilon + 0.001), { x: 0, y: 0 });
  assert.equal(cartographyCellAt(Number.NaN, 0), null);
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

test("keeps Compass grid phase while the Mission Map is closed", () => {
  const anchor = createCartographyGridAnchor({
    frame: missionFrame,
    playerX: 9_600,
    playerY: 19_200,
  });
  assert.ok(anchor);
  const advanced = advanceCartographyGridAnchor(anchor, {
    generation: missionFrame.generation,
    playerX: 12_672,
    playerY: 16_128,
  });
  assert.ok(advanced);
  assert.equal(advanced.playerMapX, missionFrame.playerMapX + 32);
  assert.equal(advanced.playerMapY, missionFrame.playerMapY + 32);
  assert.ok(projectCartographyGridToCompass({
    frame: advanced,
    compass: compassFrame,
    box: { left: 0, top: 0, width: 245, height: 260 },
  }));
});

test("rejects a cached Compass grid anchor after a map transition", () => {
  const anchor = createCartographyGridAnchor({
    frame: missionFrame,
    playerX: 9_600,
    playerY: 19_200,
  });
  assert.ok(anchor);
  assert.equal(advanceCartographyGridAnchor(anchor, {
    generation: missionFrame.generation + 1,
    playerX: 9_600,
    playerY: 19_200,
  }), null);
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
