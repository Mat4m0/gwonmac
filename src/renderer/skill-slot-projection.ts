/**
 * The one conversion from certified game coordinates to viewport CSS pixels.
 * Invalid geometry and hidden canvases withdraw the complete projection.
 */
import type { CompanionSkillSlotState } from "./companion-skill-snapshot.js";

export type SkillSlotProjection = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export function projectSkillSlots(
  state: CompanionSkillSlotState,
  canvas: HTMLCanvasElement,
): readonly SkillSlotProjection[] | null {
  if (state.status !== "ready" || state.slots.length !== 8) return null;
  const canvasRect = canvas.getBoundingClientRect();
  if (
    !Number.isFinite(canvasRect.left)
    || !Number.isFinite(canvasRect.top)
    || !Number.isFinite(canvasRect.width)
    || !Number.isFinite(canvasRect.height)
    || canvasRect.width <= 0
    || canvasRect.height <= 0
    || state.viewportWidth <= 0
    || state.viewportHeight <= 0
  ) return null;
  const scaleX = canvasRect.width / state.viewportWidth;
  const scaleY = canvasRect.height / state.viewportHeight;
  const projected = state.slots.map((slot) => Object.freeze({
    x: canvasRect.left + slot.left * scaleX,
    y: canvasRect.top + (state.viewportHeight - slot.top) * scaleY,
    width: (slot.right - slot.left) * scaleX,
    height: (slot.top - slot.bottom) * scaleY,
  }));
  return projected.every((slot) =>
    Number.isFinite(slot.x)
    && Number.isFinite(slot.y)
    && Number.isFinite(slot.width)
    && Number.isFinite(slot.height)
    && slot.width > 0
    && slot.height > 0)
    ? Object.freeze(projected)
    : null;
}
