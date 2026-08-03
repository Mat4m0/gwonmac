/**
 * Cmd+C from the game's text proxy to the OS clipboard. The Emscripten client
 * ships no clipboard platform layer — the Windows client's SetClipboardData
 * path was never ported — so the one copy the host can perform truthfully is
 * of the OSK proxy field the client is editing through. This module refuses to
 * approximate canvas-rendered text (chat lines, item names, guild status): it
 * has no model of it, and docs/user-guide.md records that limitation.
 */

type ClipboardField = HTMLInputElement | HTMLTextAreaElement;

type ClipboardCopyOptions = {
  /** The OSK proxy fields; anything else never reaches the clipboard. */
  fields: Iterable<unknown>;
  writeText(text: string): Promise<void>;
  diagnostics?: GameInputDiagnostics;
  log(...values: unknown[]): void;
};

const isCopyableField = (value: unknown): value is ClipboardField =>
  value instanceof HTMLTextAreaElement ||
  // The password proxy is excluded the way Chromium excludes password
  // inputs from native copy: secrets do not leave through this path.
  (value instanceof HTMLInputElement && value.type !== 'password');

export const installClipboardCopy = ({
  fields,
  writeText,
  diagnostics,
  log,
}: ClipboardCopyOptions): void => {
  const sources = new Set<ClipboardField>();
  for (const field of fields) {
    if (isCopyableField(field)) sources.add(field);
  }

  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.code !== 'KeyC') return;
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    const active = document.activeElement;
    if (!isCopyableField(active) || !sources.has(active)) return;
    const { selectionStart, selectionEnd, value } = active;
    // The client tracks its in-field selection internally and does not mirror
    // every change onto the proxy, so a collapsed DOM selection means the
    // whole field — the "copy what I typed" the native path cannot offer —
    // rather than nothing.
    const text =
      selectionStart !== null &&
      selectionEnd !== null &&
      selectionStart !== selectionEnd
        ? value.slice(selectionStart, selectionEnd)
        : value;
    if (!text) return;
    writeText(text).then(
      () => diagnostics?.event('clipboard.copied'),
      (error: unknown) => {
        diagnostics?.event('clipboard.writeFailed', error);
        log(
          '[warn] clipboard write refused:',
          error instanceof Error ? error.message : String(error),
        );
      },
    );
  }, true);
};
