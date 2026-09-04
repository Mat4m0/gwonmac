/**
 * Owns the shared geometry for controls placed beside the native Compass.
 * Every Compass-side menu uses this one centering and edge-selection rule.
 */
import type { ScreenBox } from "./frame-placement.js";

export const COMPASS_CONTROL_SIZE = 30;
export const COMPASS_CONTROL_GAP = 5;
export const COMPASS_CONTROL_OPEN_EVENT = "gw:compass-control-open";
const VIEWPORT_MARGIN = 6;

export type CompassControlPlacement = Readonly<{
  index: number;
  count: number;
}>;

export type CompassControlPosition = Readonly<{
  left: number;
  top: number;
  panelSide: "left" | "right";
}>;

/** Center one control or the complete control stack beside the Compass. */
export function projectCompassControlPosition(
  box: ScreenBox,
  viewport: Readonly<{ width: number; height: number }>,
  panelWidth: number,
  placement: CompassControlPlacement,
): CompassControlPosition | null {
  const { index, count } = placement;
  if (
    !Number.isInteger(index) || !Number.isInteger(count)
    || count < 1 || index < 0 || index >= count
    || ![box.left, box.top, box.width, box.height, viewport.width, viewport.height, panelWidth]
      .every(Number.isFinite)
    || box.width <= 0 || box.height <= 0 || viewport.width <= 0 || viewport.height <= 0
    || panelWidth <= 0
  ) return null;
  const stackHeight = count * COMPASS_CONTROL_SIZE + (count - 1) * COMPASS_CONTROL_GAP;
  const roomLeft = box.left
    >= panelWidth + COMPASS_CONTROL_SIZE + COMPASS_CONTROL_GAP + VIEWPORT_MARGIN;
  const roomRight = box.left + box.width + panelWidth + COMPASS_CONTROL_SIZE
    + COMPASS_CONTROL_GAP + VIEWPORT_MARGIN <= viewport.width;
  const panelSide = roomLeft || !roomRight ? "left" : "right";
  const left = panelSide === "left"
    ? Math.max(VIEWPORT_MARGIN, box.left - COMPASS_CONTROL_SIZE - COMPASS_CONTROL_GAP)
    : Math.min(
      viewport.width - COMPASS_CONTROL_SIZE - VIEWPORT_MARGIN,
      box.left + box.width + COMPASS_CONTROL_GAP,
    );
  const centeredStackTop = box.top + (box.height - stackHeight) / 2;
  const stackTop = Math.max(
    VIEWPORT_MARGIN,
    Math.min(viewport.height - stackHeight - VIEWPORT_MARGIN, centeredStackTop),
  );
  return Object.freeze({
    left,
    top: stackTop + index * (COMPASS_CONTROL_SIZE + COMPASS_CONTROL_GAP),
    panelSide,
  });
}
