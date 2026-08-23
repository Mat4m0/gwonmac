/**
 * Owns Settings shortcut capture, conflict replacement, rendering, and cleanup.
 * Generic Settings persistence stays with the classic Settings entry point.
 */
import type { AppSettings } from '../shared/contracts.js';
import {
  resolveShortcuts,
  shortcutConflict,
  shortcutDisplay,
  shortcutReserved,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  withShortcutOverride,
  type ShortcutAction,
  type ShortcutBinding,
} from '../shared/keyboard-shortcuts.js';

type FeedbackTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error';

export type ShortcutSettingsBinder = Readonly<{
  render: (settings: AppSettings) => Promise<void>;
}>;

export function bindShortcutSettings(options: Readonly<{
  form: HTMLFormElement;
  dialog: HTMLDialogElement;
  restore: HTMLElement;
  settings: () => AppSettings | null;
  persist: (overrides: AppSettings['shortcutOverrides']) => Promise<unknown>;
  recoverAfterPersistFailure: (message: string) => Promise<void>;
  feedback: (message: string, tone: FeedbackTone, resetAfter?: number) => void;
}>): ShortcutSettingsBinder {
  let recording: ShortcutAction | null = null;
  let pendingReplacement:
    | { action: ShortcutAction; conflict: ShortcutAction; binding: ShortcutBinding }
    | null = null;
  const discoveredRows = new Map<ShortcutAction, HTMLElement>(
    [...options.form.querySelectorAll<HTMLElement>('[data-shortcut-action]')]
      .map((row) => [row.dataset.shortcutAction as ShortcutAction, row]),
  );
  const rows = new Map<ShortcutAction, HTMLElement>(SHORTCUT_ACTIONS.map((action) => {
    const row = discoveredRows.get(action);
    if (!row) throw new Error(`missing shortcut row: ${action}`);
    return [action, row];
  }));

  function parts(action: ShortcutAction) {
    const row = rows.get(action);
    if (!row) throw new Error(`missing shortcut row: ${action}`);
    const value = row.querySelector<HTMLElement>('.settings-shortcut-value');
    const change = row.querySelector<HTMLButtonElement>('.settings-shortcut-change');
    const message = row.querySelector<HTMLElement>('.settings-shortcut-message');
    const replace = row.querySelector<HTMLButtonElement>('.settings-shortcut-replace');
    if (!value || !change || !message || !replace) {
      throw new Error(`incomplete shortcut row: ${action}`);
    }
    return { value, change, message, replace };
  }

  function clearMessages(): void {
    for (const action of rows.keys()) {
      const { message, replace } = parts(action);
      message.textContent = '';
      message.hidden = true;
      replace.hidden = true;
    }
  }

  async function render(settings: AppSettings): Promise<void> {
    const resolved = resolveShortcuts(settings.shortcutOverrides);
    for (const action of rows.keys()) {
      const { value, change } = parts(action);
      value.textContent = recording === action
        ? 'Listening…'
        : shortcutDisplay(resolved[action]);
      change.textContent = recording === action ? 'Cancel' : 'Change';
    }
  }

  async function save(overrides: AppSettings['shortcutOverrides']): Promise<void> {
    options.feedback('Saving…', 'progress');
    try {
      await options.persist(overrides);
      options.feedback('Shortcut saved.', 'success', 2200);
    } catch {
      await options.recoverAfterPersistFailure(
        'Review the active shortcuts before trying again.',
      );
      const current = options.settings();
      if (current) await render(current);
    } finally {
      // A captured Command chord can lose its key-up to AppKit. Once the
      // setting transaction settles, release the capture claim so the newly
      // assigned shortcut is usable immediately. Auto-repeat is still ignored
      // by the main-process shortcut controller.
      await window.gwNative.shortcuts.cancelCapture();
    }
  }

  async function record(action: ShortcutAction): Promise<void> {
    const current = options.settings();
    if (!current) return;
    if (recording === action) {
      await window.gwNative.shortcuts.cancelCapture();
      return;
    }
    if (recording) await window.gwNative.shortcuts.cancelCapture();
    recording = action;
    pendingReplacement = null;
    clearMessages();
    await render(current);
    const row = parts(action);
    row.message.textContent =
      'Press Command with a letter or number · Delete clears · Escape cancels.';
    row.message.hidden = false;
    const result = await window.gwNative.shortcuts.capture();
    if (recording !== action) return;
    recording = null;
    const latest = options.settings();
    if (!latest) return;
    if (result.status === 'cancelled') {
      clearMessages();
      await render(latest);
      row.change.focus();
      return;
    }
    if (result.status === 'invalid') {
      row.message.textContent = 'Use Command with one letter or number.';
      row.message.hidden = false;
      await render(latest);
      row.change.focus();
      return;
    }
    if (result.status === 'cleared') {
      clearMessages();
      await save(withShortcutOverride(latest.shortcutOverrides, action, null));
      row.change.focus();
      return;
    }
    if (shortcutReserved(result.binding)) {
      row.message.textContent =
        `${shortcutDisplay(result.binding)} is reserved by macOS or GWonMac.`;
      row.message.hidden = false;
      await render(latest);
      row.change.focus();
      return;
    }
    const conflict = shortcutConflict(
      action,
      result.binding,
      resolveShortcuts(latest.shortcutOverrides),
    );
    if (conflict) {
      pendingReplacement = { action, conflict, binding: result.binding };
      row.message.textContent =
        `${shortcutDisplay(result.binding)} is used by ${SHORTCUT_LABELS[conflict]}.`;
      row.message.hidden = false;
      row.replace.hidden = false;
      await render(latest);
      row.replace.focus();
      return;
    }
    clearMessages();
    await save(withShortcutOverride(latest.shortcutOverrides, action, result.binding));
    row.change.focus();
  }

  for (const [action, row] of rows) {
    row.querySelector<HTMLButtonElement>('.settings-shortcut-change')
      ?.addEventListener('click', () => void record(action));
    row.querySelector<HTMLButtonElement>('.settings-shortcut-replace')
      ?.addEventListener('click', () => {
        const replacement = pendingReplacement;
        const settings = options.settings();
        if (!replacement || replacement.action !== action || !settings) return;
        let next = withShortcutOverride(
          settings.shortcutOverrides,
          replacement.conflict,
          null,
        );
        next = withShortcutOverride(next, action, replacement.binding);
        pendingReplacement = null;
        clearMessages();
        void save(next).then(() => parts(action).change.focus());
      });
  }

  options.restore.addEventListener('click', () => {
    void (async () => {
      if (recording) await window.gwNative.shortcuts.cancelCapture();
      recording = null;
      pendingReplacement = null;
      clearMessages();
      await save({});
    })();
  });
  options.dialog.addEventListener('close', () => {
    // AppKit can consume the matching key-up while Command is held. Always
    // clear capture-owned key claims when Settings closes, even after capture
    // already returned a binding, so the new shortcut works on its first use.
    void window.gwNative.shortcuts.cancelCapture();
    recording = null;
    pendingReplacement = null;
    clearMessages();
  });

  return Object.freeze({ render });
}
