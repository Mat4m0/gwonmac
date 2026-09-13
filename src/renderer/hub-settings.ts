/**
 * Owns the in-game settings presentation and local save feedback.
 * Persistence, validation and shortcut conflicts belong to the native preferences owner.
 */
import { hubIcon } from './hub-icons.js';
import { UI_FONTS, UI_PANEL_OPACITY_MIN } from '../shared/contracts.js';
import type { Hub } from './hub.js';
import type { HubSettingsChange, HubSettingsPatch, HubSettingsSnapshot } from '../shared/hub-settings.js';
import { GLOBAL_TOOLS } from '../shared/launcher-contracts.js';
import { TOOL_PRESENTATION } from '../shared/tool-presentation.js';
import { DEFAULT_SHORTCUTS, SHORTCUT_CAPTURE_HINT, shortcutKeycaps, SHORTCUT_ACTIONS, SHORTCUT_LABELS, shortcutConflict, type ShortcutAction, type ShortcutBinding } from '../shared/keyboard-shortcuts.js';

export function openHubSettings(hub: Hub) {
  let page = 'Tools';
  let scroll = 0;
  hub.showView('Settings', target => {
    const doc = target.ownerDocument;
    const view = doc.createElement('section'); view.className = 'hub-settings';
    const nav = doc.createElement('nav'); nav.setAttribute('aria-label', 'Settings sections');
    const body = doc.createElement('div'); body.className = 'hub-settings-body ui-scroll';
    const status = doc.createElement('p'); status.className = 'hub-settings-status'; status.setAttribute('role', 'status');
    view.append(nav, body, status); target.append(view);
    let snapshot: HubSettingsSnapshot | null = null; let disposed = false; let pending = false;
    const api = window.gwNative.hubSettings;
    const sections = ['Tools', 'Appearance', 'Shortcuts', 'Maps', 'Chat & characters'];
    const buttons = sections.map(name => {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = name; button.className = 'ui-button'; button.dataset.section = name;
      const icons: Record<string, string> = { Tools: 'settings', Appearance: 'appearance', Shortcuts: 'keyboard', Maps: 'maps', 'Chat & characters': 'whispers' };
      button.prepend(hubIcon(doc, { id: icons[name] ?? 'settings', group: 'Settings' }));
      button.onclick = () => { page = name; status.textContent = ''; render(); };
      button.onkeydown = event => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowRight'].includes(event.key)) return;
        if (event.key === 'ArrowUp' && name === sections[0]) return;
        event.preventDefault();
        if (event.key === 'ArrowRight') { body.querySelector<HTMLElement>('input,select,button')?.focus(); return; }
        const index = sections.indexOf(name); const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + sections.length) % sections.length]; next?.click(); next?.focus();
      };
      nav.append(button); return button;
    });
    function row(title: string, control: HTMLElement, detail = '') {
      const label = doc.createElement('label'); label.className = control.matches('input[type=checkbox]') ? 'hub-setting-row ui-check' : 'hub-setting-row';
      const copy = doc.createElement('span'); const name = doc.createElement('strong'); name.textContent = title; copy.append(name);
      if (detail) { const hint = doc.createElement('small'); hint.textContent = detail; copy.append(hint); }
      if (control.matches('input,select,button')) control.setAttribute('aria-label', title); label.append(copy, control); body.append(label);
    }
    async function save(change: HubSettingsChange, focus: string) {
      if (pending) return;
      pending = true; view.setAttribute('aria-busy', 'true'); body.inert = true; status.textContent = '';
      try { await api.update(change); const next = await api.get(); if (!disposed) { snapshot = next; render(); } }
      catch { if (!disposed) { status.textContent = 'Could not save this setting. Your previous value is kept. Try again.'; render(); } }
      finally { pending = false; body.inert = false; view.removeAttribute('aria-busy'); body.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focus)}"]`)?.focus(); }
    }
    function toggle(title: string, value: boolean, change: (value: boolean) => HubSettingsChange, detail = '', disabled = false) {
      const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = value; input.disabled = disabled;
      input.onchange = () => { void save(change(input.checked), title); }; row(title, input, detail);
    }
    function settingToggle(title: string, key: keyof HubSettingsPatch, detail = '') { toggle(title, snapshot?.settings[key] === true, value => ({ kind: 'settings', patch: { [key]: value } }), detail); }
    function select<Key extends keyof HubSettingsPatch>(title: string, key: Key, options: readonly { label: string; value: NonNullable<HubSettingsPatch[Key]> }[], detail = '') {
      const input = doc.createElement('select'); input.className = 'ui-select';
      for (const choice of options) { const option = doc.createElement('option'); option.textContent = choice.label; option.value = String(choice.value); input.append(option); }
      input.value = String(snapshot?.settings[key]); input.onchange = () => { const chosen = options.find(choice => String(choice.value) === input.value); if (chosen) void save({ kind: 'settings', patch: { [key]: chosen.value } }, title); }; row(title, input, detail);
    }
    function range(title: string, key: keyof HubSettingsPatch, min = 0) {
      const wrap = doc.createElement('span'); wrap.className = 'hub-setting-range'; const input = doc.createElement('input'); input.type = 'range'; input.className = 'ui-range'; input.min = String(min); input.max = '100'; input.value = String(snapshot?.settings[key] ?? 100); input.setAttribute('aria-label', title);
      const output = doc.createElement('output'); output.textContent = `${input.value}%`; input.oninput = () => { output.textContent = `${input.value}%`; }; input.onchange = () => { void save({ kind: 'settings', patch: { [key]: Number(input.value) } }, title); }; wrap.append(input, output); row(title, wrap);
    }
    function chooseShortcut(action: ShortcutAction, binding: ShortcutBinding | null) {
      const conflict = binding && snapshot ? shortcutConflict(action, binding, snapshot.shortcuts) : null;
      if (conflict) {
        status.replaceChildren(doc.createTextNode(`Used by ${SHORTCUT_LABELS[conflict]}. Replace that shortcut? `));
        const replace = doc.createElement('button'); replace.className = 'ui-button'; replace.textContent = 'Replace'; replace.onclick = () => { void save({ kind: 'shortcut', action, binding }, SHORTCUT_LABELS[action]); };
        const cancel = doc.createElement('button'); cancel.className = 'ui-button'; cancel.textContent = 'Cancel'; cancel.onclick = () => { status.textContent = ''; }; status.append(replace, cancel); cancel.focus();
      } else void save({ kind: 'shortcut', action, binding }, SHORTCUT_LABELS[action]);
    }
    function render() {
      if (disposed || !snapshot) return;
      body.replaceChildren(); buttons.forEach(button => button.setAttribute('aria-current', String(button.dataset.section === page)));
      const heading = doc.createElement('h2'); heading.textContent = page; body.append(heading);
      if (page === 'Tools') {
        toggle('Enable Tools', snapshot.tools.configured, enabled => ({ kind: 'master', enabled }), 'Optional features. Character Switch works independently.');
        if (snapshot.tools.restartRequired) { const note = doc.createElement('p'); note.className = 'hub-settings-note'; note.textContent = 'Saved. Close your game windows and restart gwonmac to finish loading or unloading Tools.'; body.append(note); }
        for (const tool of GLOBAL_TOOLS) { const info = TOOL_PRESENTATION[tool]; toggle(info.label, snapshot.tools.features[tool].enabled, enabled => ({ kind: 'tool', tool, enabled }), info.description, tool !== 'character-switch' && !snapshot.tools.configured); }
      } else if (page === 'Appearance') {
        const resetPosition = doc.createElement('button'); resetPosition.className = 'ui-button'; resetPosition.textContent = 'Reset';
        resetPosition.onclick = () => { hub.resetPosition(); status.textContent = 'Hub position and size reset. Window locked.'; };
        row('Reset Hub position', resetPosition, 'Restore the default position and size, and lock the Hub.');
        select('Panel style', 'uiStyle', [{ label: 'Guild Wars', value: 'guild-wars' }, { label: 'Modern', value: 'obsidian' }, { label: 'Your custom theme', value: 'custom' }]);
        range('Panel opacity', 'uiPanelOpacity', UI_PANEL_OPACITY_MIN);
        select('Panel font', 'uiFont', UI_FONTS.map(value => ({ label: value === 'guild-wars' ? 'Guild Wars' : value.charAt(0).toUpperCase() + value.slice(1), value })), 'Changes Hub and other in-game panels. Messages keep a readable text face.');
        settingToggle('Relog after reload', 'autoRelogAfterReload');
      } else if (page === 'Shortcuts') {
        const hint = doc.createElement('p'); hint.textContent = 'Changes apply to every account.'; body.append(hint);
        for (const action of SHORTCUT_ACTIONS) {
          const controls = doc.createElement('span'); controls.className = 'hub-setting-shortcut';
          const tool = action.startsWith('cartography.') ? 'maps' : GLOBAL_TOOLS.find(tool => TOOL_PRESENTATION[tool].action === action);
          const enabled = !tool || ((tool === 'character-switch' || snapshot.tools.configured) && snapshot.tools.features[tool].enabled);
          controls.classList.toggle('is-disabled', !enabled);
          const change = doc.createElement('button'); change.className = 'ui-button'; change.classList.add('hub-shortcut-record'); const caps = shortcutKeycaps(snapshot.shortcuts[action]);
          if (!caps.length) change.textContent = 'Not set';
          for (const cap of caps) { const key = doc.createElement('kbd'); key.textContent = cap.label; key.title = cap.name; change.append(key); }
          change.title = `Change ${SHORTCUT_LABELS[action]} shortcut: ${caps.map(cap => cap.name).join(' + ') || 'Not set'}`; change.setAttribute('aria-label', SHORTCUT_LABELS[action]);
          change.onclick = async () => {
            change.disabled = true; status.textContent = SHORTCUT_CAPTURE_HINT; change.dataset.capturing = 'true'; change.textContent = 'Press keys…';
            try { const result = await api.capture(action); if (disposed) return; status.textContent = '';
              if (result.status === 'captured' || result.status === 'conflict') chooseShortcut(action, result.binding);
              else if (result.status === 'cleared') chooseShortcut(action, null);
              else if (result.status === 'reserved' || result.status === 'invalid') status.textContent = 'That shortcut is unavailable. Choose another combination.';
            } catch { if (!disposed) status.textContent = 'Could not capture the shortcut. Try again.'; } finally { if (!disposed) render(); }
          };
          const clear = doc.createElement('button'); clear.className = 'ui-button'; clear.textContent = 'Clear'; clear.setAttribute('aria-label', `Clear ${SHORTCUT_LABELS[action]}`); clear.disabled = !snapshot.shortcuts[action]; clear.onclick = () => chooseShortcut(action, null);
          const reset = doc.createElement('button'); reset.className = 'ui-button'; reset.textContent = 'Reset'; reset.setAttribute('aria-label', `Reset ${SHORTCUT_LABELS[action]}`); reset.onclick = () => chooseShortcut(action, DEFAULT_SHORTCUTS[action]);
          if (!enabled) { change.disabled = true; clear.disabled = true; reset.disabled = true; }
          controls.append(change, clear, reset); row(SHORTCUT_LABELS[action], controls, enabled ? '' : 'Enable this tool to change its shortcut.');
        }
      } else if (page === 'Maps') {
        settingToggle('Exploration grid', 'cartographyGridEnabled'); settingToggle('Walkable terrain', 'cartographyOverlayEnabled'); range('Grid opacity', 'cartographyGridOpacity'); range('Terrain opacity', 'cartographyWalkabilityOpacity');
        settingToggle('Compass ranges', 'compassRangeIndicatorsEnabled'); settingToggle('Earshot range', 'compassRangeEarshotEnabled'); settingToggle('Casting range', 'compassRangeCastEnabled'); settingToggle('Spirit range', 'compassRangeSpiritEnabled'); settingToggle('Extended spirit range', 'compassRangeSpiritExtendedEnabled');
      } else {
        settingToggle('Show character profession', 'characterSwitchProfession'); settingToggle('Show character level', 'characterSwitchLevel'); settingToggle('Show character location', 'characterSwitchLocation');
        settingToggle('Hide other players’ item drops', 'chatFilterAllyDrops'); settingToggle('Hide Hall of Heroes announcements', 'chatFilterHallOfHeroes'); settingToggle('Hide title announcements', 'chatFilterTitleAchievements');
        const note = doc.createElement('p'); note.textContent = 'Whisper sound and pop-out opacity are in Chat options. Drafts stay in this game session.'; body.append(note);
      }
    }
    status.textContent = 'Loading settings…'; buttons[0]?.focus();
    void api.get().then(next => { if (!disposed) { snapshot = next; status.textContent = ''; render(); body.scrollTop = scroll; } }).catch(() => { if (!disposed) { status.textContent = 'Settings could not load. Go back and try again.'; } });
    return () => { scroll = body.scrollTop; disposed = true; view.remove(); };
  }, () => true);
}
