import assert from "node:assert/strict";
import test from "node:test";
import { CARTOGRAPHY_UNSEEN_MARKERS } from "../../src/shared/cartography-overlay.js";
import {
  cartographyLineDash,
  cartographyHoverRevealRadius,
  drawUnseenCellMarker,
  strokeCasedPath,
  type CellCorners,
} from "../../src/renderer/cartography-spike/cartography-paint.js";

class RecordingContext {
  readonly strokes: Readonly<{ color: unknown; width: number; dash: readonly number[] }>[] = [];
  readonly operations: string[] = [];
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineJoin: CanvasLineJoin = "miter";
  lineCap: CanvasLineCap = "butt";
  globalAlpha = 1;
  private dash: number[] = [];

  save(): void { this.operations.push("save"); }
  restore(): void { this.operations.push("restore"); }
  setLineDash(value: number[]): void { this.dash = [...value]; }
  stroke(): void {
    this.operations.push("stroke");
    this.strokes.push({ color: this.strokeStyle, width: this.lineWidth, dash: [...this.dash] });
  }
  fill(): void { this.operations.push("fill"); }
  beginPath(): void { this.operations.push("beginPath"); }
  closePath(): void { this.operations.push("closePath"); }
  moveTo(): void { this.operations.push("moveTo"); }
  lineTo(): void { this.operations.push("lineTo"); }
  arc(): void { this.operations.push("arc"); }
}

const corners: CellCorners = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 },
];

test("cartography line patterns have distinct deterministic dash semantics", () => {
  assert.deepEqual(cartographyLineDash("solid", 2), []);
  assert.deepEqual(cartographyLineDash("dashed", 2), [12, 8]);
  assert.deepEqual(cartographyLineDash("dotted", 2), [2, 6]);
  assert.deepEqual(cartographyLineDash("dash-dot", 2), [12, 6, 2, 6]);
});

test("cased lines draw casing first and preserve the semantic pattern", () => {
  const recording = new RecordingContext();
  strokeCasedPath(
    recording as unknown as CanvasRenderingContext2D,
    { color: "#FFFFFF", width: 2, pattern: "dash-dot" },
    "#000000",
    0.8,
  );
  assert.deepEqual(recording.strokes, [
    { color: "#000000", width: 4, dash: [12, 6, 2, 6] },
    { color: "#FFFFFF", width: 2, dash: [12, 6, 2, 6] },
  ]);
});

test("every supported unseen-cell marker has a visible canonical treatment", () => {
  for (const marker of CARTOGRAPHY_UNSEEN_MARKERS) {
    const recording = new RecordingContext();
    drawUnseenCellMarker(
      recording as unknown as CanvasRenderingContext2D,
      marker,
      corners,
      "#E69F00",
      "#050709",
      1,
      40,
    );
    if (marker === "stipple") {
      assert.equal(recording.operations.filter((value) => value === "fill").length, 10);
    } else {
      assert.equal(recording.strokes.length, 2, `${marker} must use one cased path`);
      assert.ok(recording.operations.includes("lineTo"), `${marker} must contain linework`);
    }
  }
});

test("mission-map hover range is dormant until Shift is held", () => {
  assert.equal(cartographyHoverRevealRadius(false, false), 0);
  assert.equal(cartographyHoverRevealRadius(false, true), 0);
  assert.equal(cartographyHoverRevealRadius(true, false), 1);
  assert.equal(cartographyHoverRevealRadius(true, true), 3);
});
