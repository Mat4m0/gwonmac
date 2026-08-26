/** Unit coverage for normalized floating-window persistence and validation. */
import { describe, expect, it } from "vitest";
import {
  restoreFloatingWindowPlacement,
  serializeFloatingWindowPlacement,
} from "./floating-window-placement";

const viewport = { width: 1_600, height: 1_000, margin: 32 };
const minimum = { width: 520, height: 400 };

describe("floating window placement", () => {
  it("round-trips a window in the same viewport", () => {
    const box = { left: 200, top: 100, width: 900, height: 600 };

    expect(restoreFloatingWindowPlacement(
      serializeFloatingWindowPlacement(box, viewport),
      viewport,
      minimum,
    )).toEqual(box);
  });

  it("preserves relative size and position when the viewport changes", () => {
    const stored = serializeFloatingWindowPlacement(
      { left: 416, top: 266, width: 768, height: 468 },
      viewport,
    );

    expect(restoreFloatingWindowPlacement(
      stored,
      { width: 2_368, height: 1_452, margin: 32 },
      minimum,
    )).toEqual({ left: 608, top: 379, width: 1_152, height: 694 });
  });

  it("clamps a restored window into a smaller viewport", () => {
    const stored = serializeFloatingWindowPlacement(
      { left: 900, top: 500, width: 600, height: 430 },
      viewport,
    );

    expect(restoreFloatingWindowPlacement(
      stored,
      { width: 600, height: 460, margin: 32 },
      minimum,
    )).toEqual({ left: 47, top: 32, width: 520, height: 396 });
  });

  it.each([
    null,
    "not-json",
    "{}",
    JSON.stringify({ formatVersion: 2, left: 0, top: 0, width: 1, height: 1 }),
    JSON.stringify({ formatVersion: 1, left: -1, top: 0, width: 1, height: 1 }),
    JSON.stringify({ formatVersion: 1, left: 0, top: 0, width: 0, height: 1 }),
  ])("rejects invalid stored placement %s", (stored) => {
    expect(restoreFloatingWindowPlacement(stored, viewport, minimum)).toBeNull();
  });

  it("does not serialize an unmeasured window", () => {
    expect(serializeFloatingWindowPlacement(
      { left: 32, top: 32, width: 0, height: 0 },
      viewport,
    )).toBeNull();
  });
});
