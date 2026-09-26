/**
 * Routes the pointer to Elite map markers without taking it from Guild Wars.
 * Markers draw inside the game, so every move still reaches the game and its
 * own hover state stays current. Only a left press that lands on a marker
 * while the game routes the pointer to that marker's map is claimed.
 */
import { eliteMarkerAt, type EliteMapHit, type EliteMapSurfaceName, type PlacedEliteMarker } from "../elite-map-scene.js";

export type EliteMapPointerSurface = Readonly<{
  name: EliteMapSurfaceName;
  box: Readonly<{ left: number; top: number; width: number; height: number }>;
  placed: readonly PlacedEliteMarker[];
  /** Whether the game routes the pointer to this map. A covering panel answers false. */
  ownsPointer(): boolean;
}>;
export type EliteMapPointer = Readonly<{ refresh(): void; dispose(): void }>;

export function installEliteMapPointer(options: Readonly<{
  view: Window;
  /** Accept only events aimed at the game, never at host panels above it. */
  accepts(target: EventTarget | null): boolean;
  surfaces(): readonly EliteMapPointerSurface[];
  hover(hit: EliteMapHit | null): void;
  activate(hit: EliteMapHit): void;
}>): EliteMapPointer {
  let x = Number.NaN; let y = Number.NaN; let over = false;
  let current: string | null = null; let pressed: string | null = null; let swallowClick = false;
  const identity = (hit: EliteMapHit | null) => hit ? `${hit.surface}:${hit.locationIds.join(",")}` : null;
  const hitAt = (): EliteMapHit | null => {
    if (!over) return null;
    for (const surface of options.surfaces()) {
      const localX = x - surface.box.left; const localY = y - surface.box.top;
      if (localX < 0 || localY < 0 || localX > surface.box.width || localY > surface.box.height) continue;
      const found = eliteMarkerAt(surface.placed, localX, localY);
      if (!found || !surface.ownsPointer()) continue;
      return { surface: surface.name, locationIds: found.marker.locationIds, nearbyIds: found.nearbyIds,
        x: surface.box.left + found.marker.x, y: surface.box.top + found.marker.y };
    }
    return null;
  };
  const refresh = () => {
    const hit = hitAt(); const next = identity(hit);
    if (next !== current) { current = next; options.hover(hit); }
  };
  const claim = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const move = (event: PointerEvent) => {
    x = event.clientX; y = event.clientY; over = options.accepts(event.target);
    refresh();
  };
  // Losing the window can drop the release; never carry a claim into the next press.
  const leave = () => { over = false; pressed = null; swallowClick = false; refresh(); };
  // Canceling pointerdown also suppresses the compatibility mousedown and
  // mouseup, so the game never sees half of a claimed press.
  const down = (event: PointerEvent) => {
    pressed = null; swallowClick = false;
    if (event.button !== 0 || !event.isPrimary || !options.accepts(event.target)) return;
    x = event.clientX; y = event.clientY; over = true;
    const hit = hitAt();
    if (!hit) return;
    pressed = identity(hit); swallowClick = true; claim(event);
  };
  const up = (event: PointerEvent) => {
    if (pressed === null || event.button !== 0) return;
    claim(event);
    x = event.clientX; y = event.clientY;
    const hit = hitAt(); const same = identity(hit) === pressed;
    pressed = null;
    // A click, if any, follows this release before any timer runs.
    view.setTimeout(() => { swallowClick = false; });
    if (hit && same) options.activate(hit);
  };
  const click = (event: MouseEvent) => { if (swallowClick) { swallowClick = false; claim(event); } };
  const cancel = () => { pressed = null; swallowClick = false; };
  const view = options.view;
  view.addEventListener("pointermove", move, { capture: true, passive: true });
  view.addEventListener("pointerdown", down, true);
  view.addEventListener("pointerup", up, true);
  view.addEventListener("pointercancel", cancel, true);
  view.addEventListener("click", click, true);
  view.addEventListener("blur", leave);
  // Leave events do not reach Document; the root element receives them.
  view.document.documentElement.addEventListener("pointerleave", leave);
  return {
    refresh,
    dispose() {
      view.removeEventListener("pointermove", move, true);
      view.removeEventListener("pointerdown", down, true);
      view.removeEventListener("pointerup", up, true);
      view.removeEventListener("pointercancel", cancel, true);
      view.removeEventListener("click", click, true);
      view.removeEventListener("blur", leave);
      view.document.documentElement.removeEventListener("pointerleave", leave);
      if (current !== null) { current = null; options.hover(null); }
    },
  };
}
