import assert from "node:assert/strict";
import test from "node:test";
import {
  projectGamePointToMissionMap,
  projectMissionMapContentBox,
  projectTerrainToCompass,
  projectTerrainToMissionMap,
} from "../../src/renderer/cartography-spike/map-projections.js";

test("projects the certified Mission Map drawable area and player anchor", () => {
  const frame = Object.freeze({
    status: 1, generation: 1, frameId: 162, visible: true,
    viewportWidth: 846, viewportHeight: 596,
    left: 192, bottom: 258, right: 860, top: 626,
    projectionStatus: 1, projectionSequence: 1, projectionGeneration: 1,
    zoom: 1, panX: 4_666, panY: 4_317,
    drawableWidth: 640, drawableHeight: 322,
    playerMapX: 4_666, playerMapY: 4_317,
    nativeMapWidth: 640, nativeMapHeight: 322,
  });
  const content = projectMissionMapContentBox(
    frame,
    Object.freeze({ left: 100, top: 200, width: 668, height: 368 }),
  );
  assert.deepEqual(content, { left: 114, top: 230, width: 640, height: 322 });
  assert.deepEqual(
    projectGamePointToMissionMap(frame, content, 1_000, 2_000, 1_000, 2_000),
    { x: 320, y: 161 },
  );
  assert.deepEqual(
    projectGamePointToMissionMap(frame, content, 1_000, 2_000, 10_600, 11_600),
    { x: 420, y: 61 },
  );
});

test("projects one cached terrain raster through Compass rotation", () => {
  const projection = projectTerrainToCompass({
    box: { left: 10, top: 20, width: 245, height: 260 },
    terrain: {
      canvas: {} as HTMLCanvasElement,
      mapLeft: 0,
      mapTop: 100,
      mapUnitsPerPixel: 0.5,
    },
    playerMapX: 0,
    playerMapY: 0,
    directionX: 0,
    directionY: 1,
  });
  assert.ok(projection);
  assert.equal(projection.clip.kind, "circle");
  assert.ok(Math.abs(projection.transform.a - 0.9216) < 0.0001);
  assert.ok(Math.abs(projection.transform.b) === 0);
  assert.equal(projection.transform.c, 0);
  assert.ok(Math.abs(projection.transform.d - 0.9216) < 0.0001);
  assert.equal(projection.transform.e, 122.5);
  assert.ok(Math.abs(projection.transform.f - 306.82) < 0.001);

  const rotated = projectTerrainToCompass({
    box: { left: 10, top: 20, width: 245, height: 260 },
    terrain: projectionTerrain,
    playerMapX: 0,
    playerMapY: 0,
    directionX: 1,
    directionY: 0,
  });
  assert.ok(rotated);
  assert.ok(Math.abs(rotated.transform.a) === 0);
  assert.ok(rotated.transform.b < 0);
  assert.ok(rotated.transform.c > 0);
});

const projectionTerrain = {
  canvas: {} as HTMLCanvasElement,
  mapLeft: 0,
  mapTop: 100,
  mapUnitsPerPixel: 0.5,
};

test("projects the same cached terrain raster through Mission Map pan and zoom", () => {
  const frame = {
    status: 1, generation: 1, frameId: 162, visible: true,
    viewportWidth: 846, viewportHeight: 596,
    left: 192, bottom: 258, right: 860, top: 626,
    projectionStatus: 1, projectionSequence: 1, projectionGeneration: 1,
    zoom: 2, panX: 4_666, panY: 4_317,
    drawableWidth: 640, drawableHeight: 320,
    playerMapX: 4_666, playerMapY: 4_317,
    nativeMapWidth: 640, nativeMapHeight: 320,
  };
  const projection = projectTerrainToMissionMap({
    frame,
    box: { left: 50, top: 60, width: 640, height: 320 },
    terrain: projectionTerrain,
  });
  assert.ok(projection);
  assert.deepEqual(projection.transform, {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: -9012,
    f: -8274,
  });
});
