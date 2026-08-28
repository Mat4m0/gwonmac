/**
 * Projects certified native Guild Wars rectangles into the current canvas box.
 * Rejects stale generations, hidden frames, and invalid screen geometry.
 */
import type {
  CompassFrameSpikeSnapshot,
  NativeFrameSpikeSnapshot,
} from "../../shared/cartography-spike.js";

const MAX_VIEWPORT_EDGE = 32_768;

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
    || frame.left < 0
    || frame.bottom < 0
    || frame.left >= frame.right
    || frame.bottom >= frame.top
    || frame.right > viewport.width
    || frame.top > viewport.height
    || canvas.width <= 0
    || canvas.height <= 0
  ) return null;

  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  return Object.freeze({
    left: canvas.left + frame.left * scaleX,
    top: canvas.top + (viewport.height - frame.top) * scaleY,
    width: (frame.right - frame.left) * scaleX,
    height: (frame.top - frame.bottom) * scaleY,
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
