/**
 * Owns the one list move of the keyboard contract, shared by Hub lists, Hub
 * preferences, Settings sections, the Characters carousel, Travel, the Trade
 * ledger, Trader prices and the Whispers picker: ↑ ↓ ⌃P ⌃N step, PgUp PgDn
 * page by the visible rows and Home End jump, and no list wraps. A carousel
 * also steps with ← →.
 */

/** The step a key asks for, or null when the key is not a list move. */
export function listKeyStep(event: Readonly<{ key: string; altKey: boolean; metaKey: boolean; shiftKey: boolean; ctrlKey: boolean }>, page: number, carousel = false): number | null {
  if (event.altKey || event.metaKey || event.shiftKey) return null;
  const key = event.ctrlKey ? ({ n: "ArrowDown", p: "ArrowUp" } as Record<string, string>)[event.key.toLowerCase()] : event.key;
  const steps: Record<string, number> = {
    ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, End: Infinity, Home: -Infinity,
    ...(carousel ? { ArrowRight: 1, ArrowLeft: -1 } : {}),
  };
  return steps[key ?? ""] ?? null;
}

/**
 * Where a step lands, held at both ends. From no selection, End lands on the last
 * item and every other move on the first. An item `usable` refuses is passed over;
 * with no usable item that way the selection stays. `usable` is only asked about
 * indexes inside the list, and the selection never moves against the step.
 */
export function listIndexAfter(index: number, count: number, step: number, usable: (index: number) => boolean = () => true): number {
  const fresh = index < 0 || index >= count;
  if (!step && !fresh) return index;
  const direction = fresh ? (step === Infinity ? -1 : 1) : Math.sign(step);
  const target = fresh ? (step === Infinity ? count - 1 : 0) : Math.max(0, Math.min(count - 1, index + step));
  for (let next = target; next >= 0 && next < count; next += direction) if (usable(next)) return next;
  if (!fresh) for (let next = target - direction; direction * (next - index) > 0; next -= direction) if (usable(next)) return next;
  return fresh ? -1 : index;
}

/** One page of a scrolled list: the rows that fit in its viewport, less one kept for context. */
export function listPage(viewport: Readonly<{ clientHeight: number }> | null | undefined, row: Readonly<{ offsetHeight: number }> | null | undefined): number {
  const height = row?.offsetHeight || 40;
  return Math.max(1, Math.floor((viewport?.clientHeight ?? 0) / height) - 1);
}
