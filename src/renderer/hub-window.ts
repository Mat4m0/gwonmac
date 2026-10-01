/**
 * Owns the Hub's locked-by-default placement, bounded drag and resize gestures.
 * Placement stays local to the Hub; navigating never resets the player's geometry.
 */
import { restoreFloatingWindowPlacement, serializeFloatingWindowPlacement } from '../shared/ui/window-placement.js';
import { installResizeGrip } from '../shared/ui/resize.js';

export function installHubWindow(panel: HTMLElement, heading: HTMLElement, lock: HTMLButtonElement, grip: HTMLElement) {
  const storageKey = 'gwonmac.hub-window-placement';
  const hint = heading.ownerDocument.createElement('span'); hint.className = 'hub-move-hint'; hint.id = 'hub-move-hint'; hint.textContent = '⌥ arrows move · ⇧ 48 px'; heading.insertBefore(hint, lock);
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight, margin: 8 });
  let locked = true;
  let placed = false;
  /**
   * Where the player last put the Hub, normalized to the viewport. A resize derives the box from
   * it, so a window that shrinks and grows back returns the Hub to that place and size (HUB-109).
   */
  let intent: string | null = null;
  let finishDrag: (() => void) | null = null;
  const paint = () => {
    panel.dataset.locked = String(locked);
    lock.setAttribute('aria-label', 'Lock Hub position');
    hint.hidden = locked;
    if (locked) lock.removeAttribute('aria-describedby'); else lock.setAttribute('aria-describedby', hint.id);
    lock.title = locked ? 'Unlock to move and resize' : 'Lock position and size. Option + arrows here moves the Hub; arrows on the corner resize it.';
    lock.setAttribute('aria-pressed', String(locked));
    grip.hidden = locked;
  };
  const place = (left: number, top: number, width: number, height: number) => {
    placed = true;
    width = Math.min(width, window.innerWidth - 16);
    height = Math.min(height, window.innerHeight - 16);
    Object.assign(panel.style, { transform: 'none',
      left: `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`,
      top: `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`,
      width: `${width}px`, height: `${height}px` });
  };
  const minimum = { width: 340, height: 300 };
  /** Only the player's own moves and resizes are saved, never a box a small window squeezed. */
  const save = () => {
    if (!placed) return;
    intent = serializeFloatingWindowPlacement(panel.getBoundingClientRect(), viewport());
    try { if (intent) localStorage.setItem(storageKey, intent); } catch { /* Placement remains usable when storage is unavailable. */ }
  };
  const fit = () => {
    const box = placed ? restoreFloatingWindowPlacement(intent, viewport(), minimum) : null;
    if (box) place(box.left, box.top, box.width, box.height);
  };
  try { intent = localStorage.getItem(storageKey); } catch { /* Use the default geometry when storage is unavailable. */ }
  if (restoreFloatingWindowPlacement(intent, viewport(), minimum)) { placed = true; fit(); } else intent = null;
  const toggle = () => { finishDrag?.(); locked = !locked; paint(); };
  const drag = (event: PointerEvent) => {
    if (locked || event.button !== 0 || (event.target as Element).closest('button, a, input, select')) return;
    event.preventDefault();
    const box = panel.getBoundingClientRect();
    heading.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => place(box.left + next.clientX - event.clientX, box.top + next.clientY - event.clientY, box.width, box.height);
    const finish = () => {
      heading.removeEventListener('pointermove', move);
      heading.removeEventListener('pointerup', finish);
      heading.removeEventListener('pointercancel', finish);
      heading.removeEventListener('lostpointercapture', finish);
      finishDrag = null; save();
    };
    finishDrag = finish;
    heading.addEventListener('pointermove', move);
    heading.addEventListener('pointerup', finish);
    heading.addEventListener('pointercancel', finish);
    heading.addEventListener('lostpointercapture', finish);
  };
  const moveWithKeys = (event: KeyboardEvent) => {
    if (locked || !event.altKey || !event.key.startsWith('Arrow')) return;
    event.preventDefault(); event.stopPropagation();
    const box = panel.getBoundingClientRect();
    const step = event.shiftKey ? 48 : 16;
    place(box.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      box.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), box.width, box.height);
    save();
  };
  const disposeResize = installResizeGrip(grip, {
    setActive: active => { if (!active) save(); },
    size: () => panel.getBoundingClientRect(),
    limits: () => { const box = panel.getBoundingClientRect(); return { minWidth: 340, minHeight: 300, maxWidth: window.innerWidth - box.left - 8, maxHeight: window.innerHeight - box.top - 8 }; },
    resize: (width, height) => { if (!locked) { const box = panel.getBoundingClientRect(); place(box.left, box.top, width, height); } },
  });
  const saveResize = () => save();
  grip.addEventListener('keyup', saveResize);
  lock.addEventListener('click', toggle);
  lock.addEventListener('keydown', moveWithKeys);
  heading.addEventListener('pointerdown', drag);
  window.addEventListener('resize', fit);
  const onShow = (event: Event) => { if (event.target instanceof HTMLDialogElement && event.target.open) fit(); };
  panel.closest('dialog')?.addEventListener('toggle', onShow);
  paint();
  const reset = () => {
    finishDrag?.(); placed = false; locked = true; intent = null;
    try { localStorage.removeItem(storageKey); } catch { /* Reset still restores this session. */ }
    for (const property of ['left', 'top', 'width', 'height', 'transform']) panel.style.removeProperty(property);
    paint();
  };
  return { reset, dispose() { hint.remove(); panel.closest('dialog')?.removeEventListener('toggle', onShow); finishDrag?.(); disposeResize(); grip.removeEventListener('keyup', saveResize); lock.removeEventListener('click', toggle); lock.removeEventListener('keydown', moveWithKeys); heading.removeEventListener('pointerdown', drag); window.removeEventListener('resize', fit); } };
}
