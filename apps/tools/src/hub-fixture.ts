import { GLOBAL_TOOLS, GLOBAL_TOOL_FEATURES, type GlobalToolSettings } from '../../../src/shared/launcher-contracts';
import { FEATURE_SELECTION_POLICIES } from '../../../src/shared/feature-contracts';
import { parseHubSettingsChange, type HubSettingsApi } from '../../../src/shared/hub-settings';
import { resolveShortcuts, shortcutConflict, shortcutFromInput, shortcutReserved, withShortcutOverride } from '../../../src/shared/keyboard-shortcuts';
/** Disposable Hub workbench: synthetic state, no native IPC or game commands. */
// Offline fixture exercises the production Hub mounting owner.
// eslint-disable-next-line no-restricted-imports
import { toggleHubWhispers } from '../../../src/renderer/hub-whisper';
// eslint-disable-next-line no-restricted-imports
import type {} from '../../../src/renderer/gw-native';
// eslint-disable-next-line no-restricted-imports
import { createHub } from '../../../src/renderer/hub';
// eslint-disable-next-line no-restricted-imports
import { installSurfaceController } from '../../../src/renderer/surface-controller';
// eslint-disable-next-line no-restricted-imports
import '../../../src/renderer/hub.css';
// eslint-disable-next-line no-restricted-imports
import { createHubPeople } from '../../../src/renderer/hub-people';
// eslint-disable-next-line no-restricted-imports
import { createPartyInvite } from '../../../src/renderer/party-invite';
// eslint-disable-next-line no-restricted-imports
import type { CompanionPlayRegionState } from '../../../src/renderer/companion-play-region-snapshot';
import { isPvpTravelDestination } from '../../../src/shared/travel';
import { watch } from 'vue';
// eslint-disable-next-line no-restricted-imports
import { installCharacterSwitchHost } from '../../../src/renderer/character-switch-host';
// eslint-disable-next-line no-restricted-imports
import '../../../src/renderer/character-switch.css';
// eslint-disable-next-line no-restricted-imports
import { createToolboxFoundation } from '../../../src/renderer/toolbox-foundation';
import { createDemoTradeHost } from './trade-host';
import { mountTradeChat } from './trade-mount';
import { createHubGameFixture } from './hub-game-fixture';
import { mountToolsApp } from './mount';
import { mountWhispers } from './whispers-mount';
import { createWhisperSession } from '../../../src/shared/whisper-session';
import { createHubTravel } from './hub-travel';
import { createDemoTravelHost } from './travel-host';
import { estimateMarketRates } from '../../../src/shared/market-rates';
import { DEFAULT_SETTINGS, type AppSettings, type RendererSettingsPatch } from '../../../src/shared/contracts';

export function mountHubFixture(target: HTMLElement) {
  const canvas = document.createElement('canvas'); canvas.id = 'canvas'; canvas.tabIndex = 0; target.append(canvas);
  const record = (message: string) => { target.dataset.action = message; };
  let settings: AppSettings = { ...DEFAULT_SETTINGS, gwonmacTools: true, travelPalette: true, whispersEnabled: true, buildLibrary: true, tradeChat: true, xunlaiStorage: true };
  try { settings.hubShortcuts = JSON.parse(localStorage.getItem('hub-fixture-shortcuts') ?? '[]'); } catch { /* Disposable fixture data. */ }
  const settingsListeners = new Set<(value: AppSettings) => void>();
  let capturingShortcut = false;
  const hubSettings: HubSettingsApi = {
    get: async () => ({ settings, tools: { configured: settings.gwonmacTools, loaded: true, restartRequired: !settings.gwonmacTools, features: Object.fromEntries(GLOBAL_TOOLS.map(tool => [tool, { enabled: settings[FEATURE_SELECTION_POLICIES[GLOBAL_TOOL_FEATURES[tool]].activation.setting] }])) as GlobalToolSettings }, shortcuts: resolveShortcuts(settings.shortcutOverrides) }),
    update: async raw => {
      const change = parseHubSettingsChange(raw);
      if (change.kind === 'settings') settings = { ...settings, ...change.patch };
      else if (change.kind === 'master') settings = { ...settings, gwonmacTools: change.enabled };
      else if (change.kind === 'tool') settings = { ...settings, [FEATURE_SELECTION_POLICIES[GLOBAL_TOOL_FEATURES[change.tool]].activation.setting]: change.enabled };
      else {
        if (change.binding && shortcutReserved(change.binding)) throw new Error('Reserved shortcut');
        const conflict = change.binding && shortcutConflict(change.action, change.binding, resolveShortcuts(settings.shortcutOverrides));
        if (conflict) settings = { ...settings, shortcutOverrides: withShortcutOverride(settings.shortcutOverrides, conflict, null) };
        settings = { ...settings, shortcutOverrides: withShortcutOverride(settings.shortcutOverrides, change.action, change.binding) };
      }
      window.gwApplyFixtureAppearance?.({ uiStyle: settings.uiStyle, uiPanelOpacity: settings.uiPanelOpacity, uiFont: settings.uiFont, uiCustomTheme: settings.uiCustomTheme });
      window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: settings }));
    },
    capture: () => new Promise(resolve => {
      capturingShortcut = true;
      const onKey = (event: KeyboardEvent) => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (['Meta','Shift','Alt','Control'].includes(event.key)) return;
        window.removeEventListener('keydown', onKey, true); capturingShortcut = false;
        if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { resolve({ status: 'cancelled' }); return; }
        if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { resolve({ status: 'cleared' }); return; }
        const binding = shortcutFromInput({code:event.code, meta:event.metaKey, control:event.ctrlKey, shift:event.shiftKey, alt:event.altKey});
        resolve(!binding ? {status:'invalid'} : shortcutReserved(binding) ? {status:'reserved'} : {status:'captured',binding});
      };
      window.addEventListener('keydown', onKey, true);
    }),
  };
  Object.assign(window, {
    gwSurfaces: installSurfaceController(document),
    gwToolsSettings: () => settings,
    gwNative: { hubSettings, accounts: { get: async () => ({ current: '9e1bd41c-cfc0-4ca8-a57f-2f0ca159c72d', profiles: [{ id: '9e1bd41c-cfc0-4ca8-a57f-2f0ca159c72d', name: 'Main', state: 'running' }, { id: 'e98a37bc-5211-4bc5-8094-0b1286b3c42d', name: 'Second', state: 'ready' }] }), open: async (request: { mode: string }) => { record(`Account Second ${request.mode}`); } }, settings: { get: async () => settings, onChange: (listener: (value: AppSettings) => void) => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); }, set: async (patch: RendererSettingsPatch) => { settings = { ...settings, ...patch }; localStorage.setItem('hub-fixture-shortcuts', JSON.stringify(settings.hubShortcuts)); for (const listener of settingsListeners) listener(settings); window.dispatchEvent(new Event('gw:tools-settings')); return settings; } }, clipboard: { writeText: async (value: string) => record(`Copied ${value}`) }, trade: { getMarketRates: async () => ({ ...estimateMarketRates(new URLSearchParams(location.search).has('market-empty') ? [] : ['WTS armbraces 30e/ea','WTB armbraces 28e/ea','WTS zkeys 1.5e/ea','WTB zkeys 1.4e/ea','WTS 20 ectos for 100k','WTB 25 ectos for 100k'].flatMap((message,group)=>Array.from({length:6},(_,index)=>({source:'kamadan' as const,message,sender:`Sample ${group} ${index}`,timestamp:Date.now()-index*60_000})))), sample: true }), getTraderQuotes: async () => ({ updatedAt: Date.now(), quotes: [{ modelId: '0b03a2', side: 'buy', price: 6000, timestamp: Date.now() }, { modelId: '0b03a2', side: 'sell', price: 5000, timestamp: Date.now() }] }) }, app: { showLauncher: async () => record('Launcher'), openSettings: async () => record('Settings'), requestQuit: async () => record('Quit or Reload'), openExternal: async () => record('Website') } },
  });
  const hub = createHub(document.body);
  const game = createHubGameFixture(record);
  window.gwHub = hub;
  const characters = installCharacterSwitchHost(document.body);
  characters.attach({ characters: { status: 'ready', sequence: 1, selectedIndex: 0, characters: [
    { name: 'Fixture Monk', characterKey: 'monk', primaryProfession: 3, secondaryProfession: 0, characterType: 'roleplaying', campaign: 1, level: 20, mapId: 449 },
    ...['Ranger', 'Mesmer', 'Ritualist', 'Elementalist'].map((name, index) => ({ name: `Fixture ${name}`, characterKey: name.toLowerCase(), primaryProfession: [2, 5, 8, 6][index]!, secondaryProfession: 0, characterType: 'roleplaying' as const, campaign: 1, level: 20, mapId: 449 })),
    { name: 'Toefte', characterKey: 'toefte', primaryProfession: 3, secondaryProfession: 5, characterType: 'roleplaying', campaign: 1, level: 20, mapId: 449 },
    { name: 'Fixture Warrior', characterKey: 'warrior', primaryProfession: 1, secondaryProfession: 0, characterType: 'roleplaying', campaign: 1, level: 20, mapId: 55 },
  ] }, action: { status: 'idle' }, context: 'outpost', request(key) { record(`Character ${key}`); hub.close(); }, confirm() {}, cancelConfirmation() {}, reset() {},
    diagnostics: () => ({ version: 1, stage: 'unavailable', lastCode: 'play-path-unproved' }), subscribe() { return () => {}; },
  });
  const foundation = createToolboxFoundation(document.body, {
    async mountTool(element, onVisibilityChange) {
      const app = mountToolsApp(element, { host: game.host, hub, mode: 'embedded', initiallyVisible: false, onVisibilityChange });
      return { setVisible: visible => visible ? app.show() : app.hide(), setActive: app.setActive, requestClose: app.requestClose, update() {}, dispose: app.dispose };
    },
    async mountTrade(element, onVisibilityChange) {
      const app = mountTradeChat(element, { host: createDemoTradeHost(), mode: 'embedded', initiallyVisible: false, onVisibilityChange });
      return { setVisible: visible => visible ? app.show() : app.hide(), setActive: app.setActive, requestClose: app.hide, search: app.search, update() {}, dispose: app.dispose };
    },
  });
  const travelHost = createDemoTravelHost();
  const travel = createHubTravel(travelHost, hub);
  hub.attach(travel.source);
  let id = 0;
  let failSend = false;
  let sends = 0;
  const session = createWhisperSession(async (recipient, message) => {
    target.dataset.sends = String(++sends);
    if (failSend) throw new Error('Whisper could not be submitted. Your draft is kept.');
    session.observe([{ id: ++id, sender: recipient, message, direction: 'outgoing' }]);
    record('Whisper');
  });
  const messenger = document.createElement('div');
  messenger.className = 'whisper-popout-host';
  messenger.style.cssText = 'position:fixed;inset:0;pointer-events:none';
  document.body.append(messenger);
  const whisperSurface = window.gwSurfaces.register({ root: messenger, priority: 4, dismiss: () => session.setVisible(false) });
  session.subscribe(state => whisperSurface.setOpen(state.visible));
  messenger.addEventListener('pointerdown', () => whisperSurface.raise(), true);
  mountWhispers(messenger, { session });
  window.addEventListener('hub-fixture-failure', () => { failSend = true; });
  window.addEventListener('hub-fixture-reset', () => session.reset());
  window.addEventListener('hub-fixture-incoming', () => session.observe([{ id: ++id, sender: 'Romi Ranger', message: 'Ready for another mission?', direction: 'incoming' }]));
  window.addEventListener('hub-fixture-unavailable', () => session.setAvailable(false));
  session.setAvailable(true);
  // The synthetic play region follows the demo Travel host; the scenario select adds an explorable area.
  let explorable = false;
  const regionListeners = new Set<() => void>();
  const region = (): CompanionPlayRegionState => {
    const state = travelHost.state.value;
    return state.status !== 'ready' ? { status: 'waiting', reason: 'stale' } : { status: 'ready', sequence: 1, mapId: state.mapId,
      instanceType: explorable ? 1 : 0, playRegion: isPvpTravelDestination(state.mapId) ? 'pvp' : 'pve', travelContext: state.travelContext,
      characterKey: state.characterKey, unlockedMapWords: null, guildHall: state.guildHall, hasGuildHall: state.hasGuildHall };
  };
  watch(travelHost.state, () => { for (const listener of [...regionListeners]) listener(); }, { flush: 'sync' });
  const invites: string[] = [];
  const party = createPartyInvite({ region, chatReady: () => session.state.available, settleMs: 400,
    subscribeRegion: listener => { regionListeners.add(listener); return () => { regionListeners.delete(listener); }; },
    invite: async name => { invites.push(name); target.dataset.invites = invites.join('|'); record(`PARTY.INVITE ${name}`); },
    travel: async friend => { await travel.travel(friend.mapId); record(`PARTY.TRAVEL ${friend.character}`); },
  });
  const people = createHubPeople(hub, session, { unavailable: () => null,
    run: async friend => { await travel.travel(friend.mapId); record(`FRIEND.TRAVEL ${friend.character}`); } }, party);
  people.setEnabled(true);
  const friendsFor = (invitable: boolean) => ({ status: 'ready' as const, sequence: 1, generation: 1, friends: [
    { key: 'romi', alias: 'Romi', character: 'Romi Ranger', status: 'online' as const, mapId: 449 },
    { key: 'offline', alias: 'Offline Friend', character: '', status: 'offline' as const, mapId: 55 },
    // Four online friends whose person pages offer Travel, Invite and Travel and invite on rows 1-3.
    ...(invitable ? ([['alpha', 449], ['beta', 81], ['delta', 55], ['gamma', 194]] as const).map(([key, mapId]) => {
      const name = `Zed ${key[0]!.toUpperCase()}${key.slice(1)}`;
      return { key, alias: name, character: name, status: 'online' as const, mapId };
    }) : []),
    ...(invitable ? [{ key: 'arena', alias: 'Arena Ace', character: 'Arena Ace', status: 'online' as const, mapId: 188 }] : []),
  ] });
  const updateFriends = (invitable: boolean) => { const friends = friendsFor(invitable); session.updateFriends(friends); people.updateFriends(friends); };
  updateFriends(false);
  const setScenario = (value: string) => {
    game.setScenario(value);
    explorable = value === 'explorable';
    updateFriends(value === 'party');
    if (value === 'party') session.observe([{ id: ++id, sender: 'Mo Kaiser', direction: 'participant' }, { id: ++id, sender: 'Kai Mo Bearer', direction: 'participant' }]);
    for (const listener of [...regionListeners]) listener();
  };
  window.addEventListener('hub-fixture-scenario', event => { if (event instanceof CustomEvent) setScenario(String(event.detail)); });
  window.addEventListener('hub-fixture-withdraw', () => people.updateFriends({ status: 'waiting', reason: 'unavailable' }));
  window.addEventListener('gw:travel-toggle', event => { event.preventDefault(); travel.open(); });
  window.addEventListener('gw:whispers-toggle', event => {
    event.preventDefault();
    toggleHubWhispers(event, hub, messenger, session);
    if (session.state.visible) whisperSurface.raise();
  });
  window.addEventListener('hub-fixture-settings', event => { if (event instanceof CustomEvent) {
    settings = { ...settings, ...event.detail }; for (const listener of settingsListeners) listener(settings);
    foundation.setAvailable({ builds: settings.gwonmacTools && settings.buildLibrary, trade: settings.gwonmacTools && settings.tradeChat });
    people.setEnabled(settings.gwonmacTools && (settings.travelPalette || settings.whispersEnabled));
    window.dispatchEvent(new Event('gw:tools-settings'));
  } });
  const controls = document.createElement('div'); controls.className = 'hub-fixture-controls'; controls.style.cssText = 'position:fixed;bottom:8px;left:8px;display:flex;gap:8px';
  const open = document.createElement('button'); open.textContent = 'Open Hub'; open.className = 'ui-button'; open.onclick = () => hub.show(); controls.append(open);
  const theme = document.createElement('button'); theme.textContent = 'Change theme'; theme.className = 'ui-button';
  let modern = false;
  theme.onclick = () => { modern = !modern; window.gwApplyFixtureAppearance?.({ uiStyle: modern ? 'obsidian' : 'guild-wars', uiPanelOpacity: 100 }); };
  const scenario = document.createElement('select'); scenario.className = 'ui-select'; scenario.setAttribute('aria-label', 'Fixture scenario');
  for (const [value, label] of [['ready', 'Ready in outpost'], ['explorable', 'Explorable area'], ['partial', 'Interrupted apply'], ['duplicate', 'Duplicate build names'], ['folders', 'Nested build folders'], ['mixed-professions', 'Mixed hero professions'], ['party', 'People to invite']] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; scenario.append(option);
  }
  scenario.onchange = () => { setScenario(scenario.value); hub.show(); };
  const reset = document.createElement('button'); reset.className = 'ui-button'; reset.textContent = 'Reset fixture'; reset.onclick = () => { localStorage.removeItem('hub-fixture-shortcuts'); localStorage.removeItem('hub-fixture-library'); location.reload(); };
  const label = document.createElement('span'); label.textContent = 'Synthetic game · sample prices';
  controls.style.flexWrap = 'wrap'; controls.append(theme, scenario, reset, label); target.append(controls);
  window.addEventListener('keydown', event => {
    if (capturingShortcut) return;
    if (!event.metaKey || event.shiftKey || event.altKey || event.repeat) return;
    if (event.code === 'KeyR') { event.preventDefault(); hub.toggle(); return; }
    const command = ({ KeyB: 'tools', KeyT: 'travel', KeyD: 'whispers', KeyK: 'trade', KeyE: 'character' } as Record<string, string>)[event.code];
    if (command) { event.preventDefault(); window.dispatchEvent(new CustomEvent(`gw:${command}-toggle`, { cancelable: true, detail: 'show' })); }
  }, true);
  hub.show(); target.dataset.ready = 'true';
  return hub;
}
