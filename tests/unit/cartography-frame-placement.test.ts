import assert from "node:assert/strict";
import test from "node:test";
import { projectMissionMapFrame, projectNativeFrame } from
  "../../src/renderer/cartography-spike/frame-placement.js";

const canvas = Object.freeze({ left: 0, top: 0, width: 1_512, height: 917 });
const missionMap = Object.freeze({
  status: 1,
  generation: 2,
  frameId: 14,
  visible: true,
  viewportWidth: 885.5,
  viewportHeight: 636.4,
  left: 341.5,
  bottom: 205.4,
  right: 899.5,
  top: 666.4,
});

test("projects Mission Map screen edges through the global game viewport", () => {
  const box = projectNativeFrame(missionMap, canvas, {
    width: 1_251,
    height: 758.9,
  });
  assert.ok(box);
  assert.ok(Math.abs(box.left - 412.75) < 0.1);
  assert.ok(Math.abs(box.width - 674.44) < 0.1);
});

test("movement, map resize, and game-window resize derive a fresh box", () => {
  const moved = projectNativeFrame({
    ...missionMap,
    left: 114.75,
    right: 514.69,
    bottom: 268.27,
    top: 562.1,
  }, { ...canvas, width: 1_153, height: 798 }, {
    width: 954,
    height: 660.4,
  });
  assert.ok(moved);
  assert.ok(Math.abs(moved.left - 138.66) < 0.1);
  assert.ok(Math.abs(moved.width - 483.31) < 0.1);
});

test("hidden, stale, malformed, and locally bounded Mission Map frames fail closed", () => {
  assert.equal(projectNativeFrame({ ...missionMap, visible: false }, canvas), null);
  assert.equal(projectNativeFrame({ ...missionMap, generation: 0 }, canvas), null);
  assert.equal(projectNativeFrame({ ...missionMap, left: Number.NaN }, canvas), null);
  assert.equal(projectNativeFrame(missionMap, canvas), null);
});

test("Mission Map projection refuses a mismatched map generation", () => {
  const compass = Object.freeze({
    ...missionMap,
    generation: 3,
    cameraSequence: 1,
    compassDirectionX: 0,
    compassDirectionY: 1,
    viewportWidth: 1_251,
    viewportHeight: 758.9,
  });
  assert.equal(projectMissionMapFrame(missionMap, compass, canvas), null);
  assert.ok(projectMissionMapFrame(missionMap, { ...compass, generation: 2 }, canvas));
});
