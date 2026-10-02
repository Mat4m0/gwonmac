/**
 * The owned-press rule at the character-select boundary (HUB-003): with the
 * production surface controller and game input installed in their boot order,
 * a held Enter that a surface owned never reaches the canvas, not as a trusted
 * repeat and not as the buffered synthetic Enter that presses Play. A fresh
 * physical Enter on the canvas is still buffered exactly once.
 */
import { beforeAll, describe, expect, it } from 'vitest';
// The production owners, exercised with trusted-looking events.
// eslint-disable-next-line no-restricted-imports
import { installSurfaceController } from '../../../src/renderer/surface-controller';
// eslint-disable-next-line no-restricted-imports
import { installGameInput } from '../../../src/renderer/input';

let canvas: HTMLCanvasElement;
let button: HTMLButtonElement;
let input: ReturnType<typeof installGameInput>;
/** What the game's canvas listeners received. */
const reached: string[] = [];

beforeAll(() => {
  // Boot order: dialogs and surfaces first, game input when the client loads.
  const controller = installSurfaceController(document);
  const surface = document.createElement('div');
  button = document.createElement('button');
  surface.append(button);
  canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  canvas.tabIndex = 0;
  document.body.append(surface, canvas);
  controller.register({ root: surface, priority: 6, dismiss() {} }).setOpen(true);
  input = installGameInput({ canvas, log() {} });
  for (const type of ['keydown', 'keyup']) {
    canvas.addEventListener(type, event => {
      const key = event as KeyboardEvent;
      reached.push(`${type}:${key.code}${key.repeat ? ':repeat' : ''}${key.isTrusted ? '' : ':synthetic'}`);
    });
  }
});

function key(target: Element, type: 'keydown' | 'keyup', repeat = false) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, key: 'Enter', code: 'Enter', repeat });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
}
const afterBufferedEnter = () => new Promise(resolve => setTimeout(resolve, 260));

describe('a held Enter at character selection', () => {
  it('never reaches the canvas when a surface owned the press, and a fresh Enter is buffered once', async () => {
    input.expectCharacterSelection();
    key(button, 'keydown');
    // The press closed the surface; focus is back on the canvas while Enter is still held.
    canvas.focus();
    for (let repeat = 0; repeat < 3; repeat++) key(canvas, 'keydown', true);
    key(canvas, 'keyup');
    await afterBufferedEnter();
    expect(reached).toEqual([]);

    key(canvas, 'keydown');
    key(canvas, 'keyup');
    await afterBufferedEnter();
    expect(reached).toEqual(['keydown:Enter:synthetic', 'keyup:Enter:synthetic']);
  });

  it('never buffers a repeat of a press that started before the window opened', async () => {
    reached.length = 0;
    canvas.focus();
    key(canvas, 'keydown');
    input.expectCharacterSelection();
    key(canvas, 'keydown', true);
    await afterBufferedEnter();
    key(canvas, 'keyup');
    expect(reached.filter(entry => entry.endsWith(':synthetic'))).toEqual([]);
  });
});
