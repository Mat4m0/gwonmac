/**
 * Chromium hidden-proxy contract probe for physical repeats.
 *
 * It asserts every browser edit and arrow transition instead of only the final
 * value. The native process policy and a live client check cover the AppKit
 * boundary; this test does not imitate the closed-source client's forwarding
 * glue.
 */
import { expect, test } from '@playwright/test';
import { closeOffline, launchCachedClient } from './fixtures.mjs';
import { startGameInput } from './input-helpers.js';

type KeyboardObservation = {
  phase: 'keydown' | 'keyup';
  code: string;
  repeat: boolean;
  trusted: boolean;
};

type EditObservation = {
  phase: 'beforeinput' | 'input';
  inputType: string;
  data: 'text' | 'none';
  trusted: boolean;
  value: string;
};

type RepeatProbe = {
  keyboard: KeyboardObservation[];
  edits: EditObservation[];
  arrowTransitions: string[];
};

test('native repeat edits text and retriggers hidden-proxy arrows', async () => {
  const fixture = await launchCachedClient('gw-text-repeat-contract-');
  try {
    const { app, page } = fixture;
    expect(await app.evaluate(({ systemPreferences }) =>
      systemPreferences.getUserDefault('ApplePressAndHoldEnabled', 'boolean')))
      .toBe(false);
    await startGameInput(page);
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text');
      if (!(field instanceof HTMLInputElement)) {
        throw new Error('OSK contract fixture is incomplete');
      }
      const host = window as typeof window & { __repeatProbe?: RepeatProbe };
      host.__repeatProbe = { keyboard: [], edits: [], arrowTransitions: [] };
      const heldArrows = new Set<string>();
      const observeKeyboard = (event: KeyboardEvent) => {
        host.__repeatProbe?.keyboard.push({
          phase: event.type as 'keydown' | 'keyup',
          code: event.code,
          repeat: event.repeat,
          trusted: event.isTrusted,
        });
        if (!event.key.startsWith('Arrow')) return;
        if (event.type === 'keyup') {
          heldArrows.delete(event.code);
        } else if (!heldArrows.has(event.code)) {
          heldArrows.add(event.code);
          host.__repeatProbe?.arrowTransitions.push(event.key);
        }
      };
      field.addEventListener('keydown', observeKeyboard);
      field.addEventListener('keyup', observeKeyboard);
      for (const phase of ['beforeinput', 'input'] as const) {
        field.addEventListener(phase, (event) => {
          if (!(event instanceof InputEvent)) return;
          host.__repeatProbe?.edits.push({
            phase,
            inputType: event.inputType,
            data: event.data === null ? 'none' : 'text',
            trusted: event.isTrusted,
            value: field.value,
          });
        });
      }
      field.value = 'seed';
      field.focus();
      field.setSelectionRange(4, 4);
      (window.Module as { oskActiveInput?: Element | null }).oskActiveInput = field;
    });

    const cdp = await app.context().newCDPSession(page);
    const key = async (
      type: 'keyDown' | 'keyUp',
      code: string,
      keyValue: string,
      windowsVirtualKeyCode: number,
      repeat = false,
      text?: string,
    ) => cdp.send('Input.dispatchKeyEvent', {
      type,
      code,
      key: keyValue,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      autoRepeat: repeat,
      ...(text === undefined ? {} : { text }),
    });
    const held = async (
      code: string,
      keyValue: string,
      windowsVirtualKeyCode: number,
      text?: string,
    ) => {
      await key('keyDown', code, keyValue, windowsVirtualKeyCode, false, text);
      await key('keyDown', code, keyValue, windowsVirtualKeyCode, true, text);
      await key('keyDown', code, keyValue, windowsVirtualKeyCode, true, text);
      await key('keyUp', code, keyValue, windowsVirtualKeyCode);
    };

    await held('KeyL', 'l', 76, 'l');
    await held('Backspace', 'Backspace', 8);
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text') as HTMLInputElement;
      field.value = 'abcdef';
      field.setSelectionRange(2, 2);
    });
    await held('Delete', 'Delete', 46);

    for (const [code, keyValue, virtualKeyCode] of [
      ['ArrowUp', 'ArrowUp', 38],
      ['ArrowDown', 'ArrowDown', 40],
      ['ArrowLeft', 'ArrowLeft', 37],
      ['ArrowRight', 'ArrowRight', 39],
    ] as const) {
      await held(code, keyValue, virtualKeyCode);
    }
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text') as HTMLInputElement;
      field.value = 'abcdef';
      field.setSelectionRange(2, 5);
    });
    await key('keyDown', 'Backspace', 'Backspace', 8);
    await key('keyDown', 'Backspace', 'Backspace', 8, true);
    await key('keyUp', 'Backspace', 'Backspace', 8);
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text') as HTMLInputElement;
      field.value = 'abcdef';
      field.setSelectionRange(1, 4);
    });
    await key('keyDown', 'Delete', 'Delete', 46);
    await key('keyDown', 'Delete', 'Delete', 46, true);
    await key('keyUp', 'Delete', 'Delete', 46);

    const editsBeforeBoundaries = await page.evaluate(() =>
      (window as typeof window & { __repeatProbe?: RepeatProbe })
        .__repeatProbe?.edits.length);
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text') as HTMLInputElement;
      field.value = 'abc';
      field.setSelectionRange(0, 0);
    });
    await held('Backspace', 'Backspace', 8);
    await page.evaluate(() => {
      const field = document.getElementById('osk-input-text') as HTMLInputElement;
      field.setSelectionRange(field.value.length, field.value.length);
    });
    await held('Delete', 'Delete', 46);

    const probe = await page.evaluate(() =>
      (window as typeof window & { __repeatProbe?: RepeatProbe }).__repeatProbe);
    expect(probe).toBeDefined();
    expect(probe!.keyboard.filter(({ trusted }) => !trusted).map(({ phase, code }) => ({
      phase, code,
    }))).toEqual([
      ...Array(2).fill({ phase: 'keyup', code: 'ArrowUp' }),
      ...Array(2).fill({ phase: 'keyup', code: 'ArrowDown' }),
      ...Array(2).fill({ phase: 'keyup', code: 'ArrowLeft' }),
      ...Array(2).fill({ phase: 'keyup', code: 'ArrowRight' }),
    ]);
    expect(probe!.keyboard.filter(({ phase, repeat }) => phase === 'keydown' && repeat))
      .toHaveLength(20);
    expect(probe!.arrowTransitions).toEqual([
      ...Array(3).fill('ArrowUp'),
      ...Array(3).fill('ArrowDown'),
      ...Array(3).fill('ArrowLeft'),
      ...Array(3).fill('ArrowRight'),
    ]);

    expect(probe!.edits.every(({ trusted }) => trusted)).toBe(true);
    expect(probe!.edits.map(({ phase, inputType, data }) => ({
      phase, inputType, data,
    }))).toEqual([
      ...Array.from({ length: 3 }, () => [
        { phase: 'beforeinput', inputType: 'insertText', data: 'text' },
        { phase: 'input', inputType: 'insertText', data: 'text' },
      ]).flat(),
      ...Array.from({ length: 3 }, () => [
        { phase: 'beforeinput', inputType: 'deleteContentBackward', data: 'none' },
        { phase: 'input', inputType: 'deleteContentBackward', data: 'none' },
      ]).flat(),
      ...Array.from({ length: 3 }, () => [
        { phase: 'beforeinput', inputType: 'deleteContentForward', data: 'none' },
        { phase: 'input', inputType: 'deleteContentForward', data: 'none' },
      ]).flat(),
      ...Array.from({ length: 2 }, () => [
        { phase: 'beforeinput', inputType: 'deleteContentBackward', data: 'none' },
        { phase: 'input', inputType: 'deleteContentBackward', data: 'none' },
      ]).flat(),
      ...Array.from({ length: 2 }, () => [
        { phase: 'beforeinput', inputType: 'deleteContentForward', data: 'none' },
        { phase: 'input', inputType: 'deleteContentForward', data: 'none' },
      ]).flat(),
      ...Array.from({ length: 3 }, () => ({
        phase: 'beforeinput', inputType: 'deleteContentBackward', data: 'none',
      })),
      ...Array.from({ length: 3 }, () => ({
        phase: 'beforeinput', inputType: 'deleteContentForward', data: 'none',
      })),
    ]);
    expect(probe!.edits.filter(({ phase }) => phase === 'input').map(({ value }) => value))
      .toEqual([
        'seedl', 'seedll', 'seedlll',
        'seedll', 'seedl', 'seed',
        'abdef', 'abef', 'abf',
        'abf', 'af',
        'aef', 'af',
      ]);
    expect(probe!.edits).toHaveLength((editsBeforeBoundaries ?? 0) + 6);
  } finally {
    await closeOffline(fixture);
  }
});
