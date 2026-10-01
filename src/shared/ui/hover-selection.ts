/**
 * Owns when hover may move a Hub list's selection (D-24, HUB-012). Hover selects
 * only on real pointer movement, so a view that appears under a resting pointer,
 * a wheel scroll or the trailing click of a double-click never moves it. A click
 * holds its selection: the pointer's way from the clicked row to the footer
 * primary crosses other rows, and the footer must keep naming the clicked one.
 * Hover selects again once the pointer leaves the list, a key moves the
 * selection or the list shows another page or query.
 */
export interface HoverSelection {
  /** Whether this pointer move over a row selects it. */
  selects(event: Readonly<{ movementX: number; movementY: number }>): boolean;
  /** A click (or right-click) chose the selection; hover leaves it alone. */
  hold(): void;
  /** The pointer left the list, or a key or a new page moved the selection. */
  release(): void;
}

export function createHoverSelection(): HoverSelection {
  let held = false;
  return {
    selects: (event) => !held && (event.movementX !== 0 || event.movementY !== 0),
    hold() { held = true; },
    release() { held = false; },
  };
}
