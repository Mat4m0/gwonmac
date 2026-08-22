/**
 * Trusted input sequences for the game's hidden OSK text proxies.
 *
 * Chromium owns the proxy, but Guild Wars owns the visible editor. Keep the
 * two protocols together so the IPC boundary only validates and delegates.
 */
import { clipboard, type WebContents } from 'electron';
import {
  CLIPBOARD_TEXT_CEILING,
  type GameTextEditRequest,
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

export async function editGameText(
  contents: WebContents,
  request: GameTextEditRequest,
): Promise<void> {
  if (request.command === 'copy') {
    clipboard.writeText(request.text);
    return;
  }

  if (request.command === 'cut') {
    // Cut is one ordered native action: the selected text reaches the
    // pasteboard before Guild Wars receives the destructive chord.
    clipboard.writeText(request.text);
    sendControlChord(contents, 'X');
    return;
  }

  if (request.command === 'selectAll') {
    // The visible editor understands Windows-style Control chords. Editing
    // Chromium's hidden proxy alone would leave the game field unchanged.
    sendControlChord(contents, 'A');
    return;
  }

  // ArenaNet distinguishes Paste from ordinary typing by InputEvent.inputType.
  // Use Chromium's native command so the focused proxy emits insertFromPaste;
  // insertText emits insertText and the official client treats the complete
  // clipboard payload as one typing operation instead.
  const text = clipboard.readText();
  if (!text || text.length > CLIPBOARD_TEXT_CEILING) return;
  contents.paste();
}
