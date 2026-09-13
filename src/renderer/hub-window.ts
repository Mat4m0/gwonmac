/**
 * Owns the Hub's locked-by-default placement, bounded drag and resize gestures.
 * Placement stays local to the Hub; navigating never resets the player's geometry.
 */
import { installResizeGrip } from '../shared/ui/resize.js';

export function installHubWindow(panel: HTMLElement, heading: HTMLElement, lock: HTMLButtonElement, grip: HTMLElement) {
  let locked = true;
  let placed = false;
  let finishDrag: (() => void) | null = null;
  const paint = () => {
    panel.dataset.locked = String(locked);
    lock.setAttribute('aria-label', locked ? 'Unlock Hub position' : 'Lock Hub position');
    lock.title = locked ? 'Unlock to move and resize' : 'Lock position and size';
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
  const fit = () => {
    if (!placed) return;
    const box = panel.getBoundingClientRect();
    if (box.width && box.height) place(box.left, box.top, box.width, box.height);
  };
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
      finishDrag = null;
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
    place(box.left + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0),
      box.top + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0), box.width, box.height);
  };
  const disposeResize = installResizeGrip(grip, {
    size: () => panel.getBoundingClientRect(),
    limits: () => { const box = panel.getBoundingClientRect(); return { minWidth: 340, minHeight: 300, maxWidth: window.innerWidth - box.left - 8, maxHeight: window.innerHeight - box.top - 8 }; },
    resize: (width, height) => { if (!locked) { const box = panel.getBoundingClientRect(); place(box.left, box.top, width, height); } },
  });
  lock.addEventListener('click', toggle);
  lock.addEventListener('keydown', moveWithKeys);
  heading.addEventListener('pointerdown', drag);
  window.addEventListener('resize', fit);
  const onShow = (event: Event) => { if (event.target instanceof HTMLDialogElement && event.target.open) fit(); };
  panel.closest('dialog')?.addEventListener('toggle', onShow);
  paint();
  return () => { panel.closest('dialog')?.removeEventListener('toggle', onShow); finishDrag?.(); disposeResize(); lock.removeEventListener('click', toggle); lock.removeEventListener('keydown', moveWithKeys); heading.removeEventListener('pointerdown', drag); window.removeEventListener('resize', fit); };
}
