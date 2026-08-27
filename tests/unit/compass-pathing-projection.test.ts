import assert from "node:assert/strict";
import test from "node:test";
import {
  clipSegmentToCircle,
  projectCompassPathing,
  type CompassCalibration,
  type CompassFrameObservation,
  type PathingObservation,
} from "../../src/renderer/compass-pathing-projection.js";

const calibration: CompassCalibration = Object.freeze({
  status: "proven",
  orientation: "north-up",
  worldUnitsPerPixel: 1,
});

const frame = (overrides: Partial<Extract<CompassFrameObservation, { status: "ready" }>> = {}) => Object.freeze({
  status: "ready" as const,
  generation: 7,
  frameId: 42,
  visible: true,
  viewportWidth: 800,
  viewportHeight: 600,
  left: 600,
  bottom: 400,
  right: 800,
  top: 600,
  ...overrides,
});

const pathing = (overrides: Partial<Extract<PathingObservation, { status: "ready" }>> = {}) => Object.freeze({
  status: "ready" as const,
  generation: 7,
  playerX: 0,
  playerY: 0,
  trapezoids: Object.freeze([Object.freeze({
    topLeftX: -150,
    topRightX: 150,
    bottomLeftX: -150,
    bottomRightX: 150,
    topY: 10,
    bottomY: -10,
  })]),
  ...overrides,
});

const canvas = (
  left = 0,
  top = 0,
  width = 800,
  height = 600,
) => ({
  getBoundingClientRect: () => ({ left, top, width, height }),
}) as HTMLCanvasElement;

test("clips crossing boundary segments exactly to the Compass circle", () => {
  assert.deepEqual(
    clipSegmentToCircle(
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 0 },
      1,
    ),
    [{ x: -1, y: 0 }, { x: 1, y: 0 }],
  );
  assert.equal(
    clipSegmentToCircle(
      { x: -2, y: 2 },
      { x: 2, y: 2 },
      { x: 0, y: 0 },
      1,
    ),
    null,
  );
});

test("projects north-up geometry at 1x, 1.5x, and 2x canvas scales", () => {
  for (const scale of [1, 1.5, 2]) {
    const projected = projectCompassPathing(
      frame(),
      pathing(),
      calibration,
      canvas(10, 20, 800 * scale, 600 * scale),
    );
    assert.ok(projected);
    assert.deepEqual(projected.circle, {
      centerX: 10 + 700 * scale,
      centerY: 20 + 100 * scale,
      radius: 100 * scale,
    });
    assert.ok(projected.lines.length > 0);
    for (const line of projected.lines) {
      for (const [x, y] of [
        [line.x1, line.y1], [line.x2, line.y2],
      ] as const) {
        const dx = x - projected.circle.centerX;
        const dy = y - projected.circle.centerY;
        assert.ok(Math.hypot(dx, dy) <= projected.circle.radius + 0.000_001);
      }
    }
  }
});

test("resize and native Compass relocation derive a fresh placement", () => {
  const initial = projectCompassPathing(frame(), pathing(), calibration, canvas());
  const moved = projectCompassPathing(
    frame({ left: 500, right: 700 }),
    pathing(),
    calibration,
    canvas(25, 40, 1_600, 1_200),
  );
  assert.ok(initial && moved);
  assert.deepEqual(initial.circle, { centerX: 700, centerY: 100, radius: 100 });
  assert.deepEqual(moved.circle, { centerX: 1_225, centerY: 240, radius: 200 });
});

test("loading, hidden, stale, malformed, unsupported, and uncertain states hide everything", () => {
  const cases: readonly [CompassFrameObservation, PathingObservation, CompassCalibration][] = [
    [{ status: "waiting", reason: "loading" }, pathing(), calibration],
    [frame({ visible: false }), pathing(), calibration],
    [frame(), pathing({ generation: 8 }), calibration],
    [frame({ right: Number.NaN }), pathing(), calibration],
    [frame(), pathing({ trapezoids: [] }), calibration],
    [frame(), pathing({ trapezoids: [{
      topLeftX: 10, topRightX: -10, bottomLeftX: 0,
      bottomRightX: 1, topY: 1, bottomY: 0,
    }] }), calibration],
    [frame(), pathing(), { status: "uncertain", reason: "not-calibrated" }],
  ];
  for (const [candidateFrame, candidatePathing, candidateCalibration] of cases) {
    assert.equal(
      projectCompassPathing(
        candidateFrame,
        candidatePathing,
        candidateCalibration,
        canvas(),
      ),
      null,
    );
  }
  assert.equal(
    projectCompassPathing(frame(), pathing(), calibration, canvas(0, 0, 800, 500)),
    null,
    "a distorted canvas cannot silently become a different Compass scale",
  );
});
