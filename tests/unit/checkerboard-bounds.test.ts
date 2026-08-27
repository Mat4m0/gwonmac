import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeCheckerboardBounds } from "../../scripts/enhancements-live/checkerboard-bounds.ts";

function image(width: number, height: number) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function fillRect(
  target: ReturnType<typeof image>,
  bounds: { left: number; top: number; right: number; bottom: number },
  colors: readonly [readonly number[], readonly number[]],
) {
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (y * target.width + x) * 4;
      const color = colors[(x + y) % 2]!;
      target.data.set([...color, 255], offset);
    }
  }
}

describe("checkerboard screenshot bounds", () => {
  it("returns only scalar dense bounds for each proof palette", () => {
    const target = image(50, 30);
    fillRect(target, { left: 3, top: 4, right: 23, bottom: 20 }, [[255, 0, 255], [0, 255, 255]]);
    fillRect(target, { left: 30, top: 6, right: 48, bottom: 24 }, [[255, 255, 0], [0, 64, 255]]);
    target.data.set([255, 0, 255, 255], 0);

    assert.deepEqual(analyzeCheckerboardBounds(target), [
      {
        palette: "magenta-cyan",
        pixels: 320,
        firstColorPixels: 160,
        secondColorPixels: 160,
        bounds: { left: 3, top: 4, right: 23, bottom: 20 },
      },
      {
        palette: "yellow-blue",
        pixels: 324,
        firstColorPixels: 162,
        secondColorPixels: 162,
        bounds: { left: 30, top: 6, right: 48, bottom: 24 },
      },
    ]);
  });

  it("refuses malformed images and color noise", () => {
    assert.deepEqual(analyzeCheckerboardBounds({ width: 2, height: 2, data: new Uint8Array(3) }), []);
    const target = image(40, 20);
    fillRect(target, { left: 2, top: 2, right: 10, bottom: 10 }, [[255, 0, 255], [0, 255, 255]]);
    assert.deepEqual(analyzeCheckerboardBounds(target), []);
  });
});
