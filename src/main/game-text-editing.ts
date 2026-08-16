/**
 * Trusted input sequences for the game's hidden OSK text proxies.
 *
 * Chromium owns the proxy, but Guild Wars owns the visible editor. Keep the
 * two protocols together so the IPC boundary only validates and delegates.
 */
import { clipboard, type WebContents } from 'electron';
import {
  CLIPBOARD_TEXT_CEILING,
  type TextEditCommand,
} from '../shared/contracts.js';

const sendControlChord = (contents: WebContents, keyCode: 'A' | 'X'): void => {
  contents.sendInputEvent({
    type: 'keyDown', keyCode: 'Control', modifiers: ['control'],
  });
  contents.sendInputEvent({
    type: 'keyDown', keyCode, modifiers: ['control'],
  });
  contents.sendInputEvent({
    type: 'keyUp', keyCode, modifiers: ['control'],
  });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Control' });
};

export function editGameText(
  contents: WebContents,
  command: TextEditCommand,
): void {
  if (command === 'selectAll' || command === 'cut') {
    // The visible editor understands Windows-style Control chords. Editing
    // Chromium's hidden proxy alone would leave the game field unchanged.
    sendControlChord(contents, command === 'selectAll' ? 'A' : 'X');
    return;
  }

  // ArenaNet's OSK listener forwards InputEvent.data, which Chromium's native
  // paste does not populate. Keep the secret in main and replay the trusted
  // keyboard/input contract without sending clipboard contents over IPC.
  const text = clipboard.readText().slice(0, CLIPBOARD_TEXT_CEILING);
  for (const character of text) {
    contents.sendInputEvent({ type: 'keyDown', keyCode: character });
    contents.sendInputEvent({ type: 'char', keyCode: character });
    contents.sendInputEvent({ type: 'keyUp', keyCode: character });
  }
}
