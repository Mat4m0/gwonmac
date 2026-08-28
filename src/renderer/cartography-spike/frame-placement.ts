/**
 * Projects certified native Guild Wars rectangles into the current canvas box.
 * Rejects stale generations, hidden frames, and invalid screen geometry.
 */
import type {
  CompassFrameSpikeSnapshot,
  NativeFrameSpikeSnapshot,
} from "../../shared/cartography-spike.js";

const MAX_VIEWPORT_EDGE = 32_768;
// Native frame edges are integer-aligned while the UI-scale viewport can be
// fractional. Accept and clamp only that final-pixel rounding difference.
const FRAME_EDGE_TOLERANCE = 1;

export type ScreenBox = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type ViewportSize = Readonly<{
  width: number;
  height: number;
}>;

/** Project one ready native frame through the game canvas' current CSS box. */
export function projectNativeFrame(
  frame: NativeFrameSpikeSnapshot,
  canvas: ScreenBox,
  viewport: ViewportSize = {
    width: frame.viewportWidth,
    height: frame.viewportHeight,
  },
): ScreenBox | null {
  const values = [
    viewport.width, viewport.height,
    frame.left, frame.bottom, frame.right, frame.top,
    canvas.left, canvas.top, canvas.width, canvas.height,
  ];
  if (
    frame.status !== 1
    || frame.generation <= 0
    || !frame.visible
    || !values.every(Number.isFinite)
    || viewport.width <= 0
    || viewport.width > MAX_VIEWPORT_EDGE
    || viewport.height <= 0
    || viewport.height > MAX_VIEWPORT_EDGE
    || frame.left < -FRAME_EDGE_TOLERANCE
    || frame.bottom < -FRAME_EDGE_TOLERANCE
    || frame.left >= frame.right
    || frame.bottom >= frame.top
    || frame.right > viewport.width + FRAME_EDGE_TOLERANCE
    || frame.top > viewport.height + FRAME_EDGE_TOLERANCE
    || canvas.width <= 0
    || canvas.height <= 0
  ) return null;

  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  const left = Math.max(0, frame.left);
  const bottom = Math.max(0, frame.bottom);
  const right = Math.min(viewport.width, frame.right);
  const top = Math.min(viewport.height, frame.top);
  return Object.freeze({
    left: canvas.left + left * scaleX,
    top: canvas.top + (viewport.height - top) * scaleY,
    width: (right - left) * scaleX,
    height: (top - bottom) * scaleY,
  });
}

/** Mission Map coordinates use the global Compass viewport, not its local viewport. */
export function projectMissionMapFrame(
  missionMap: NativeFrameSpikeSnapshot,
  compass: CompassFrameSpikeSnapshot,
  canvas: ScreenBox,
): ScreenBox | null {
  if (missionMap.generation !== compass.generation) return null;
  return projectNativeFrame(missionMap, canvas, {
    width: compass.viewportWidth,
    height: compass.viewportHeight,
  });
}
