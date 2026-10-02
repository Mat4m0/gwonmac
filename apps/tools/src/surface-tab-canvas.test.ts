/**
 * D-12 at the surface controller (HUB-003, KEY-35): while the game canvas has
 * the keyboard, an open popout never claims Tab. Tab and the Space after it
 * reach the game's listeners with their releases, focus stays on the canvas,
 * and the popout stays open. Tab on the popout itself is still the popout's.
 */
import { beforeAll, describe, expect, it } from 'vitest';
// The production owner, exercised with trusted-looking events.
// eslint-disable-next-line no-restricted-imports
import { installSurfaceController } from '../../../src/renderer/surface-controller';

let canvas: HTMLCanvasElement;
let popout: HTMLDivElement;
let search: HTMLInputElement;
let dismissed = 0;
/** What a listener registered after the controller (the game's input) received. */
const reached: string[] = [];

beforeAll(() => {
  const controller = installSurfaceController(document);
  popout = document.createElement('div');
  popout.innerHTML = '<input aria-label="Search Trade"><button>Close</button>';
  search = popout.querySelector('input')!;
  canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  canvas.tabIndex = 0;
  document.body.append(popout, canvas);
  // A non-modal popout (Trade, Whispers) is the topmost open surface.
  controller.register({ root: popout, priority: 4, dismiss() { dismissed++; } }).setOpen(true);
  for (const type of ['keydown', 'keyup']) {
    window.addEventListener(type, event => {
      const { code, defaultPrevented } = event as KeyboardEvent;
      reached.push(`${type}:${code}${defaultPrevented && code !== 'Tab' ? ':prevented' : ''}`);
    }, true);
  }
});

function key(target: Element, type: 'keydown' | 'keyup', code: 'Tab' | 'Space', shiftKey = false) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, key: code === 'Tab' ? 'Tab' : ' ', code, shiftKey });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
  return event;
}

describe('Tab with a popout open', () => {
  it('reaches the game with the Space after it while the canvas has focus', () => {
    for (const shiftKey of [false, true]) {
      reached.length = 0;
      canvas.focus();
      const tab = key(canvas, 'keydown', 'Tab', shiftKey);
      // Chromium's own focus step would carry the canvas's focus into the popout.
      expect(tab.defaultPrevented).toBe(true);
      key(canvas, 'keyup', 'Tab', shiftKey);
      key(canvas, 'keydown', 'Space');
      key(canvas, 'keyup', 'Space');
      expect(document.activeElement).toBe(canvas);
      expect(reached).toEqual(['keydown:Tab', 'keyup:Tab', 'keydown:Space', 'keyup:Space']);
    }
    expect(dismissed).toBe(0);
  });

  it('still belongs to the popout when the popout has focus', () => {
    reached.length = 0;
    search.focus();
    key(search, 'keydown', 'Tab', true);
    key(search, 'keyup', 'Tab', true);
    // Shift-Tab from the first control is claimed; neither its press nor its release reaches the game.
    expect(reached).toEqual([]);
    expect(popout.contains(document.activeElement)).toBe(true);
  });
});
