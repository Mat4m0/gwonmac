/**
 * Native macOS editing for the game's hidden text proxies.
 *
 * The official client understands Windows-style Control chords and also sees
 * Command combinations as their unmodified base keys. Claiming Command editing
 * here gives players one predictable macOS contract and keeps A/C/V/X out of
 * the game input stream. The proxy's input event remains the single route by
 * which an edit reaches the client.
 */

type GameTextField = HTMLInputElement | HTMLTextAreaElement;

type TextEditingOptions = {
  /** The OSK proxy fields; anything else keeps Chromium's ordinary editing. */
  fields: Iterable<unknown>;
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
  diagnostics?: GameInputDiagnostics;
  log(...values: unknown[]): void;
};

type EditingKey = 'KeyA' | 'KeyC' | 'KeyV' | 'KeyX';

const EDITING_KEYS = new Set<EditingKey>(['KeyA', 'KeyC', 'KeyV', 'KeyX']);

const isGameTextField = (value: unknown): value is GameTextField =>
  value instanceof HTMLTextAreaElement || value instanceof HTMLInputElement;

const canExportText = (field: GameTextField): boolean =>
  field instanceof HTMLTextAreaElement || field.type !== 'password';

const selection = (field: GameTextField) => ({
  start: field.selectionStart,
  end: field.selectionEnd,
});

function replaceSelection(
  field: GameTextField,
  text: string,
  inputType: 'deleteByCut' | 'insertFromPaste',
): void {
  const { start, end } = selection(field);
  if (start === null || end === null) {
    // Number inputs expose no selection API. Replacing their complete value is
    // the closest truthful native edit and avoids a second browser-only model.
    field.value = text;
  } else {
    field.setRangeText(text, start, end, 'end');
  }
  field.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    data: text || null,
    inputType,
  }));
}

export const installTextEditing = ({
  fields,
  writeText,
  readText,
  diagnostics,
  log,
}: TextEditingOptions): void => {
  const sources = new Set<GameTextField>();
  const claimedKeys = new Set<EditingKey>();
  for (const field of fields) {
    if (isGameTextField(field)) sources.add(field);
  }

  const reportClipboardFailure = (operation: 'read' | 'write', error: unknown) => {
    if (operation === 'write') diagnostics?.event('clipboard.writeFailed', error);
    log(
      `[warn] clipboard ${operation} refused:`,
      error instanceof Error ? error.message : String(error),
    );
  };

  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted || !EDITING_KEYS.has(event.code as EditingKey)) return;
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const active = document.activeElement;
    if (!isGameTextField(active) || !sources.has(active)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const code = event.code as EditingKey;
    if (claimedKeys.has(code) || event.repeat) return;
    claimedKeys.add(code);

    if (code === 'KeyA') {
      active.select();
      return;
    }

    if (code === 'KeyC') {
      if (!canExportText(active)) return;
      const { start, end } = selection(active);
      const text = start !== null && end !== null && start !== end
        ? active.value.slice(start, end)
        : active.value;
      if (!text) return;
      void writeText(text).then(
        () => diagnostics?.event('clipboard.copied'),
        (error: unknown) => reportClipboardFailure('write', error),
      );
      return;
    }

    if (code === 'KeyX') {
      if (!canExportText(active)) return;
      const { start, end } = selection(active);
      if (start === null || end === null || start === end) return;
      const original = active.value;
      const text = original.slice(start, end);
      void writeText(text).then(
        () => {
          diagnostics?.event('clipboard.copied');
          if (document.activeElement !== active || active.value !== original) return;
          active.setSelectionRange(start, end);
          replaceSelection(active, '', 'deleteByCut');
        },
        (error: unknown) => reportClipboardFailure('write', error),
      );
      return;
    }

    void readText().then(
      (text) => {
        if (document.activeElement === active && sources.has(active)) {
          replaceSelection(active, text, 'insertFromPaste');
        }
      },
      (error: unknown) => reportClipboardFailure('read', error),
    );
  }, true);

  window.addEventListener('keyup', (event) => {
    const code = event.code as EditingKey;
    if (!claimedKeys.delete(code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const clearClaimedKeys = () => claimedKeys.clear();
  window.addEventListener('blur', clearClaimedKeys);
  window.addEventListener('pagehide', clearClaimedKeys);
  window.addEventListener('gw:input-reset', clearClaimedKeys);
  window.addEventListener('gw:input-release', (event) => {
    if (event instanceof CustomEvent) claimedKeys.delete(event.detail as EditingKey);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearClaimedKeys();
  });
};
