/**
 * The one conversion from certified game coordinates to viewport CSS pixels.
 * Invalid geometry and hidden canvases withdraw the complete projection.
 */
import type { CompanionSkillSlotState } from "./companion-interface-geometry-snapshot.js";

export type SkillSlotProjection = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type GameRect = Readonly<{ left: number; bottom: number; right: number; top: number }>;

export function projectGameRect(
  rect: GameRect,
  viewport: Readonly<{ width: number; height: number }>,
  canvas: HTMLCanvasElement,
): SkillSlotProjection | null {
  const canvasRect = canvas.getBoundingClientRect();
  if (
    ![canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height,
      viewport.width, viewport.height, rect.left, rect.bottom, rect.right, rect.top]
      .every(Number.isFinite)
    || canvasRect.width <= 0 || canvasRect.height <= 0
    || viewport.width <= 0 || viewport.height <= 0
    || rect.right <= rect.left || rect.top <= rect.bottom
  ) return null;
  const scaleX = canvasRect.width / viewport.width;
  const scaleY = canvasRect.height / viewport.height;
  return Object.freeze({
    x: canvasRect.left + rect.left * scaleX,
    y: canvasRect.top + (viewport.height - rect.top) * scaleY,
    width: (rect.right - rect.left) * scaleX,
    height: (rect.top - rect.bottom) * scaleY,
  });
}

export function projectSkillSlots(
  state: CompanionSkillSlotState,
  canvas: HTMLCanvasElement,
): readonly SkillSlotProjection[] | null {
  if (state.status !== "ready" || state.slots.length !== 8) return null;
  const canvasRect = canvas.getBoundingClientRect();
  if (
    ![canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height,
      state.viewportWidth, state.viewportHeight].every(Number.isFinite)
    || canvasRect.width <= 0 || canvasRect.height <= 0
    || state.viewportWidth <= 0 || state.viewportHeight <= 0
  ) return null;
  const scaleX = canvasRect.width / state.viewportWidth;
  const scaleY = canvasRect.height / state.viewportHeight;
  const projected = state.slots.map((slot) => Object.freeze({
    x: canvasRect.left + slot.left * scaleX,
    y: canvasRect.top + (state.viewportHeight - slot.top) * scaleY,
    width: (slot.right - slot.left) * scaleX,
    height: (slot.top - slot.bottom) * scaleY,
  }));
  return projected.every(({ x, y, width, height }) =>
    [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0)
    ? Object.freeze(projected) : null;
}
