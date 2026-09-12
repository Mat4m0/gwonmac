/**
 * Owns nearest-corner placement for fixed-size game overlay controls.
 * Chat and alcohol share pixel offsets that survive viewport resizing.
 */
export type CornerPosition = Readonly<{
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  x: number;
  y: number;
}>;
type Viewport = Readonly<{ width: number; height: number; margin: number }>;
type Size = Readonly<{ width: number; height: number }>;
const clamp = (value: number, maximum: number) => Math.min(Math.max(0, maximum), Math.max(0, value));
export function isCornerPosition(value: unknown): value is CornerPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<CornerPosition>;
  return ["top-left", "top-right", "bottom-left", "bottom-right"].includes(String(p.corner))
    && typeof p.x === "number" && Number.isFinite(p.x) && p.x >= 0
    && typeof p.y === "number" && Number.isFinite(p.y) && p.y >= 0;
}
export function captureCornerPosition(position: Readonly<{ left: number; top: number }>, viewport: Viewport, size: Size): CornerPosition | null {
  if (viewport.width <= viewport.margin * 2 || viewport.height <= viewport.margin * 2 || size.width <= 0 || size.height <= 0) return null;
  const horizontalRange = Math.max(0, viewport.width - viewport.margin * 2 - size.width);
  const verticalRange = Math.max(0, viewport.height - viewport.margin * 2 - size.height);
  const left = clamp(position.left - viewport.margin, horizontalRange);
  const right = horizontalRange - left;
  const top = clamp(position.top - viewport.margin, verticalRange);
  const bottom = verticalRange - top;
  const horizontal = left <= right ? "left" : "right";
  const vertical = top <= bottom ? "top" : "bottom";
  return { corner: `${vertical}-${horizontal}`, x: horizontal === "left" ? left : right, y: vertical === "top" ? top : bottom };
}
export function restoreCornerPosition(position: CornerPosition, viewport: Viewport, size: Size): Readonly<{ left: number; top: number }> | null {
  if (viewport.width <= viewport.margin * 2 || viewport.height <= viewport.margin * 2 || size.width <= 0 || size.height <= 0) return null;
  const x = clamp(position.x, viewport.width - viewport.margin * 2 - size.width);
  const y = clamp(position.y, viewport.height - viewport.margin * 2 - size.height);
  return {
    left: position.corner.endsWith("left") ? viewport.margin + x : Math.max(viewport.margin, viewport.width - viewport.margin - size.width - x),
    top: position.corner.startsWith("top") ? viewport.margin + y : Math.max(viewport.margin, viewport.height - viewport.margin - size.height - y),
  };
}
