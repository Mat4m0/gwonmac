/**
 * The one selection policy for Hub lists (D-2): ↑ ↓ ⌃P ⌃N step one item,
 * Home End jump to either end and PgUp PgDn move a page. The selection never
 * wraps, so a held key stops at the first or last item instead of cycling.
 */
export type ListSelectionKey = Readonly<{ key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>;

/** Returns the index a list key selects, or null when the key is not a list key. */
export function listSelectionIndex(event: ListSelectionKey, current: number, count: number, page = 1): number | null {
  if (event.altKey || event.metaKey || event.shiftKey) return null;
  const control = event.ctrlKey;
  const key = control ? event.key.toLowerCase() : event.key;
  const steps: Readonly<Record<string, number>> = control
    ? { n: 1, p: -1 }
    : { ArrowDown: 1, ArrowUp: -1, PageDown: Math.max(1, page), PageUp: -Math.max(1, page), Home: -Infinity, End: Infinity };
  const step = steps[key];
  if (step === undefined) return null;
  if (count <= 0) return -1;
  // With nothing selected, every list key but End starts at the first item.
  if (current < 0 || current >= count) return step === Infinity ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, current + step));
}
