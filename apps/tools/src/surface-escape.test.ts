/**
 * The one Escape rule at the surface controller (HUB-005, HUB-079, HUB-120):
 * a surface that holds focus answers Escape itself first, innermost level
 * first, then an open disclosure closes, and only then the surface's own
 * escape runs; one step per physical press, never during composition, and
 * never into the game. From outside every surface, Escape reaches the topmost
 * surface's escape, which may still step out of an inner level.
 */
import { beforeEach, describe, expect, it } from 'vitest';
// The production owner, exercised with trusted-looking events.
// eslint-disable-next-line no-restricted-imports
import { installSurfaceController } from '../../../src/renderer/surface-controller';

const controller = installSurfaceController(document);
let canvas: HTMLCanvasElement;
let popout: HTMLDivElement;
let search: HTMLInputElement;
let summary: HTMLElement;
let details: HTMLDetailsElement;
let escapes = 0;
let dismissals = 0;
/** What the game's listener, registered after the controller on the window, received. */
const reached: string[] = [];
window.addEventListener('keydown', event => reached.push(event.key));

beforeEach(() => {
  document.body.replaceChildren();
  escapes = 0; dismissals = 0; reached.length = 0;
  popout = document.createElement('div');
  popout.innerHTML = '<input aria-label="Find a friend"><details><summary>Options</summary><button>Mute</button></details>';
  search = popout.querySelector('input')!;
  details = popout.querySelector('details')!;
  summary = popout.querySelector('summary')!;
  // The popout's own control answers an inner level: a typed query clears first.
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && search.value) { event.preventDefault(); search.value = ''; }
  });
  canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.append(popout, canvas);
  controller.register({ root: popout, priority: 4, dismiss() { dismissals++; }, escape() { escapes++; } }).setOpen(true);
});

function escape(target: Element, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, key: 'Escape', code: 'Escape', ...init });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
  return event;
}

describe('Escape on a focused surface', () => {
  it('lets the surface clear its own query first, then steps out, one step per press', () => {
    search.value = 'ro';
    search.focus();
    expect(escape(search).defaultPrevented).toBe(true);
    expect(search.value).toBe('');
    expect(escapes).toBe(0);
    escape(search, { repeat: true });
    expect(escapes).toBe(0);
    escape(search);
    expect(escapes).toBe(1);
    expect(dismissals).toBe(0);
    expect(reached).toEqual([]);
  });

  it('closes an open disclosure before the surface and returns focus to its summary', () => {
    details.open = true;
    popout.querySelector('button')!.focus();
    escape(popout.querySelector('button')!);
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(escapes).toBe(0);
  });

  it('leaves an Escape during composition to the input method', () => {
    search.value = 'ro';
    search.focus();
    expect(escape(search, { isComposing: true }).defaultPrevented).toBe(false);
    expect(search.value).toBe('ro');
    expect(escapes).toBe(0);
  });
});

describe('Escape from outside every surface', () => {
  it('runs the topmost surface escape and keeps the press from the game', () => {
    canvas.focus();
    expect(escape(canvas).defaultPrevented).toBe(true);
    expect(escapes).toBe(1);
    expect(reached).toEqual([]);
  });
});
