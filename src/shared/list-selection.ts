/**
 * The one selection policy for Hub lists and carousels (D-2): the Hub's result
 * list, the Characters carousel and Travel. ↑ ↓ ⌃P ⌃N step one item, Home End
 * jump to either end and PgUp PgDn move a page. The selection never wraps, so
 * a held key stops at the first or last item instead of cycling. Items a list
 * cannot select are stepped over; with none left that way, the selection stays.
 */
export type ListSelectionKey = Readonly<{ key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>;

/** Returns the step a list key asks for (±Infinity for End and Home), or null when it is not a list key. */
export function listSelectionStep(event: ListSelectionKey, page = 1): number | null {
  if (event.altKey || event.metaKey || event.shiftKey) return null;
  const control = event.ctrlKey;
  const key = control ? event.key.toLowerCase() : event.key;
  const steps: Readonly<Record<string, number>> = control
    ? { n: 1, p: -1 }
    : { ArrowDown: 1, ArrowUp: -1, PageDown: Math.max(1, page), PageUp: -Math.max(1, page), Home: -Infinity, End: Infinity };
  return steps[key] ?? null;
}

/** Moves the selection by a step without wrapping; -1 when the list is empty. */
export function moveListSelection(current: number, count: number, step: number, selectable: (index: number) => boolean = () => true): number {
  const first = (from: number, direction: 1 | -1) => {
    for (let index = from; index >= 0 && index < count; index += direction) if (selectable(index)) return index;
    return -1;
  };
  if (count <= 0) return -1;
  // With nothing selected, every list key but End starts at the first item.
  if (current < 0 || current >= count) return step === Infinity ? first(count - 1, -1) : first(0, 1);
  if (step === Infinity) return first(count - 1, -1);
  if (step === -Infinity) return first(0, 1);
  const direction = step > 0 ? 1 : -1;
  const target = Math.max(0, Math.min(count - 1, current + step));
  // A page step that lands on an unselectable item takes the nearest selectable one before it.
  const reached = first(target, direction);
  if (reached >= 0) return reached;
  const nearer = first(target, direction === 1 ? -1 : 1);
  return nearer >= 0 && (nearer - current) * direction > 0 ? nearer : current;
}

/** Returns the index a list key selects, or null when the key is not a list key. */
export function listSelectionIndex(event: ListSelectionKey, current: number, count: number, page = 1, selectable?: (index: number) => boolean): number | null {
  const step = listSelectionStep(event, page);
  return step === null ? null : moveListSelection(current, count, step, selectable);
}
