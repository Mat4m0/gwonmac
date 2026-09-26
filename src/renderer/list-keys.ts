/**
 * Owns the one list move of the keyboard contract, shared by Hub lists, Hub
 * preferences and the Characters carousel: ↑ ↓ ⌃P ⌃N step, PgUp PgDn page and
 * Home End jump, and no list wraps. A carousel also steps with ← →.
 */

/** The step a key asks for, or null when the key is not a list move. */
export function listKeyStep(event: KeyboardEvent, page: number, carousel = false): number | null {
  if (event.altKey || event.metaKey || event.shiftKey) return null;
  const key = event.ctrlKey ? ({ n: "ArrowDown", p: "ArrowUp" } as Record<string, string>)[event.key.toLowerCase()] : event.key;
  const steps: Record<string, number> = {
    ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, End: Infinity, Home: -Infinity,
    ...(carousel ? { ArrowRight: 1, ArrowLeft: -1 } : {}),
  };
  return steps[key ?? ""] ?? null;
}

/** Where a step lands, held at both ends. From no selection, End lands on the last item and every other move on the first. */
export function listIndexAfter(index: number, count: number, step: number): number {
  if (index < 0) return step === Infinity ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, index + step));
}
