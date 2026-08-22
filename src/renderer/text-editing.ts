/**
 * Semantic macOS editing for the game's hidden text proxies.
 *
 * The application menu owns Command-A/C/X/V. This module decides whether its
 * focused renderer target belongs to Guild Wars, ordinary Chromium editing,
 * or no editor, and sends only bounded non-secret game requests to main.
 */
import type {
  GameTextEditCommand,
  GameTextEditRequest,
} from '../shared/contracts.js';
import type {
  InputTrace,
  InputTraceInputType,
  InputTraceTextPhase,
} from '../shared/input-trace.js';

type GameTextField = HTMLInputElement | HTMLTextAreaElement;

export type TextEditEventDetail = {
  command: GameTextEditCommand;
  done?: Promise<void>;
};

type TextEditingOptions = {
  /** The OSK proxy fields; anything else keeps Chromium's ordinary editing. */
  fields: Iterable<unknown>;
  edit(request: GameTextEditRequest): Promise<void>;
  diagnostics?: GameInputDiagnostics;
  trace?: InputTrace;
  log(...values: unknown[]): void;
};

const isGameTextField = (value: unknown): value is GameTextField =>
  value instanceof HTMLTextAreaElement || value instanceof HTMLInputElement;

const isOrdinaryEditable = (value: Element | null): boolean => {
  if (value instanceof HTMLTextAreaElement) {
    return !value.disabled && !value.readOnly;
  }
  if (value instanceof HTMLInputElement) {
    return !value.disabled && !value.readOnly && value.type !== 'hidden';
  }
  return value instanceof HTMLElement && value.isContentEditable;
};

const canExportText = (field: GameTextField): boolean =>
  field instanceof HTMLTextAreaElement || field.type !== 'password';

const selectedText = (field: GameTextField): string | null => {
  const start = field.selectionStart;
  const end = field.selectionEnd;
  return start !== null && end !== null && start !== end
    ? field.value.slice(start, end)
    : null;
};

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

export const installTextEditing = ({
  fields,
  edit,
  diagnostics,
  trace,
  log,
}: TextEditingOptions): void => {
  const sources = new Set<GameTextField>();
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
      inputType: type,
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
      '[warn] clipboard edit refused:',
      error instanceof Error ? error.message : String(error),
    );
  };

  window.addEventListener('gw:text-edit', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as TextEditEventDetail | undefined;
    if (!detail || ![
      'copy',
      'cut',
      'paste',
      'selectAll',
    ].includes(detail.command)) return;

    const active = document.activeElement;
    if (!isGameTextField(active) || !sources.has(active)) {
      // Main performs normal Chromium editing only for a real editable target.
      // A canvas, button, or body focus is a handled no-op.
      if (!isOrdinaryEditable(active)) event.preventDefault();
      return;
    }

    event.preventDefault();
    let request: GameTextEditRequest | null = null;
    if (detail.command === 'selectAll') {
      // Guild Wars keeps its visible selection internally. Mirror this one
      // semantic selection onto the proxy so a following Cut can export the
      // exact selected text before the destructive Control-X chord.
      active.select();
      request = { command: 'selectAll' };
    } else if (detail.command === 'paste') {
      request = { command: detail.command };
    } else if (canExportText(active)) {
      const selected = selectedText(active);
      if (detail.command === 'copy') {
        const text = selected ?? active.value;
        if (text) request = { command: 'copy', text };
      } else if (selected) {
        request = { command: 'cut', text: selected };
      }
    }

    if (!request) return;
    detail.done = edit(request).then(
      () => {
        if (request.command === 'copy' || request.command === 'cut') {
          diagnostics?.event('clipboard.copied');
        }
      },
      (error) => {
        reportClipboardFailure(error);
        throw error;
      },
    );
  });
};
