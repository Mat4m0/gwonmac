/** Checks stable corner offsets shared by chat and alcohol overlays. */
import assert from "node:assert/strict";
import test from "node:test";
import { captureCornerPosition, restoreCornerPosition } from "../../src/shared/corner-position.ts";

const viewport = { width: 1000, height: 800, margin: 0 };
const size = { width: 64, height: 26 };
test("each nearest corner keeps its pixel gaps when the viewport grows", () => {
  for (const [corner, left, top, grownLeft, grownTop] of [
    ["top-left", 8, 12, 8, 12], ["top-right", 928, 12, 1428, 12],
    ["bottom-left", 8, 762, 8, 262], ["bottom-right", 928, 762, 1428, 262],
  ] as const) {
    const saved = captureCornerPosition({ left, top }, viewport, size)!;
    assert.deepEqual(saved, { corner, x: 8, y: 12 });
    assert.deepEqual(restoreCornerPosition(saved, { ...viewport, width: 1500, height: 300 }, size),
      { left: grownLeft, top: grownTop });
  }
});
test("clamping a small viewport does not discard the saved gap", () => {
  const saved = { corner: "bottom-right", x: 200, y: 100 } as const;
  assert.deepEqual(restoreCornerPosition(saved, { width: 100, height: 50, margin: 0 }, size), { left: 0, top: 0 });
  assert.deepEqual(restoreCornerPosition(saved, viewport, size), { left: 736, top: 674 });
  assert.deepEqual(captureCornerPosition({ left: -50, top: 900 }, viewport, size), { corner: "bottom-left", x: 0, y: 0 });
  assert.equal(restoreCornerPosition(saved, { ...viewport, width: 0 }, size), null);
});
