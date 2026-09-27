/**
 * Stands in for the main process in the Hub fixture. Physical shortcuts are
 * claimed the way `window-shortcuts.ts` claims them (repeats and key-ups
 * included) and reach the page only as renderer commands through the
 * production subscriber `commands.ts`. Command-Q and the Hub's Quit or Reload
 * row open a model of the native Quit-or-Reload sheet. Import this module before `commands.ts`: it installs
 * the command transport that `commands.ts` registers with when it loads.
 */
import type { AppSettings, RendererCommand } from '../../../src/shared/contracts';
import { featureActivationRequested, type FeatureId } from '../../../src/shared/feature-contracts';
import { HUB_SHORTCUT, hubShortcutAvailable, resolveShortcuts, shortcutMatches, type ShortcutAction } from '../../../src/shared/keyboard-shortcuts';

type CommandHandler = (command: RendererCommand) => void | 'unhandled' | Promise<void | 'unhandled'>;
let handler: CommandHandler | null = null;
const transport = { handle(next: CommandHandler) {
  if (handler) throw new Error('renderer command handler is already registered');
  handler = next;
} };
Object.assign(window, { gwNative: { ...window.gwNative, commands: transport } });

/** The renderer's truthful acknowledgement, as `sendRendererCommand` receives it. */
export async function sendFixtureCommand(command: RendererCommand): Promise<'completed' | 'unhandled' | 'failed'> {
  if (!handler) return 'failed';
  try { return await handler(command) === 'unhandled' ? 'unhandled' : 'completed'; }
  catch (error) { console.warn(`Fixture command ${command.type} failed`, error); return 'failed'; }
}

/** Each shortcut action, the feature that enables it, and the commands main sends (window.ts `run`). */
const ACTIONS: Readonly<Record<Exclude<ShortcutAction, `cartography.${string}`>, readonly [FeatureId, readonly RendererCommand[]]>> = {
  'game.call-target': ['callTarget', [{ type: 'game.call-target' }]],
  'game.resign': ['resign', [{ type: 'input.reset' }, { type: 'game.resign' }]],
  'character.switch': ['characterSwitch', [{ type: 'input.reset' }, { type: 'character.toggle' }]],
  'tools.toggle': ['buildLibrary', [{ type: 'tools.toggle' }]],
  'whispers.toggle': ['whispers', [{ type: 'whispers.toggle' }]],
  'trade.toggle': ['tradeChat', [{ type: 'trade.toggle' }]],
  'storage.open': ['xunlaiStorage', [{ type: 'input.reset' }, { type: 'storage.open' }]],
  'travel.open': ['travel', [{ type: 'input.reset' }, { type: 'travel.toggle' }]],
};
const MAP_LAYERS = { 'cartography.grid.toggle': 'cartographyGridEnabled', 'cartography.walkability.toggle': 'cartographyOverlayEnabled' } as const;

export interface FixtureMainOptions {
  settings(): AppSettings;
  /** The fixture's shortcut recorder owns every key while it listens, as main's capture does. */
  capturing(): boolean;
  updateSettings(patch: Partial<AppSettings>): void;
  record(action: string): void;
}

export function installFixtureMain(options: FixtureMainOptions) {
  const claimed = new Set<string>();
  const run = async (commands: readonly RendererCommand[]) => { for (const command of commands) await sendFixtureCommand(command); };
  const sheet = createQuitOrReloadSheet(options.record, () => run([{ type: 'input.reset' }]));
  const claim = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); claimed.add(event.code); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.capturing() || sheet.open) return;
    // A claimed press owns its repeats until its key-up, like `#claimedCodes`;
    // a fresh press of the same key is decided again, as main does when Chromium drops the key-up.
    if (claimed.has(event.code) && event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    claimed.delete(event.code);
    const input = { code: event.code, meta: event.metaKey, control: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    const settings = options.settings();
    if (input.meta && !input.control && !input.shift && !input.alt && input.code === 'KeyQ') {
      claim(event); if (!event.repeat) void sheet.show(); return;
    }
    if (hubShortcutAvailable(settings.shortcutOverrides) && shortcutMatches(HUB_SHORTCUT, input)) {
      claim(event); if (!event.repeat) void run([{ type: 'hub.toggle' }]); return;
    }
    const shortcuts = resolveShortcuts(settings.shortcutOverrides);
    for (const [action, binding] of Object.entries(shortcuts) as [ShortcutAction, typeof shortcuts[ShortcutAction]][]) {
      if (!binding || !shortcutMatches(binding, input)) continue;
      if (action in MAP_LAYERS) {
        if (!featureActivationRequested('cartography', settings)) continue;
        claim(event);
        const key = MAP_LAYERS[action as keyof typeof MAP_LAYERS];
        if (!event.repeat) options.updateSettings({ [key]: !settings[key] });
        return;
      }
      const [feature, commands] = ACTIONS[action as keyof typeof ACTIONS];
      if (!featureActivationRequested(feature, settings)) continue;
      claim(event); if (!event.repeat) void run(commands); return;
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!claimed.delete(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  // Main sees input before any page listener, so these must be the first window listeners.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => claimed.clear());
  /** `app.showQuitOrReload`: the Hub row opens the same sheet as Command-Q. */
  return { showQuitOrReload: () => sheet.show() };
}

/**
 * A model of `showQuitOrReloadGame`: the same message, buttons, default and
 * cancel choice. Reload and Cancel are recorded; Quit ends this account's game.
 */
function createQuitOrReloadSheet(record: (action: string) => void, resetInput: () => Promise<void>) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ui-frame hub-fixture-sheet';
  dialog.setAttribute('aria-labelledby', 'hub-fixture-sheet-title');
  dialog.style.cssText = 'max-width:420px;padding:20px;border:0';
  dialog.innerHTML = '<form method="dialog"><h2 id="hub-fixture-sheet-title" style="margin:0 0 8px;font-size:15px">Quit or reload Guild Wars?</h2>'
    + '<p style="margin:0 0 12px">Reload restarts this account with fresh memory. Other accounts stay open.</p>'
    + '<label style="display:flex;gap:8px;margin-bottom:16px"><input type="checkbox" name="relog">Return to my character automatically</label>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="ui-button" value="cancel">Cancel</button>'
    + '<button class="ui-button" value="quit">Quit Game</button><button class="ui-button" data-variant="primary" value="reload">Reload Guild Wars</button></div></form>';
  document.body.append(dialog);
  let settle: (() => void) | null = null;
  dialog.addEventListener('close', () => {
    const choice = dialog.returnValue === 'reload' || dialog.returnValue === 'quit' ? dialog.returnValue : 'cancel';
    if (choice === 'quit') quitFixtureGame(record);
    else record(choice === 'reload' ? 'Game reload' : 'Quit or reload cancelled');
    settle?.(); settle = null;
  });
  return {
    get open() { return dialog.open; },
    /** Resolves when the sheet settles; a second request joins the open sheet (`runExclusiveReloadDialog`). */
    async show() {
      // Every request is counted, joined or not, so a test can require exactly one.
      dialog.dataset.requests = String(Number(dialog.dataset.requests ?? 0) + 1);
      if (dialog.open) return;
      await resetInput();
      dialog.returnValue = '';
      const settled = new Promise<void>(resolve => { settle = resolve; });
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('button[value="reload"]')?.focus();
      await settled;
    },
  };
}

/** Production closes this account's game window; the fixture covers the page instead of pretending nothing happened. */
export function quitFixtureGame(record: (action: string) => void) {
  record('Game quit');
  window.gwHub?.close();
  if (document.querySelector('.hub-fixture-quit')) return;
  const cover = document.createElement('div');
  cover.className = 'hub-fixture-quit';
  cover.setAttribute('role', 'status');
  cover.style.cssText = 'position:fixed;inset:0;z-index:5;display:grid;place-items:center;background:#000d;color:#fff;font:14px system-ui';
  cover.textContent = 'This account’s game window closed. Reset fixture to start again.';
  document.body.append(cover);
}
