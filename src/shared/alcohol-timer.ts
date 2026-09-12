/**
 * Owns the saved offset from the visible Effects icons, in game UI coordinates.
 * Main and renderer share its bounded persistence contract and defaults.
 */
export type AlcoholTimerPosition = Readonly<{ x: number; y: number; locked: boolean }>;
export const DEFAULT_ALCOHOL_TIMER_POSITION: AlcoholTimerPosition = Object.freeze({ x: 0, y: 10, locked: true });
export function isAlcoholTimerPosition(value: unknown): value is AlcoholTimerPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<AlcoholTimerPosition>;
  return Object.keys(value).sort().join(",") === "locked,x,y"
    && typeof p.x === "number" && Number.isFinite(p.x) && Math.abs(p.x) <= 32_768
    && typeof p.y === "number" && Number.isFinite(p.y) && Math.abs(p.y) <= 32_768
    && typeof p.locked === "boolean";
}
export function formatAlcoholTimer(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
