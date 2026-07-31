import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inputClickHypotheses,
  type InputClickProbePhase,
  type InputClickProbeStats,
} from "../../scripts/enhancements-live/input-click-probe.ts";
import type { AppSettings } from "../../src/shared/contracts.ts";

const STATS: InputClickProbeStats = Object.freeze({
  trustedMouseDown: 1,
  trustedMouseUp: 1,
  trustedClick: 1,
  trustedDownOnCanvas: 1,
  trustedDownOverCanvas: 1,
  canvasCaptureMouseDown: 1,
  canvasBubbleMouseDown: 1,
  syntheticTouchStart: 0,
  syntheticTouchEnd: 0,
  syntheticMouseMove: 0,
  suppressedSyntheticMouseMove: 0,
  focusLoss: 1,
});

function phase(
  label: string,
  mode: AppSettings["touchMode"],
  distance: number,
  stats: Partial<InputClickProbeStats> = {},
): InputClickProbePhase {
  const state = { x: 0, y: 0, cursorEvents: 0, cursorRefreshes: 0 };
  return {
    label,
    mode,
    suppressCursorRefresh: label === "mouse-only-no-cursor-refresh",
    before: state,
    after: state,
    distance,
    events: {
      label,
      mode,
      suppressCursorRefresh: label === "mouse-only-no-cursor-refresh",
      stats: { ...STATS, ...stats },
      samples: [],
      overflow: 0,
    },
  };
}

describe("left-click live hypotheses", () => {
  it("isolates mouse-to-touch translation from a working mouse path", () => {
    assert.deepEqual(
      inputClickHypotheses([
        phase("current", "translate", 0, { syntheticTouchStart: 1 }),
        phase("mouse-only", "off", 20),
        phase("touch-translation", "translate", 0, { syntheticTouchStart: 1 }),
      ]),
      [
        "translate-mouse-to-touch-breaks-click-to-move",
        "persisted-current-input-mode-is-the-regression",
      ],
    );
  });

  it("isolates the cursor refresh with a suppression control", () => {
    assert.deepEqual(
      inputClickHypotheses([
        phase("mouse-only", "off", 0, { syntheticMouseMove: 2 }),
        phase("mouse-only-no-cursor-refresh", "off", 20, {
          syntheticMouseMove: 1,
          suppressedSyntheticMouseMove: 1,
        }),
      ]),
      ["cursor-refresh-interferes-with-click-to-move"],
    );
  });

  it("reports focus and coverage evidence without inventing a game diagnosis", () => {
    assert.deepEqual(
      inputClickHypotheses([
        phase("current", "off", 0, {
          trustedMouseDown: 0,
          trustedMouseUp: 0,
          trustedClick: 0,
          trustedDownOnCanvas: 0,
          trustedDownOverCanvas: 0,
          canvasCaptureMouseDown: 0,
          canvasBubbleMouseDown: 0,
        }),
      ]),
      ["physical-click-missing-or-window-not-active"],
    );
    assert.deepEqual(
      inputClickHypotheses([
        phase("current", "off", 0, {
          trustedDownOnCanvas: 0,
          trustedDownOverCanvas: 0,
          canvasCaptureMouseDown: 0,
          canvasBubbleMouseDown: 0,
        }),
      ]),
      ["click-target-covered-or-outside-canvas"],
    );
  });

  it("keeps an all-mode game-state failure distinct from renderer input", () => {
    assert.deepEqual(
      inputClickHypotheses([
        phase("current", "off", 0),
        phase("mouse-only", "off", 0),
      ]),
      ["game-state-or-click-location-needs-investigation"],
    );
  });
});
