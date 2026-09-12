/**
 * Owns the quiet alcohol readout and explicit positioning mode. Its saved
 * position keeps a fixed distance from the nearest game-window corner.
 */
import { DEFAULT_ALCOHOL_TIMER_POSITION, formatAlcoholTimer, type AlcoholTimerPosition } from "../shared/alcohol-timer.js";
import { captureCornerPosition, restoreCornerPosition, isCornerPosition } from "../shared/corner-position.js";
import type { AlcoholState } from "./companion-alcohol-snapshot.js";
import type { CompanionEffectIconState } from "./companion-effect-snapshot.js";
import { createNonActivatingSurface } from "./non-activating-surface.js";

export function legacyAlcoholTimerAnchor(geometry: CompanionEffectIconState, bounds: DOMRect) {
  if (geometry.status !== "ready" || bounds.width <= 0 || bounds.height <= 0) return null;
  const scaleX = bounds.width / geometry.viewportWidth;
  const scaleY = bounds.height / geometry.viewportHeight;
  // Preserve the old developer-build placement once before saving a corner.
  // See internals/migrations.md; live effects never drive the new placement.
  const left = geometry.icons.length > 0
    ? Math.min(...geometry.icons.map(icon => icon.left)) : geometry.anchor.left;
  const bottom = geometry.icons.length > 0
    ? Math.min(...geometry.icons.map(icon => icon.bottom)) : geometry.anchor.top;
  return { x: bounds.left + left * scaleX,
    y: bounds.top + (geometry.viewportHeight - bottom) * scaleY, scaleX, scaleY };
}

export function createAlcoholTimerOverlay(parent: HTMLElement, canvas: HTMLCanvasElement,
  savePosition: (value: AlcoholTimerPosition) => Promise<unknown>) {
  const document = parent.ownerDocument;
  const view = document.defaultView!;
  const root = document.createElement("div");
  root.id = "alcohol-timer-overlay";
  root.style.cssText = "position:fixed;width:max-content;display:none;align-items:center;gap:5px;z-index:4;pointer-events:none;color:#eadcc2;font:500 14px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px #000,0 0 3px #000;user-select:none";
  const handle = document.createElement("button");
  handle.type = "button";
  handle.setAttribute("aria-label", "Move alcohol timer. Drag or use arrow keys. Shift moves farther. Enter locks. Escape cancels.");
  handle.style.cssText = "display:flex;align-items:center;gap:6px;color:inherit;font:inherit;text-shadow:inherit;padding:5px 4px;border:0;border-radius:3px;background:transparent;touch-action:none";
  const mug = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  mug.setAttribute("viewBox", "0 0 512 512"); mug.setAttribute("width", "16"); mug.setAttribute("height", "16"); mug.setAttribute("aria-hidden", "true");
  const mugPath = document.createElementNS(mug.namespaceURI, "path");
  // Ionicons beer icon, MIT license; see THIRD-PARTY-NOTICES.md.
  mugPath.setAttribute("d", "M392 208h-24v-5.74A63.93 63.93 0 0 0 321.65 96a111 111 0 0 0-27.59-47.29A108.62 108.62 0 0 0 216 16c-29.91 0-57.78 12.28-79 34.68a56 56 0 0 0-67.51 77.54A63.91 63.91 0 0 0 80 231.39V440a56.06 56.06 0 0 0 56 56h176a56.06 56.06 0 0 0 56-56v-8h24a72.08 72.08 0 0 0 72-72v-80a72.08 72.08 0 0 0-72-72M176 416a16 16 0 0 1-32 0V256a16 16 0 0 1 32 0Zm64 0a16 16 0 0 1-32 0V256a16 16 0 0 1 32 0Zm64 0a16 16 0 0 1-32 0V256a16 16 0 0 1 32 0Zm16-224c-8.33 0-20.55-5.18-26.69-11.31A16 16 0 0 0 282 176H160a16 16 0 0 0-15 10.53c-6.83 18.68-23.6 21.47-33 21.47a32 32 0 0 1 0-64c.09 0 9.12.34 16.4 5.8a16 16 0 1 0 19.2-25.6A63.7 63.7 0 0 0 112 112a63.6 63.6 0 0 0-14 1.57A24 24 0 0 1 120 80a23.78 23.78 0 0 1 19.38 9.84a51.4 51.4 0 0 1 4.71 7.9A16 16 0 0 0 176 96c0-6.77-3.61-15.17-10.76-25c-.46-.63-1-1.25-1.45-1.86C178.39 55.44 196.64 48 216 48a76.86 76.86 0 0 1 55.23 23.18A80.2 80.2 0 0 1 292.61 142a16 16 0 0 0 12.73 18.71a16.3 16.3 0 0 0 3 .28a16 16 0 0 0 15.7-13a112 112 0 0 0 1.96-19.42a32 32 0 0 1-6 63.43m112 168a40 40 0 0 1-40 40h-24V240h24a40 40 0 0 1 40 40Z");
  mugPath.setAttribute("fill", "currentColor");
  mug.append(mugPath);
  const time = document.createElement("span");
  time.style.cssText = "display:inline-block;width:4ch;text-align:right";
  handle.append(mug, time);
  const lock = document.createElement("button"); lock.type = "button";
  lock.setAttribute("aria-label", "Lock alcohol timer position");
  lock.title = "Lock position";
  lock.style.cssText = "position:absolute;top:0;left:calc(100% + 5px);width:28px;height:28px;padding:5px;border:1px solid #eadcc255;border-radius:3px;background:#18231dbb;color:inherit;cursor:pointer;pointer-events:auto";
  const lockIcon = document.createElementNS(mug.namespaceURI, "svg");
  lockIcon.setAttribute("viewBox", "0 0 16 16"); lockIcon.setAttribute("aria-hidden", "true");
  const lockPath = document.createElementNS(mug.namespaceURI, "path");
  lockPath.setAttribute("d", "M3 7h10v7H3z M5 7V4a3 3 0 0 1 6 0v3");
  lockPath.setAttribute("fill", "none"); lockPath.setAttribute("stroke", "currentColor"); lockPath.setAttribute("stroke-width", "1.3"); lockIcon.append(lockPath); lock.append(lockIcon);
  const error = document.createElement("span"); error.setAttribute("role", "status");
  error.style.cssText = "position:absolute;top:100%;left:0;white-space:nowrap;font-size:12px";
  root.append(handle, lock, error); parent.append(root);
  const surface = createNonActivatingSurface(root, () => canvas);
  let position: AlcoholTimerPosition = DEFAULT_ALCOHOL_TIMER_POSITION;
  let receivedPosition = position;
  const queuedPositions = new Set<AlcoholTimerPosition>();
  const samePosition = (a: AlcoholTimerPosition, b: AlcoholTimerPosition) => a.x === b.x && a.y === b.y && a.locked === b.locked
    && (isCornerPosition(a) ? a.corner : null) === (isCornerPosition(b) ? b.corner : null);
  let savedPosition = position;
  let enabled = false;
  let disposed = false;
  let pendingSave = Promise.resolve();
  let geometry: CompanionEffectIconState = { status: "waiting", reason: "memory" };
  let alcohol: AlcoholState = { status: "waiting" };
  let drag: { id: number; x: number; y: number; left: number; top: number; before: AlcoholTimerPosition } | null = null;
  const viewport = () => {
    const bounds = canvas.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, margin: 0 };
  };
  const size = () => root.getBoundingClientRect();
  const capture = (x: number, y: number) => {
    const bounds = canvas.getBoundingClientRect();
    return captureCornerPosition({ left: x - bounds.left, top: y - bounds.top }, viewport(), size());
  };
  const render = () => {
    const bounds = canvas.getBoundingClientRect();
    const legacyAnchor = isCornerPosition(position) ? null : legacyAlcoholTimerAnchor(geometry, bounds);
    const visible = enabled && bounds.width > 0 && bounds.height > 0
      && (isCornerPosition(position) || legacyAnchor !== null)
      && (!position.locked || (alcohol.status === "ready" && alcohol.remainingMs > 0));
    root.style.display = visible ? "flex" : "none";
    if (!visible) return;
    const remaining = alcohol.status === "ready" ? alcohol.remainingMs : 0;
    time.textContent = remaining > 0 ? formatAlcoholTimer(remaining) : "—:—";
    root.style.color = remaining > 0 && remaining <= 15_000 ? "#e5bd75" : "#eadcc2";
    handle.disabled = position.locked;
    handle.style.pointerEvents = position.locked ? "none" : "auto";
    handle.style.cursor = position.locked ? "default" : drag ? "grabbing" : "grab";
    handle.style.outline = position.locked ? "" : "1px dashed #eadcc277";
    handle.style.background = position.locked ? "transparent" : "#18231d55";
    lock.hidden = position.locked;
    if (legacyAnchor) {
      const migrated = capture(legacyAnchor.x + position.x * legacyAnchor.scaleX,
        legacyAnchor.y + position.y * legacyAnchor.scaleY);
      if (!migrated) return;
      position = { ...migrated, locked: position.locked };
      // Keep the same visible position if this one-time persistence attempt fails.
      commit(position);
    }
    if (!isCornerPosition(position)) return;
    const point = restoreCornerPosition(position, viewport(), size());
    if (!point) return;
    root.style.left = `${bounds.left + point.left}px`; root.style.top = `${bounds.top + point.top}px`;
    lock.style.left = point.left + size().width + 33 <= bounds.width ? "calc(100% + 5px)" : "-33px";
  };
  const commit = (fallback?: AlcoholTimerPosition) => {
    const next = { ...position };
    queuedPositions.add(next);
    pendingSave = pendingSave.then(async () => {
      if (disposed) return;
      try { await savePosition(next); savedPosition = next; error.textContent = ""; }
      catch {
        if (samePosition(position, next)) position = fallback ?? savedPosition;
        error.textContent = "Position could not be saved. Try again.";
        render();
      } finally { queuedPositions.delete(next); }
    });
  };
  const cancel = () => {
    if (!drag) return;
    const previous = drag; drag = null; position = previous.before;
    if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    render();
  };
  const setPoint = (x: number, y: number) => {
    const point = capture(x, y); if (!point) return;
    position = { ...point, locked: false };
    render();
  };
  const lockPosition = () => { cancel(); position = { ...position, locked: true }; render(); commit(); surface.releaseKeyboard(); };
  handle.addEventListener("pointerdown", event => {
    if (position.locked || drag || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: root.getBoundingClientRect().left, top: root.getBoundingClientRect().top, before: position };
    handle.setPointerCapture(event.pointerId); render();
  });
  handle.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) setPoint(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  handle.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    drag = null; handle.releasePointerCapture(event.pointerId); render(); commit();
  });
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
    if (event.target !== handle || position.locked) return;
    if (event.key === "Enter") { event.preventDefault(); lockPosition(); return; }
    const directions: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key]; if (!direction) return;
    event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
    const box = root.getBoundingClientRect(); setPoint(box.left + direction[0] * amount, box.top + direction[1] * amount); commit();
  });
  const escapeDrag = (event: KeyboardEvent) => { if (drag && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } };
  view.addEventListener("keydown", escapeDrag, true);
  for (const name of ["keydown", "keyup", "pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "contextmenu"]) root.addEventListener(name, event => event.stopPropagation());
  lock.addEventListener("click", lockPosition);
  view.addEventListener("blur", cancel); view.addEventListener("resize", render);
  return {
    setAlcohol(next: AlcoholState) { alcohol = next; render(); },
    setGeometry(next: CompanionEffectIconState) { geometry = next; if (!isCornerPosition(position)) render(); },
    setSettings(next: AlcoholTimerPosition, active: boolean) {
      const changed = !samePosition(next, receivedPosition);
      receivedPosition = next;
      const ownEcho = [...queuedPositions].some(value => samePosition(value, next));
      if (!active) cancel();
      if (changed && !ownEcho) {
        cancel(); position = next; savedPosition = next;
      }
      if (!active && root.contains(document.activeElement)) surface.releaseKeyboard();
      enabled = active; render();
    },
    dispose() { disposed = true; cancel(); surface.dispose(); view.removeEventListener("keydown", escapeDrag, true); view.removeEventListener("blur", cancel); view.removeEventListener("resize", render); root.remove(); },
  };
}
