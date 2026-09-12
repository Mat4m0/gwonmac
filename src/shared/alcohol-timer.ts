/**
 * Owns the alcohol timer’s saved pixel distance from a game-window corner.
 * Main and renderer share its bounded persistence contract and defaults.
 */
import { isCornerPosition, type CornerPosition } from "./corner-position.js";
/** The untagged form is accepted only to migrate this feature's developer builds. */
export type AlcoholTimerPosition = Readonly<{ corner?: never; x: number; y: number; locked: boolean }> | (CornerPosition & Readonly<{ locked: boolean }>);
export const DEFAULT_ALCOHOL_TIMER_POSITION: AlcoholTimerPosition = Object.freeze({ corner: "top-left", x: 4, y: 58, locked: true });
export function isAlcoholTimerPosition(value: unknown): value is AlcoholTimerPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<AlcoholTimerPosition>;
  const keys = Object.keys(value).sort().join(",");
  return (keys === "locked,x,y" || (keys === "corner,locked,x,y" && isCornerPosition(value)))
    && typeof p.x === "number" && Number.isFinite(p.x) && Math.abs(p.x) <= 32_768
    && typeof p.y === "number" && Number.isFinite(p.y) && Math.abs(p.y) <= 32_768
    && typeof p.locked === "boolean";
}
export function formatAlcoholTimer(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
