/**
 * The shared click-run gate (HUB-242, HUB-244): a double-click never runs what
 * its first click revealed, and the trailing clicks of a run whose page changed
 * reach nobody, the game canvas included. Rapid clicks on an unchanged page still count.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// The production owner, exercised with trusted-looking events.
// eslint-disable-next-line no-restricted-imports
import { armConfirmation, CONFIRMATION_ARMING_MS, installSurfaceController } from '../../../src/renderer/surface-controller';

type Controller = ReturnType<typeof installSurfaceController>;
let controller: Controller;
/** What a listener registered after the controller (such as `input.ts`) received. */
const later: string[] = [];

beforeAll(() => {
  controller = installSurfaceController(document);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
    window.addEventListener(type, event => later.push(`${type}:${(event as MouseEvent).detail}`), true);
  }
});
afterEach(() => {
  document.body.replaceChildren();
  // Each test starts with no click run in progress: one fresh press far away.
  fire(document.body, 'mousedown', 1, true, 900);
  later.length = 0;
});

function fire(target: Element, type: string, detail: number, trusted = true, x = 40) {
  const init = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 40, detail };
  const event = type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init);
  if (trusted) Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
  return event;
}
/** One physical press and release of a click run, as Chromium dispatches it. */
function press(target: Element, detail: number, x = 40) {
  return ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', ...(detail === 2 ? ['dblclick'] : [])]
    .map(type => fire(target, type, type.startsWith('pointer') ? 0 : detail, true, x));
}

function mount() {
  const root = document.createElement('div');
  root.innerHTML = '<div class="row">Row</div><button class="primary">Apply</button><label class="setting"><input type="checkbox"> Whispers</label>';
  const canvas = document.createElement('canvas'); canvas.id = 'canvas';
  document.body.append(root, canvas);
  const surface = controller.register({ root, priority: 6, dismiss() {} });
  surface.setOpen(true);
  const row = root.querySelector('.row')!;
  const received: string[] = [];
  for (const [name, element] of [['row', row], ['primary', root.querySelector('.primary')!], ['canvas', canvas]] as const) {
    for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown']) element.addEventListener(type, event => received.push(`${name} ${type}:${(event as MouseEvent).detail}`));
  }
  return { surface, row, canvas, received, primary: root.querySelector('.primary')!, label: root.querySelector('.setting')!, checkbox: root.querySelector('input')! };
}

describe('click runs', () => {
  it('cancels the rest of a run whose page changed after its first press, wherever it lands', () => {
    for (const where of ['row', 'primary', 'label', 'canvas'] as const) {
      const view = mount();
      press(view.row, 1);
      expect(view.received).toEqual(['row pointerdown:0', 'row mousedown:1', 'row click:1']);
      view.received.length = 0; later.length = 0;
      // resetView, close, suspend or a Characters view change.
      view.surface.pageChanged();
      const target = where === 'label' ? view.label : view[where];
      for (const detail of [2, 3]) {
        const events = press(target, detail);
        // The pointerdown is kept from every listener; the rest of the press is also cancelled.
        expect(events.slice(1).every(event => event.defaultPrevented), `${where} × ${detail}`).toBe(true);
      }
      expect(view.received, where).toEqual([]);
      expect(later, where).toEqual([]);
      expect(view.checkbox.checked).toBe(false);
      // The next fresh press, a little later or elsewhere, is delivered normally.
      const fresh = press(view.canvas, 1, 400);
      expect(fresh.some(event => event.defaultPrevented)).toBe(false);
      expect(view.received).toEqual(['canvas pointerdown:0', 'canvas mousedown:1', 'canvas click:1']);
      document.body.replaceChildren();
    }
  });

  it('delivers rapid clicks on an unchanged page, so the row\'s own double-click runs once', () => {
    const view = mount();
    let runs = 0;
    view.row.addEventListener('dblclick', () => { runs += 1; });
    press(view.row, 1);
    const events = press(view.row, 2);
    expect(events.some(event => event.defaultPrevented)).toBe(false);
    expect(runs).toBe(1);
    expect(view.received.filter(entry => entry.startsWith('row click'))).toEqual(['row click:1', 'row click:2']);
  });

  it('never lets a run that began on a surface continue into the game after the surface closed', () => {
    const view = mount();
    press(view.primary, 1);
    view.surface.setOpen(false);
    press(view.canvas, 2);
    press(view.canvas, 3);
    expect(view.received.filter(entry => entry.startsWith('canvas'))).toEqual([]);
  });

  it('never lets a run that began on a surface continue into the game while it stays open', () => {
    const view = mount();
    press(view.row, 1);
    press(view.canvas, 2);
    expect(view.received.filter(entry => entry.startsWith('canvas'))).toEqual([]);
  });

  it('keeps the trailing pointerdown within the player\'s slower double-click speed', () => {
    // A press later than the macOS default (500 ms) still continues the run
    // when the player slowed Double-click speed, as Chromium counts it.
    const slow = installSurfaceController(document, { doubleClickMs: 1500 });
    const root = document.createElement('div');
    const canvas = document.createElement('canvas');
    document.body.append(root, canvas);
    const surface = slow.register({ root, priority: 6, dismiss() {} });
    surface.setOpen(true);
    const received: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'click']) canvas.addEventListener(type, event => received.push(`${type}:${(event as MouseEvent).detail}`));
    const at = (type: string, detail: number, timeStamp: number, target: Element = canvas) => {
      const event = type.startsWith('pointer')
        ? new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 40 })
        : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 40, detail });
      Object.defineProperty(event, 'isTrusted', { value: true });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      target.dispatchEvent(event);
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) at(type, type.startsWith('pointer') ? 0 : 1, 1000, root);
    surface.setOpen(false);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) at(type, type.startsWith('pointer') ? 0 : 2, 2200);
    expect(received).toEqual([]);
    // Past the player's interval a press is a fresh one.
    for (const type of ['pointerdown', 'mousedown', 'click']) at(type, type.startsWith('pointer') ? 0 : 1, 4000);
    expect(received).toEqual(['pointerdown:0', 'mousedown:1', 'click:1']);
  });

  it('leaves the game\'s own double-clicks and synthetic events alone', () => {
    const view = mount();
    press(view.canvas, 1);
    view.surface.pageChanged();
    press(view.canvas, 2);
    expect(view.received.filter(entry => entry.startsWith('canvas'))).toEqual([
      'canvas pointerdown:0', 'canvas mousedown:1', 'canvas click:1',
      'canvas pointerdown:0', 'canvas mousedown:2', 'canvas click:2', 'canvas dblclick:2',
    ]);
    // A synthetic release (input.ts replays held buttons) is never swallowed.
    press(view.row, 1);
    view.surface.pageChanged();
    const synthetic = fire(view.canvas, 'mouseup', 2, false);
    expect(synthetic.defaultPrevented).toBe(false);
  });
});

describe('confirmation arming', () => {
  it('accepts nothing before ~400 ms and never the later click of a multi-click', () => {
    vi.useFakeTimers();
    try {
      const button = document.createElement('button');
      const arming = armConfirmation(button);
      arming.arm();
      expect(arming.accepts()).toBe(false);
      expect(button.hasAttribute('data-armed')).toBe(false);
      vi.advanceTimersByTime(CONFIRMATION_ARMING_MS);
      expect(button.hasAttribute('data-armed')).toBe(true);
      expect(arming.accepts()).toBe(true);
      expect(arming.accepts(new MouseEvent('click', { detail: 1 }))).toBe(true);
      expect(arming.accepts(new MouseEvent('click', { detail: 0 }))).toBe(true);
      expect(arming.accepts(new MouseEvent('click', { detail: 2 }))).toBe(false);
      arming.arm();
      expect(arming.accepts()).toBe(false);
      arming.disarm();
      vi.advanceTimersByTime(CONFIRMATION_ARMING_MS);
      expect(arming.accepts()).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
