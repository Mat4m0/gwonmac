import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompassFrameSpikeReader,
  createMissionMapFrameSpikeReader,
  createWorldMapFrameSpikeReader,
} from "../../src/renderer/cartography-spike/frame-observer.js";
import {
  COMPASS_FRAME_SPIKE_GLOBALS,
  COMPASS_FRAME_SPIKE_SCALARS,
  MISSION_MAP_FRAME_SPIKE_GLOBALS,
  MISSION_MAP_FRAME_SPIKE_SCALARS,
  MISSION_MAP_PROJECTION_SPIKE_GLOBALS,
  MISSION_MAP_PROJECTION_SPIKE_SCALARS,
  WORLD_MAP_FRAME_SPIKE_GLOBALS,
  WORLD_MAP_FRAME_SPIKE_SCALARS,
} from "../../src/shared/cartography-spike.js";

function scalar(value: number, type: WebAssembly.ValueType = "i32"): WebAssembly.Global {
  return new WebAssembly.Global({ value: type, mutable: true }, value);
}

function completeExports(): WebAssembly.Exports {
  return {
    [COMPASS_FRAME_SPIKE_GLOBALS.status]: scalar(1),
    [COMPASS_FRAME_SPIKE_GLOBALS.generation]: scalar(4),
    [COMPASS_FRAME_SPIKE_GLOBALS.frameId]: scalar(512),
    [COMPASS_FRAME_SPIKE_GLOBALS.visible]: scalar(1),
    [COMPASS_FRAME_SPIKE_GLOBALS.cameraSequence]: scalar(27),
    [COMPASS_FRAME_SPIKE_GLOBALS.viewportWidth]: scalar(3024, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.viewportHeight]: scalar(1834, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.left]: scalar(2500, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.bottom]: scalar(1310, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.right]: scalar(3024, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.top]: scalar(1834, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionX]: scalar(0.25, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionY]: scalar(0.75, "f32"),
    [COMPASS_FRAME_SPIKE_GLOBALS.observe]: (() => undefined) as WebAssembly.ExportValue,
  };
}

test("keeps native frame scalar allocation order explicit", () => {
  assert.deepEqual(COMPASS_FRAME_SPIKE_SCALARS, [
    COMPASS_FRAME_SPIKE_GLOBALS.status,
    COMPASS_FRAME_SPIKE_GLOBALS.generation,
    COMPASS_FRAME_SPIKE_GLOBALS.frameId,
    COMPASS_FRAME_SPIKE_GLOBALS.visible,
    COMPASS_FRAME_SPIKE_GLOBALS.cameraSequence,
    COMPASS_FRAME_SPIKE_GLOBALS.viewportWidth,
    COMPASS_FRAME_SPIKE_GLOBALS.viewportHeight,
    COMPASS_FRAME_SPIKE_GLOBALS.left,
    COMPASS_FRAME_SPIKE_GLOBALS.bottom,
    COMPASS_FRAME_SPIKE_GLOBALS.right,
    COMPASS_FRAME_SPIKE_GLOBALS.top,
    COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionX,
    COMPASS_FRAME_SPIKE_GLOBALS.compassDirectionY,
  ]);
  assert.deepEqual(MISSION_MAP_FRAME_SPIKE_SCALARS, [
    MISSION_MAP_FRAME_SPIKE_GLOBALS.status,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.generation,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.frameId,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.visible,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportWidth,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportHeight,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.left,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.bottom,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.right,
    MISSION_MAP_FRAME_SPIKE_GLOBALS.top,
  ]);
  assert.deepEqual(MISSION_MAP_PROJECTION_SPIKE_SCALARS, [
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.status,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.sequence,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.generation,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.zoom,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panX,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panY,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableWidth,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableHeight,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapX,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapY,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapWidth,
    MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapHeight,
  ]);
});

test("reads only the certified Compass scalar surface", () => {
  const reader = createCompassFrameSpikeReader(completeExports());
  assert.ok(reader);
  assert.deepEqual(reader.snapshot(), {
    status: 1,
    generation: 4,
    frameId: 512,
    visible: true,
    cameraSequence: 27,
    viewportWidth: 3024,
    viewportHeight: 1834,
    left: 2500,
    bottom: 1310,
    right: 3024,
    top: 1834,
    compassDirectionX: 0.25,
    compassDirectionY: 0.75,
  });
});

test("refuses incomplete and non-finite Compass surfaces", () => {
  const incomplete = completeExports();
  delete incomplete[COMPASS_FRAME_SPIKE_GLOBALS.top];
  assert.equal(createCompassFrameSpikeReader(incomplete), null);

  const invalid = completeExports();
  invalid[COMPASS_FRAME_SPIKE_GLOBALS.left] = scalar(Number.NaN, "f32");
  assert.equal(createCompassFrameSpikeReader(invalid)?.snapshot(), null);

  const invalidVisibility = completeExports();
  invalidVisibility[COMPASS_FRAME_SPIKE_GLOBALS.visible] = scalar(2);
  assert.equal(createCompassFrameSpikeReader(invalidVisibility)?.snapshot(), null);

  const trapping = completeExports();
  trapping[COMPASS_FRAME_SPIKE_GLOBALS.observe] = (() => {
    throw new WebAssembly.RuntimeError("stale frame table");
  }) as WebAssembly.ExportValue;
  assert.equal(createCompassFrameSpikeReader(trapping)?.snapshot(), null);
});

test("reads the Mission Map through the same closed frame boundary", () => {
  const exports: WebAssembly.Exports = {
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.status]: scalar(1),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.generation]: scalar(5),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.frameId]: scalar(14),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.visible]: scalar(1),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportWidth]: scalar(885.5, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportHeight]: scalar(636.25, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.left]: scalar(341.5, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.bottom]: scalar(205.25, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.right]: scalar(899.5, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.top]: scalar(666.25, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.observe]: (() => undefined) as WebAssembly.ExportValue,
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.status]: scalar(1),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.sequence]: scalar(91),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.generation]: scalar(5),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.zoom]: scalar(2.25, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panX]: scalar(-123.5, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panY]: scalar(456.25, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableWidth]: scalar(558, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableHeight]: scalar(461, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapX]: scalar(200, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapY]: scalar(300, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapWidth]: scalar(1024, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapHeight]: scalar(768, "f32"),
  };
  assert.deepEqual(createMissionMapFrameSpikeReader(exports)?.snapshot(), {
    status: 1,
    generation: 5,
    frameId: 14,
    visible: true,
    viewportWidth: 885.5,
    viewportHeight: 636.25,
    left: 341.5,
    bottom: 205.25,
    right: 899.5,
    top: 666.25,
    projectionStatus: 1,
    projectionSequence: 91,
    projectionGeneration: 5,
    zoom: 2.25,
    panX: -123.5,
    panY: 456.25,
    drawableWidth: 558,
    drawableHeight: 461,
    playerMapX: 200,
    playerMapY: 300,
    nativeMapWidth: 1024,
    nativeMapHeight: 768,
  });
});

test("refuses incomplete, stale, and invalid Mission Map projection state", () => {
  const projectionExports = (): WebAssembly.Exports => ({
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.status]: scalar(1),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.generation]: scalar(5),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.frameId]: scalar(14),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.visible]: scalar(1),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportWidth]: scalar(885.5, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.viewportHeight]: scalar(636.25, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.left]: scalar(341.5, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.bottom]: scalar(205.25, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.right]: scalar(899.5, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.top]: scalar(666.25, "f32"),
    [MISSION_MAP_FRAME_SPIKE_GLOBALS.observe]: (() => undefined) as WebAssembly.ExportValue,
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.status]: scalar(1),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.sequence]: scalar(91),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.generation]: scalar(5),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.zoom]: scalar(2.25, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panX]: scalar(-123.5, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panY]: scalar(456.25, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableWidth]: scalar(558, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.drawableHeight]: scalar(461, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapX]: scalar(200, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.playerMapY]: scalar(300, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapWidth]: scalar(1024, "f32"),
    [MISSION_MAP_PROJECTION_SPIKE_GLOBALS.nativeMapHeight]: scalar(768, "f32"),
  });

  const incomplete = projectionExports();
  delete incomplete[MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panY];
  assert.equal(createMissionMapFrameSpikeReader(incomplete), null);

  const stale = projectionExports();
  stale[MISSION_MAP_PROJECTION_SPIKE_GLOBALS.generation] = scalar(4);
  assert.equal(createMissionMapFrameSpikeReader(stale)?.snapshot(), null);

  const invalidZoom = projectionExports();
  invalidZoom[MISSION_MAP_PROJECTION_SPIKE_GLOBALS.zoom] = scalar(4, "f32");
  assert.equal(createMissionMapFrameSpikeReader(invalidZoom)?.snapshot(), null);

  const invalidPan = projectionExports();
  invalidPan[MISSION_MAP_PROJECTION_SPIKE_GLOBALS.panX] = scalar(Number.NaN, "f32");
  assert.equal(createMissionMapFrameSpikeReader(invalidPan)?.snapshot(), null);
});

function worldMapExports(): WebAssembly.Exports {
  const values = [1, 12, 5, 200, 1, 1_920, 1_080, 0, 0, 1_920, 1_080, 0, 0, 0, 0, 8_192, 16_384];
  return {
    ...Object.fromEntries(WORLD_MAP_FRAME_SPIKE_SCALARS.map((name, index) => [
      name,
      scalar(values[index]!, index < 5 || index === 11 ? "i32" : "f32"),
    ])),
    [WORLD_MAP_FRAME_SPIKE_GLOBALS.observe]: () => undefined,
  };
}

test("reads the dedicated World Map context atomically", () => {
  assert.deepEqual(createWorldMapFrameSpikeReader(worldMapExports())?.snapshot(), {
    status: 1,
    sequence: 12,
    generation: 5,
    frameId: 200,
    visible: true,
    viewportWidth: 1_920,
    viewportHeight: 1_080,
    left: 0,
    bottom: 0,
    right: 1_920,
    top: 1_080,
    continent: 0,
    zoom: 0,
    topLeftX: 0,
    topLeftY: 0,
    bottomRightX: 8_192,
    bottomRightY: 16_384,
  });
  const invalid = worldMapExports();
  invalid[WORLD_MAP_FRAME_SPIKE_GLOBALS.bottomRightX] = scalar(0, "f32");
  assert.equal(createWorldMapFrameSpikeReader(invalid)?.snapshot(), null);
});

test("refreshes World Map visibility before every snapshot", () => {
  const exports = worldMapExports();
  exports[WORLD_MAP_FRAME_SPIKE_GLOBALS.observe] = () => {
    (exports[WORLD_MAP_FRAME_SPIKE_GLOBALS.visible] as WebAssembly.Global).value = 0;
  };
  assert.equal(createWorldMapFrameSpikeReader(exports)?.snapshot(), null);
});
