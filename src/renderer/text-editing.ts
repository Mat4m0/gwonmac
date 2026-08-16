/**
 * Native macOS editing for the game's hidden text proxies.
 *
 * The official client understands Windows-style Control chords and also sees
 * Command combinations as their unmodified base keys. Claiming Command editing
 * here gives players one predictable macOS contract and keeps the Command
 * chord itself out of the game input stream. Copy and paste use the proxy;
 * select-all and cut translate to the Control chords the visible game editor
 * already owns.
 */
import type { TextEditCommand } from '../shared/contracts.js';
import type {
  InputTrace,
  InputTraceInputType,
  InputTraceLengthDelta,
  InputTraceTextPhase,
} from '../shared/input-trace.js';

type GameTextField = HTMLInputElement | HTMLTextAreaElement;

type TextEditingOptions = {
  /** The OSK proxy fields; anything else keeps Chromium's ordinary editing. */
  fields: Iterable<unknown>;
  writeText(text: string): Promise<void>;
  edit(command: TextEditCommand): Promise<void>;
  diagnostics?: GameInputDiagnostics;
  trace?: InputTrace;
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

const inputType = (value: string): InputTraceInputType => {
  if (value === 'insertText') return 'insert-text';
  if (value === 'insertFromPaste') return 'insert-paste';
  if (value.includes('Composition')) return 'insert-composition';
  if (value === 'deleteContentBackward') return 'delete-backward';
  if (value === 'deleteContentForward') return 'delete-forward';
  if (value === 'deleteByCut') return 'delete-cut';
  if (value === 'historyUndo' || value === 'historyRedo') return 'history';
  return value ? 'other' : 'none';
};

const lengthDelta = (type: InputTraceInputType): InputTraceLengthDelta => {
  if (type.startsWith('insert-')) return 'grow';
  if (type.startsWith('delete-')) return 'shrink';
  if (type === 'history') return 'unknown';
  return 'same';
};

export const installTextEditing = ({
  fields,
  writeText,
  edit,
  diagnostics,
  trace,
  log,
}: TextEditingOptions): void => {
  const sources = new Set<GameTextField>();
  const claimedKeys = new Set<EditingKey>();
  for (const field of fields) {
    if (isGameTextField(field)) sources.add(field);
  }

  const recordText = (
    field: GameTextField,
    phase: InputTraceTextPhase,
    event: Event,
  ) => {
    if (!trace?.enabled()) return;
    const type = inputType(event instanceof InputEvent ? event.inputType : '');
    trace.record({
      source: 'renderer',
      kind: 'text',
      owner: field.type === 'password' || field.type === 'email'
        ? 'secret'
        : 'text',
      phase,
      trusted: event.isTrusted,
      repeat: false,
      inputType: type,
      // The event itself says a selection changed without exposing either
      // endpoint (which would reveal a secret field's minimum length).
      selectionChanged: phase === 'selectionchange',
      delta: phase === 'input' || phase === 'beforeinput'
        ? lengthDelta(type)
        : 'same',
    });
  };

  for (const field of sources) {
    field.addEventListener('focus', (event) => recordText(field, 'focus', event));
    field.addEventListener('blur', (event) => recordText(field, 'blur', event));
    field.addEventListener('beforeinput', (event) =>
      recordText(field, 'beforeinput', event));
    field.addEventListener('input', (event) => recordText(field, 'input', event));
    for (const phase of [
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ] as const) {
      field.addEventListener(phase, (event) => recordText(field, phase, event));
    }
  }
  document.addEventListener('selectionchange', (event) => {
    const active = document.activeElement;
    if (isGameTextField(active) && sources.has(active)) {
      recordText(active, 'selectionchange', event);
    }
  });

  const reportClipboardFailure = (error: unknown) => {
    diagnostics?.event('clipboard.writeFailed', error);
    log(
      '[warn] clipboard write refused:',
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
    trace?.record({
      source: 'renderer', kind: 'key', phase: 'down',
      owner: active.type === 'password' || active.type === 'email'
        ? 'secret'
        : 'text',
      repeat: event.repeat, trusted: event.isTrusted, decision: 'command',
    });
    if (claimedKeys.has(code) || event.repeat) {
      return;
    }
    claimedKeys.add(code);

    if (code === 'KeyA') {
      void edit('selectAll');
      return;
    }

    if (code === 'KeyV') {
      void edit('paste');
      return;
    }

    if (code === 'KeyC') {
      event.preventDefault();
      if (!canExportText(active)) return;
      const { start, end } = selection(active);
      const text = start !== null && end !== null && start !== end
        ? active.value.slice(start, end)
        : active.value;
      if (!text) return;
      void writeText(text).then(
        () => diagnostics?.event('clipboard.copied'),
        reportClipboardFailure,
      );
      return;
    }

    if (canExportText(active)) void edit('cut');
  }, true);

  window.addEventListener('keyup', (event) => {
    if (!event.isTrusted || !event.metaKey || event.ctrlKey || event.altKey) return;
    const code = event.code as EditingKey;
    if (!claimedKeys.delete(code)) return;
    const active = document.activeElement;
    trace?.record({
      source: 'renderer', kind: 'key', phase: 'up',
      owner: isGameTextField(active) &&
        (active.type === 'password' || active.type === 'email')
        ? 'secret'
        : 'text',
      repeat: event.repeat, trusted: event.isTrusted, decision: 'command',
    });
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
