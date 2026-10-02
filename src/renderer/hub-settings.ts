/**
 * Owns the in-game settings presentation and local save feedback.
 * Persistence, validation and shortcut conflicts belong to the native preferences owner.
 */
import { hubIcon } from './hub-icons.js';
import { UI_FONTS, UI_PANEL_OPACITY_MIN, UI_TEXT_SIZE_MIN, UI_TEXT_SIZE_MAX } from '../shared/contracts.js';
import type { Hub } from './hub.js';
import type { HubSettingsChange, HubSettingsPatch, HubSettingsSnapshot } from '../shared/hub-settings.js';
import { GLOBAL_TOOLS } from '../shared/launcher-contracts.js';
import { TOOL_PRESENTATION } from '../shared/tool-presentation.js';
import { listIndexAfter, listKeyStep } from '../shared/ui/list-keys.js';
import { createTrailingSave } from './trailing-save.js';
import { extendedMemoryView } from './extended-memory-setting.js';
import { CHARACTER_DETAILS, CHAT_FILTERS, CONTROLLER_SYMBOL_OPTIONS, GAME_SETTINGS, RENDER_SCALE_OPTIONS, settingDetail } from '../shared/setting-copy.js';
import type { AppSettings, ExtendedMemoryRuntimeStatus } from '../shared/contracts.js';
import type { LauncherSettingsSection } from '../shared/launcher-contracts.js';
import { DEFAULT_SHORTCUTS, HUB_BACK_SHORTCUT, isHubBackKey, SHORTCUT_CAPTURE_HINT, shortcutEquals, shortcutKeycaps, shortcutReserved, SHORTCUT_ACTIONS, SHORTCUT_LABELS, shortcutConflict, type ShortcutAction, type ShortcutBinding } from '../shared/keyboard-shortcuts.js';

/** Hub Settings sections, in the order of the launcher's game settings (docs/settings.md). */
export const HUB_SETTINGS_SECTIONS = ['Game', 'Appearance', 'Tools', 'Shortcuts', 'Maps'] as const;
export type HubSettingsSection = typeof HUB_SETTINGS_SECTIONS[number];
/**
 * The section Settings opened on last in this game session. It starts on Tools, the most
 * frequent in-game change; Game settings are rarer and found by search.
 */
let lastSection: HubSettingsSection = 'Tools';

export type HubSettingsFocus = Readonly<{ section: HubSettingsSection; control?: string }>;
/** The open Settings page's way to show a section and focus a control; null while none is mounted. */
let showTarget: ((focus: HubSettingsFocus) => void) | null = null;
/** Shows a section and control on a Settings page that is already open, resumed or restored. */
export function focusHubSetting(focus: HubSettingsFocus) { showTarget?.(focus); }

/**
 * Settings that Hub search finds by their own words; ↵ opens the section with the control
 * focused (HUB-063). A setting whose control shows only with its tool on is offered only then.
 */
export const FINDABLE_SETTINGS: readonly Readonly<{ label: string; section: HubSettingsSection; keywords?: string; shown?: (settings: Pick<AppSettings, 'gwonmacTools' | 'chatFiltersEnabled'>) => boolean }>[] = [
  ...Object.values(GAME_SETTINGS).map(copy => ({ label: copy.label, section: 'Game' as const, keywords: copy.keywords })),
  { label: 'Panel style', section: 'Appearance', keywords: 'theme modern classic look' },
  { label: 'Panel opacity', section: 'Appearance', keywords: 'transparency' },
  { label: 'Text size', section: 'Appearance', keywords: 'scale zoom enlarge' },
  { label: 'Panel font', section: 'Appearance', keywords: 'text typeface' },
  { label: 'Enable Tools', section: 'Tools', keywords: 'features' },
  ...CHAT_FILTERS.map(filter => ({ label: filter.label, section: 'Tools' as const, keywords: 'chat filter spam', shown: (settings: Pick<AppSettings, 'gwonmacTools' | 'chatFiltersEnabled'>) => settings.gwonmacTools && settings.chatFiltersEnabled })),
];

export function openHubSettings(hub: Hub, focus?: HubSettingsFocus) {
  let page: HubSettingsSection = focus?.section ?? lastSection;
  let scroll = 0;
  hub.showView('Settings', (target, _back, footer) => {
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-settings';
    const nav = doc.createElement('nav'); nav.setAttribute('aria-label', 'Settings sections');
    const body = doc.createElement('div'); body.className = 'hub-settings-body ui-scroll';
    const status = doc.createElement('p'); status.className = 'hub-settings-status'; status.setAttribute('role', 'status');
    view.append(nav, body, status); target.append(view);
    // ← from a section's control returns to its section; a slider, a list box and text keep their own ←.
    body.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(event.target instanceof HTMLElement)
        || event.target.matches('select,textarea,input:not([type=checkbox]):not([type=radio])')) return;
      event.preventDefault(); nav.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    });
    let snapshot: HubSettingsSnapshot | null = null; let disposed = false; let capturing = false;
    const api = window.gwNative.hubSettings;
    const sections = HUB_SETTINGS_SECTIONS;
    const buttons = sections.map(name => {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = name; button.className = 'ui-button'; button.dataset.variant = 'quiet'; button.dataset.section = name;
      const icons: Record<HubSettingsSection, string> = { Game: 'game', Tools: 'settings', Appearance: 'appearance', Shortcuts: 'keyboard', Maps: 'maps' };
      button.prepend(hubIcon(doc, { id: icons[name], group: 'Settings' }));
      button.onclick = () => { page = name; lastSection = name; if (snapshot) status.textContent = ''; render(); };
      // The sections are a list: the shared list keys choose one, without wrapping; → enters its first usable control.
      button.onkeydown = event => {
        if (event.key === 'ArrowRight' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          event.preventDefault(); body.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled)')?.focus(); return;
        }
        const step = listKeyStep(event, sections.length);
        if (step === null) return;
        event.preventDefault();
        const next = buttons[listIndexAfter(sections.indexOf(name), sections.length, step)];
        if (next && next !== button) { next.click(); next.focus(); }
      };
      nav.append(button); return button;
    });
    /** A setting's row; `state` says what the running game uses when that differs from the saved choice. */
    function row(title: string, control: HTMLElement, detail = '', state?: Readonly<{ text: string; level: string }>) {
      const label = doc.createElement(control.matches('input,select,button') ? 'label' : 'div');
      label.className = control.matches('input[type=checkbox]') ? 'hub-setting-row ui-check' : 'hub-setting-row';
      const copy = doc.createElement('span'); const name = doc.createElement('strong'); name.textContent = title;
      name.id = `hub-setting-name-${body.childElementCount}`; copy.append(name);
      const descriptions: string[] = [];
      if (detail) { const hint = doc.createElement('small'); hint.textContent = detail; hint.id = `${name.id}-detail`; descriptions.push(hint.id); copy.append(hint); }
      if (state) { const note = doc.createElement('small'); note.className = 'hub-setting-state'; note.dataset.level = state.level; note.textContent = state.text; note.id = `${name.id}-state`; descriptions.push(note.id); copy.append(note); }
      const fields = control.matches('input,select,button') ? [control] : [...control.querySelectorAll<HTMLElement>('input,select,button')];
      for (const field of fields) {
        if (fields.length === 1) { field.removeAttribute('aria-label'); field.setAttribute('aria-labelledby', name.id); field.dataset.settingLabel = title; }
        if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
      }
      label.append(copy, control); body.append(label);
    }
    /** The control that keeps the keyboard after the saves settle, by its label. */
    let refocus = '';
    const focusControl = (label: string) => body.querySelector<HTMLElement>(`[data-setting-label="${CSS.escape(label)}"],[aria-label="${CSS.escape(label)}"]`)?.focus({ preventScroll: true });
    // The controls stay live while saves run; the section repaints once they settled, and the
    // focused control, or the one the last save named, keeps the keyboard.
    const saver = createTrailingSave<HubSettingsChange>({
      write: change => api.update(change),
      merge: (waiting, next) => waiting.kind === 'settings' && next.kind === 'settings' ? { kind: 'settings', patch: { ...waiting.patch, ...next.patch } } : null,
      settled: failed => {
        void api.get().then(next => { snapshot = next; }, () => { /* The last stored snapshot stays. */ }).then(() => {
          if (disposed || saver.pending) return;
          view.removeAttribute('aria-busy');
          const active = doc.activeElement;
          const label = active instanceof HTMLElement && body.contains(active) ? active.dataset.settingLabel ?? active.getAttribute('aria-label') ?? refocus : refocus;
          const prompt = status.contains(active);
          render();
          if (failed) status.textContent = 'Could not save this setting. Your previous value is kept. Try again.';
          if (!prompt) focusControl(label);
        });
      },
    });
    function save(change: HubSettingsChange, focus: string) {
      refocus = focus; view.setAttribute('aria-busy', 'true'); status.textContent = '';
      saver.save(change);
    }
    /** Repaints the section from the stored values; the focused control keeps the keyboard. */
    function repaint() {
      const active = doc.activeElement;
      const label = active instanceof HTMLElement && body.contains(active) ? active.dataset.settingLabel ?? active.getAttribute('aria-label') : null;
      render();
      if (label) focusControl(label);
    }
    function toggle(title: string, value: boolean, change: (value: boolean) => HubSettingsChange, detail = '', disabled = false, state?: Parameters<typeof row>[3]) {
      const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = value; input.disabled = disabled;
      input.onchange = () => { save(change(input.checked), title); }; row(title, input, detail, state);
    }
    function settingToggle(title: string, key: keyof HubSettingsPatch, detail = '', disabled = false) { toggle(title, snapshot?.settings[key] === true, value => ({ kind: 'settings', patch: { [key]: value } }), detail, disabled); }
    /** A row that opens the launcher at the section holding what this section does not show. */
    function launcherLink(title: string, detail: string, section: LauncherSettingsSection) {
      const open = doc.createElement('button'); open.type = 'button'; open.className = 'ui-button'; open.textContent = 'Open in launcher';
      open.onclick = () => { void window.gwNative.app.openSettings(section).catch(() => { status.textContent = 'The launcher could not open. Use Window › Show Launcher.'; }); };
      row(title, open, detail);
    }
    function select<Key extends keyof HubSettingsPatch>(title: string, key: Key, options: readonly { label: string; value: NonNullable<HubSettingsPatch[Key]> }[], detail = '') {
      const input = doc.createElement('select'); input.className = 'ui-select';
      for (const choice of options) { const option = doc.createElement('option'); option.textContent = choice.label; option.value = String(choice.value); input.append(option); }
      input.value = String(snapshot?.settings[key]); input.onchange = () => { const chosen = options.find(choice => String(choice.value) === input.value); if (chosen) save({ kind: 'settings', patch: { [key]: chosen.value } }, title); }; row(title, input, detail);
    }
    function range(title: string, key: keyof HubSettingsPatch, min = 0, disabled = false, max = 100) {
      const wrap = doc.createElement('span'); wrap.className = 'hub-setting-range'; const input = doc.createElement('input'); input.type = 'range'; input.disabled = disabled; input.className = 'ui-range'; input.min = String(min); input.max = String(max); input.value = String(snapshot?.settings[key] ?? 100); input.setAttribute('aria-label', title);
      const output = doc.createElement('span'); const paintValue = () => { output.textContent = `${input.value}%`; input.setAttribute('aria-valuetext', output.textContent); }; paintValue(); input.oninput = paintValue; input.onchange = () => { save({ kind: 'settings', patch: { [key]: Number(input.value) } }, title); }; wrap.append(input, output); row(title, wrap);
    }
    function chooseShortcut(action: ShortcutAction, binding: ShortcutBinding | null) {
      const conflict = binding && snapshot ? shortcutConflict(action, binding, snapshot.shortcuts) : null;
      if (conflict) {
        status.replaceChildren(doc.createTextNode(`Used by ${SHORTCUT_LABELS[conflict]}. Replace that shortcut? `));
        // Esc and ⌘⌫ answer the prompt like Cancel, and the keyboard returns to the shortcut it was about (HUB-053).
        const dismissPrompt = () => { status.textContent = ''; body.querySelector<HTMLElement>(`[aria-label="${CSS.escape(SHORTCUT_LABELS[action])}"]`)?.focus(); };
        const replace = doc.createElement('button'); replace.className = 'ui-button'; replace.textContent = 'Replace'; replace.onclick = () => { dismissPrompt(); save({ kind: 'shortcut', action, binding }, SHORTCUT_LABELS[action]); };
        const cancel = doc.createElement('button'); cancel.className = 'ui-button'; cancel.textContent = 'Cancel'; cancel.onclick = dismissPrompt;
        status.onkeydown = event => {
          if ((event.key !== 'Escape' && !isHubBackKey(event)) || event.isComposing || !status.contains(cancel)) return;
          event.preventDefault(); if (!event.repeat) dismissPrompt();
        };
        status.append(replace, cancel); cancel.focus();
      } else save({ kind: 'shortcut', action, binding }, SHORTCUT_LABELS[action]);
    }
    function render() {
      if (disposed) return;
      buttons.forEach(button => button.setAttribute('aria-current', String(button.dataset.section === page)));
      if (!snapshot) return;
      body.replaceChildren();
      const heading = doc.createElement('h2'); heading.textContent = page; body.append(heading);
      if (page === 'Game') {
        const game = GAME_SETTINGS;
        select(game.renderScale.label, 'renderScale', RENDER_SCALE_OPTIONS, settingDetail(game.renderScale));
        // The saved choice applies at the next start; the row also says what this session uses.
        const memory = extendedMemoryView(snapshot.settings.extendedMemoryEnabled === true, memoryRuntime);
        toggle(game.extendedMemoryEnabled.label, snapshot.settings.extendedMemoryEnabled === true, value => ({ kind: 'settings', patch: { extendedMemoryEnabled: value } }), settingDetail(game.extendedMemoryEnabled), false,
          memoryRuntime ? { text: memory.level === 'warn' ? `${memory.label}. ${memory.detail}` : `${memory.label} now.`, level: memory.level } : undefined);
        select(game.controllerPromptStyle.label, 'controllerPromptStyle', CONTROLLER_SYMBOL_OPTIONS, settingDetail(game.controllerPromptStyle));
        settingToggle(game.autoRelogAfterReload.label, 'autoRelogAfterReload', settingDetail(game.autoRelogAfterReload));
        settingToggle(game.showDiagnostics.label, 'showDiagnostics', settingDetail(game.showDiagnostics));
        launcherLink('Updates, game files and texture packs', 'The launcher keeps what concerns the app, your accounts and your files.', 'general');
      } else if (page === 'Tools') {
        toggle('Enable Tools', snapshot.tools.configured, enabled => ({ kind: 'master', enabled }), 'Optional features. Character Switch works independently.');
        if (snapshot.tools.restartRequired) { const note = doc.createElement('p'); note.className = 'hub-settings-note'; note.textContent = 'Saved. Close your game windows and restart gwonmac to finish loading or unloading Tools.'; body.append(note); }
        for (const tool of GLOBAL_TOOLS) {
          const info = TOOL_PRESENTATION[tool]; const on = (tool === 'character-switch' || snapshot.tools.configured) && snapshot.tools.features[tool].enabled;
          toggle(info.label, snapshot.tools.features[tool].enabled, enabled => ({ kind: 'tool', tool, enabled }), info.description, tool !== 'character-switch' && !snapshot.tools.configured);
          // A tool's own options follow it while it is on, as in the launcher.
          const options = on && tool === 'character-switch' ? CHARACTER_DETAILS : on && tool === 'chat-filters' ? CHAT_FILTERS : [];
          for (const option of options) { settingToggle(option.label, option.key); body.lastElementChild?.classList.add('hub-setting-option'); }
        }
        const note = doc.createElement('p'); note.textContent = 'Whisper sound and pop-out opacity are in Whispers › Chat options.'; body.append(note);
        launcherLink('Skill key labels and timer color', 'What each skill key shows, the cooldown timer color and the Alcohol Timer position.', 'tools');
      } else if (page === 'Appearance') {
        const resetPosition = doc.createElement('button'); resetPosition.className = 'ui-button'; resetPosition.textContent = 'Reset';
        resetPosition.onclick = () => { hub.resetPosition(); status.textContent = 'Hub position and size reset. Window locked.'; };
        row('Reset Hub position', resetPosition, 'Restore the default position and size, and lock the Hub.');
        select('Panel style', 'uiStyle', [{ label: 'Guild Wars', value: 'guild-wars' }, { label: 'Modern', value: 'obsidian' }, { label: 'Your custom theme', value: 'custom' }]);
        range('Text size', 'uiTextSize', UI_TEXT_SIZE_MIN, false, UI_TEXT_SIZE_MAX);
        range('Panel opacity', 'uiPanelOpacity', UI_PANEL_OPACITY_MIN);
        select('Panel font', 'uiFont', UI_FONTS.map(value => ({ label: value === 'guild-wars' ? 'Guild Wars' : value.charAt(0).toUpperCase() + value.slice(1), value })), 'Changes Hub and other in-game panels. Messages keep a readable text face.');
        launcherLink('Custom colors', 'Edit the colors of Your custom theme.', 'game');
      } else if (page === 'Shortcuts') {
        const hint = doc.createElement('p'); hint.textContent = 'Changes apply to every account.'; body.append(hint);
        for (const action of SHORTCUT_ACTIONS) {
          const controls = doc.createElement('span'); controls.className = 'hub-setting-shortcut';
          const tool = action.startsWith('cartography.') ? 'maps' : GLOBAL_TOOLS.find(tool => TOOL_PRESENTATION[tool].action === action);
          const enabled = !tool || ((tool === 'character-switch' || snapshot.tools.configured) && snapshot.tools.features[tool].enabled);
          controls.classList.toggle('is-disabled', !enabled);
          const change = doc.createElement('button'); change.className = 'ui-button'; change.classList.add('hub-shortcut-record'); const caps = shortcutKeycaps(snapshot.shortcuts[action]);
          if (!caps.length) change.textContent = 'Not set';
          for (const cap of caps) { const key = doc.createElement('kbd'); key.className = 'ui-kbd'; key.textContent = cap.label; key.title = cap.name; change.append(key); }
          change.title = `Change ${SHORTCUT_LABELS[action]} shortcut: ${caps.map(cap => cap.name).join(' + ') || 'Not set'}`; change.setAttribute('aria-label', SHORTCUT_LABELS[action]);
          // The record button keeps the keyboard while it listens (main owns the keys then), and
          // every outcome returns focus to it, so a second Enter records again (HUB-023).
          change.onclick = async () => {
            if (change.dataset.capturing) return;
            status.textContent = SHORTCUT_CAPTURE_HINT; change.dataset.capturing = 'true'; change.setAttribute('aria-busy', 'true'); change.textContent = 'Press keys…';
            capturing = true;
            try { const result = await api.capture(action).finally(() => { capturing = false; }); if (disposed) return; status.textContent = '';
              if ((result.status === 'captured' || result.status === 'conflict') && shortcutReserved(result.binding)) status.textContent = shortcutEquals(result.binding, HUB_BACK_SHORTCUT) ? 'Reserved for Back' : 'Reserved by gwonmac or macOS. Choose another combination.';
              else if (result.status === 'captured' || result.status === 'conflict') chooseShortcut(action, result.binding);
              else if (result.status === 'cleared') chooseShortcut(action, null);
              else if (result.status === 'reserved') status.textContent = 'Reserved by gwonmac or macOS. Choose another combination.';
              else if (result.status === 'invalid') status.textContent = `That combination is not a shortcut. ${SHORTCUT_CAPTURE_HINT}`;
            } catch { if (!disposed) status.textContent = 'Could not capture the shortcut. Try again.'; }
            finally { if (!disposed) { render(); if (!status.contains(doc.activeElement)) focusControl(SHORTCUT_LABELS[action]); } }
          };
          const clear = doc.createElement('button'); clear.className = 'ui-button'; clear.textContent = 'Clear'; clear.setAttribute('aria-label', `Clear ${SHORTCUT_LABELS[action]}`); clear.disabled = !snapshot.shortcuts[action]; clear.onclick = () => chooseShortcut(action, null);
          const reset = doc.createElement('button'); reset.className = 'ui-button'; reset.textContent = 'Reset'; reset.setAttribute('aria-label', `Reset ${SHORTCUT_LABELS[action]}`); reset.disabled = shortcutEquals(snapshot.shortcuts[action], DEFAULT_SHORTCUTS[action]); reset.onclick = () => chooseShortcut(action, DEFAULT_SHORTCUTS[action]);
          if (!enabled) { change.disabled = true; clear.disabled = true; reset.disabled = true; }
          controls.append(change, clear, reset); row(SHORTCUT_LABELS[action], controls, enabled ? '' : 'Enable this tool to change its shortcut.');
        }
      } else if (page === 'Maps') {
        const unavailable = !snapshot.tools.configured || !snapshot.tools.features.maps.enabled;
        settingToggle('Exploration grid', 'cartographyGridEnabled', '', unavailable);
        range('Grid opacity', 'cartographyGridOpacity', 0, unavailable || !snapshot.settings.cartographyGridEnabled);
        settingToggle('Walkable terrain', 'cartographyOverlayEnabled', '', unavailable);
        range('Terrain opacity', 'cartographyWalkabilityOpacity', 0, unavailable || !snapshot.settings.cartographyOverlayEnabled);
        settingToggle('Compass ranges', 'compassRangeIndicatorsEnabled', '', unavailable);
        for (const [label, key] of [['Earshot range', 'compassRangeEarshotEnabled'], ['Casting range', 'compassRangeCastEnabled'], ['Spirit range', 'compassRangeSpiritEnabled'], ['Extended spirit range', 'compassRangeSpiritExtendedEnabled']] as const) settingToggle(label, key, '', unavailable || !snapshot.settings.compassRangeIndicatorsEnabled);
        settingToggle('Elite skills', 'eliteSkillsEnabled', '', unavailable);
        launcherLink('Map styles and range colors', 'Styles, colors, range opacity and the elite skill planner.', 'maps');
      }
    }
    /** What this session's memory module is, from the launch result; null until it is read. */
    let memoryRuntime: ExtendedMemoryRuntimeStatus | null = null;
    void window.gwNative.client.session().then(session => { memoryRuntime = session.extendedMemory; if (!saver.pending) repaint(); }, () => { /* The row shows the saved choice only. */ });
    // A change from the launcher or another game window repaints the open section (docs/settings.md).
    const unsubscribe = window.gwNative.settings.onChange(() => {
      if (saver.pending) return;
      void api.get().then(next => { if (!disposed && !saver.pending) { snapshot = next; repaint(); } }, () => { /* The shown values stay. */ });
    });
    /** Opened for one setting (from search or the memory warning): that control takes the keyboard. */
    const applyFocus = () => {
      const control = focus?.control; focus = undefined;
      if (!control) return;
      body.querySelector<HTMLElement>(`[data-setting-label="${CSS.escape(control)}"],[aria-label="${CSS.escape(control)}"]`)?.scrollIntoView({ block: 'center' });
      focusControl(control);
    };
    const show = (next: HubSettingsFocus) => {
      focus = next; page = next.section; lastSection = page; if (snapshot) status.textContent = '';
      if (snapshot) { render(); applyFocus(); }
    };
    showTarget = show;
    const load = async () => {
      status.textContent = 'Loading settings…';
      footer.primary({ label: 'Loading settings…', disabled: true, run() {} });
      try {
        const next = await api.get();
        if (disposed) return;
        snapshot = next; status.textContent = ''; render(); body.scrollTop = scroll; applyFocus();
        footer.primary(null);
        // Retry removes its footer action. Return focus to the selected section.
        if (doc.activeElement?.classList.contains('hub-primary')) buttons[sections.indexOf(page)]?.focus();
      } catch {
        if (disposed) return;
        status.textContent = 'Settings could not load. Try again.';
        footer.primary({ label: 'Retry settings', run: load });
      }
    };
    buttons[sections.indexOf(page)]?.focus();
    void load();
    return () => {
      scroll = body.scrollTop; disposed = true; unsubscribe(); if (showTarget === show) showTarget = null; view.remove();
      // Leaving with the mouse mid-capture must not leave main listening for the next game key (HUB-038).
      if (capturing) void api.cancelCapture().catch(() => { /* The capture still ends at blur or its timeout. */ });
    };
  }, () => true, 'settings');
}
