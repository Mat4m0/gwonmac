// The main-process model installs the command transport before `commands.ts` registers with it.
import { installFixtureMain, quitFixtureGame } from './hub-fixture-main';
// eslint-disable-next-line no-restricted-imports
import '../../../src/renderer/commands';
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
import { askLeaveArea, leaveAreaCopy } from '../../../src/renderer/leave-area';
// eslint-disable-next-line no-restricted-imports
import { installResignCommand } from '../../../src/renderer/resign';
// eslint-disable-next-line no-restricted-imports
import '../../../src/renderer/hub.css';
// eslint-disable-next-line no-restricted-imports
import { createHubPeople } from '../../../src/renderer/hub-people';
// eslint-disable-next-line no-restricted-imports
import { createPartyInvite } from '../../../src/renderer/party-invite';
// eslint-disable-next-line no-restricted-imports
import type { CharacterSwitchActionState, CharacterSwitchFailureCode, CharacterSwitchSource } from '../../../src/renderer/character-switch-model';
import { createFixtureLifecycle, FIXTURE_LIFECYCLES, isFixtureLifecycle } from './hub-fixture-lifecycle';
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
import { travelDestination } from '../../../src/shared/travel';
import { estimateMarketRates } from '../../../src/shared/market-rates';
import { DEFAULT_SETTINGS, WASM_HEAP_CAP_BYTES, type AppSettings, type RendererSettingsPatch } from '../../../src/shared/contracts';

/** One input event that reached the synthetic game canvas. */
export type FixtureCanvasEvent = Readonly<{ type: string; code?: string; repeat?: boolean; detail?: number; button?: number }>;

export function mountHubFixture(target: HTMLElement) {
  const params = new URLSearchParams(location.search);
  // Slow and failing game answers for the session races (HUB-004): `?accounts-ms=`, `?invite-ms=`,
  // `?invite-fail=<reason>`, `?switch-fail=<code>` (after `?switch-ms=`), `?templates-ms=` and `?slow-apply` (the runner on the real clock).
  const delay = (name: string) => new Promise(resolve => setTimeout(resolve, Number(params.get(name)) || 0));
  // Every game or account action in order, so a test can count what one press ran.
  const actions: string[] = [];
  window.gwFixtureActions = actions;
  const record = (message: string) => { actions.push(message); target.dataset.action = message; };
  // The game canvas fills the window as in production; anything that reaches it would reach Guild Wars.
  const canvas = document.createElement('canvas'); canvas.id = 'canvas'; canvas.tabIndex = 0;
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;outline:none';
  target.append(canvas);
  const canvasEvents: FixtureCanvasEvent[] = [];
  const canvasCount = document.createElement('span'); canvasCount.className = 'hub-fixture-canvas-count';
  const countCanvas = () => { canvasCount.textContent = `Canvas input: ${canvasEvents.length}`; target.dataset.canvasEvents = String(canvasEvents.length); };
  for (const type of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) {
    canvas.addEventListener(type, event => {
      canvasEvents.push(event instanceof KeyboardEvent ? { type, code: event.code, repeat: event.repeat } : { type, detail: (event as MouseEvent).detail, button: (event as MouseEvent).button });
      countCanvas();
    });
  }
  window.gwFixtureCanvas = { events: canvasEvents, clear() { canvasEvents.length = 0; countCanvas(); } };
  countCanvas();
  let settings: AppSettings = { ...DEFAULT_SETTINGS, gwonmacTools: true, travelPalette: true, whispersEnabled: true, buildLibrary: true, tradeChat: true, xunlaiStorage: true, resignEnabled: true };
  try { settings.hubShortcuts = JSON.parse(localStorage.getItem('hub-fixture-shortcuts') ?? '[]'); } catch { /* Disposable fixture data. */ }
  const settingsListeners = new Set<(value: AppSettings) => void>();
  let capturingShortcut = false; let cancelShortcutCapture = () => {};
  const hubSettings: HubSettingsApi = {
    get: async () => ({ settings, tools: { configured: settings.gwonmacTools, loaded: true, restartRequired: !settings.gwonmacTools, features: Object.fromEntries(GLOBAL_TOOLS.map(tool => [tool, { enabled: settings[FEATURE_SELECTION_POLICIES[GLOBAL_TOOL_FEATURES[tool]].activation.setting] }])) as GlobalToolSettings }, shortcuts: resolveShortcuts(settings.shortcutOverrides) }),
    // `?settings-ms=` answers every settings write late, as a busy main process does.
    update: async raw => {
      await delay('settings-ms');
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
      cancelShortcutCapture();
      const finish = (result: Awaited<ReturnType<HubSettingsApi['capture']>>) => {
        window.removeEventListener('keydown', onKey, true); capturingShortcut = false; cancelShortcutCapture = () => {}; resolve(result);
      };
      const onKey = (event: KeyboardEvent) => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (['Meta','Shift','Alt','Control'].includes(event.key)) return;
        if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { finish({ status: 'cancelled' }); return; }
        if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { finish({ status: 'cleared' }); return; }
        const binding = shortcutFromInput({code:event.code, key:event.key, meta:event.metaKey, control:event.ctrlKey, shift:event.shiftKey, alt:event.altKey});
        // Main's window capture reports what was pressed; the recorder refuses reserved chords.
        finish(!binding ? {status:'invalid'} : {status:'captured',binding});
      };
      capturingShortcut = true; cancelShortcutCapture = () => finish({ status: 'cancelled' });
      window.addEventListener('keydown', onKey, true);
    }),
    // Main's `cancelAppShortcutCapture`: the capture ends as cancelled and takes no further key.
    cancelCapture: async () => cancelShortcutCapture(),
  };
  const fixtureMain = installFixtureMain({ settings: () => settings, capturing: () => capturingShortcut, record,
    updateSettings: patch => window.dispatchEvent(new CustomEvent('hub-fixture-settings', { detail: patch })) });
  // A test renames an account between two reads to model a list that changed meanwhile (HUB-174).
  let secondName = 'Second';
  window.gwFixtureAccounts = { renameSecond(name: string) { secondName = name; } };
  Object.assign(window, {
    // `?double-click-ms=` models a player's slower macOS Double-click speed, as main passes it.
    gwSurfaces: installSurfaceController(document, { doubleClickMs: Number(params.get('double-click-ms')) || null }),
    gwToolsSettings: () => settings,
    gwNative: { ...window.gwNative, init: { enhancementSelection: { tools: true } }, hubSettings,
      // A session that started with the standard memory module, as a fresh launch does.
      client: { ...window.gwNative?.client, session: async () => ({ appVersion: 'fixture', compatibility: null, extendedMemory: { requestedAtLaunch: false, status: 'standard', effectiveCapBytes: WASM_HEAP_CAP_BYTES, fallbackReason: null }, healthToken: null }) }, accounts: { get: async () => { await delay('accounts-load-ms'); return ({ current: '9e1bd41c-cfc0-4ca8-a57f-2f0ca159c72d', profiles: [{ id: '9e1bd41c-cfc0-4ca8-a57f-2f0ca159c72d', name: 'Main', state: 'running' }, { id: 'e98a37bc-5211-4bc5-8094-0b1286b3c42d', name: secondName, state: 'ready' }] }); }, open: async (request: { mode: string }) => { await delay('accounts-ms'); record(`Account Second ${request.mode}`); } }, settings: { get: async () => settings, onChange: (listener: (value: AppSettings) => void) => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); }, set: async (patch: RendererSettingsPatch) => { await delay('settings-ms'); settings = { ...settings, ...patch }; localStorage.setItem('hub-fixture-shortcuts', JSON.stringify(settings.hubShortcuts)); for (const listener of settingsListeners) listener(settings); window.dispatchEvent(new Event('gw:tools-settings')); return settings; } }, clipboard: { writeText: async (value: string) => record(`Copied ${value}`) }, trade: { getMarketRates: async () => ({ ...estimateMarketRates(new URLSearchParams(location.search).has('market-empty') ? [] : ['WTS armbraces 30e/ea','WTB armbraces 28e/ea','WTS zkeys 1.5e/ea','WTB zkeys 1.4e/ea','WTS 20 ectos for 100k','WTB 25 ectos for 100k'].flatMap((message,group)=>Array.from({length:6},(_,index)=>({source:'kamadan' as const,message,sender:`Sample ${group} ${index}`,timestamp:Date.now()-index*60_000})))), sample: true }), getTraderQuotes: async () => ({ updatedAt: Date.now(), quotes: [{ modelId: '0b03a2', side: 'buy', price: 6000, timestamp: Date.now() }, { modelId: '0b03a2', side: 'sell', price: 5000, timestamp: Date.now() }], sample: true }) }, app: { showLauncher: async () => record('Launcher'), openSettings: async (section: string) => record(`Settings ${section}`), requestQuit: async () => quitFixtureGame(record), showQuitOrReload: () => fixtureMain.showQuitOrReload(), openExternal: async () => record('Website') } },
  });
  const hub = createHub(document.body);
  const librarySize = Number(params.get('library'));
  const game = createHubGameFixture(record, { ...(Number.isSafeInteger(librarySize) && librarySize > 0 ? { librarySize } : {}), realTime: params.has('slow-apply'), templatesMs: Number(params.get('templates-ms')) || 0 });
  window.gwHub = hub;
  // One synthetic lifecycle feeds Travel, the play region, Characters and the party (`?lifecycle=`).
  const travelHost = createDemoTravelHost();
  // Every trip is a game action, whichever row, page or view started it.
  const demoTravel = travelHost.travel;
  travelHost.travel = async request => { record(`TRAVEL ${travelDestination(request.mapId)?.name ?? request.mapId}`); await demoTravel(request); };
  const lifecycle = createFixtureLifecycle(travelHost);
  const initialLifecycle = params.get('lifecycle');
  if (isFixtureLifecycle(initialLifecycle)) lifecycle.set(initialLifecycle);
  game.setPlayRegion(lifecycle.region());
  lifecycle.subscribe(() => game.setPlayRegion(lifecycle.region()));
  // The controller's refusals and explorable confirmation, without its native selector.
  let characterAction: CharacterSwitchActionState = { status: 'idle' };
  let pendingCharacter: string | null = null;
  const switchFailure = params.get('switch-fail') as CharacterSwitchFailureCode | null;
  const characterListeners = new Set<() => void>();
  const publishCharacter = (next: CharacterSwitchActionState) => { characterAction = next; for (const listener of [...characterListeners]) listener(); };
  const switchTo = (key: string, confirmed: boolean) => {
    const context = lifecycle.context();
    if (context === 'pvp-explorable') publishCharacter({ status: 'failed', code: 'active-pvp', retryable: false });
    else if (context === 'loading') publishCharacter({ status: 'failed', code: 'game-loading', retryable: true });
    else if (context === 'unavailable') publishCharacter({ status: 'failed', code: 'state-unavailable', retryable: true });
    else if (context === 'pve-explorable' && !confirmed) { pendingCharacter = key; publishCharacter({ status: 'confirming' }); }
    else if (switchFailure) {
      // The palette withdraws while the switch runs; the failure arrives after the Hub closed (HUB-035).
      pendingCharacter = null; record(`Character ${key}`); publishCharacter({ status: 'switching', stage: 'logout' });
      setTimeout(() => publishCharacter({ status: 'failed', code: switchFailure, retryable: true }), Number(params.get('switch-ms')) || 1000);
    }
    else { pendingCharacter = null; record(`Character ${key}`); hub.close(); publishCharacter({ status: 'idle' }); }
  };
  const characterList: CharacterSwitchSource['characters'] = { status: 'ready', sequence: 1, selectedIndex: 0, characters: [
    { name: 'Fixture Monk', characterKey: 'monk', primaryProfession: 3, secondaryProfession: 0, characterType: 'roleplaying', campaign: 1, level: 20, mapId: 449 },
    ...['Ranger', 'Mesmer', 'Ritualist', 'Elementalist'].map((name, index) => ({ name: `Fixture ${name}`, characterKey: name.toLowerCase(), primaryProfession: [2, 5, 8, 6][index]!, secondaryProfession: 0, characterType: 'roleplaying' as const, campaign: 1, level: 20, mapId: 449 })),
    { name: 'Toefte', characterKey: 'toefte', primaryProfession: 3, secondaryProfession: 5, characterType: 'roleplaying', campaign: 1, level: 20, mapId: 449 },
    { name: 'Fixture Warrior', characterKey: 'warrior', primaryProfession: 1, secondaryProfession: 0, characterType: 'roleplaying', campaign: 1, level: 20, mapId: 55 },
  ] };
  // `?characters-ms=` keeps the account's character list on its way for that long, as after a login.
  let characters: CharacterSwitchSource['characters'] = params.has('characters-ms') ? { status: 'waiting', reason: 'snapshot' } : characterList;
  if (params.has('characters-ms')) setTimeout(() => { characters = characterList; for (const listener of [...characterListeners]) listener(); }, Number(params.get('characters-ms')) || 0);
  const characterSource: CharacterSwitchSource = {
    get characters() { return characters; },
    get action() { return characterAction; },
    get context() { return lifecycle.context(); },
    request: key => switchTo(key, false),
    confirm() { if (characterAction.status === 'confirming' && pendingCharacter) switchTo(pendingCharacter, true); },
    cancelConfirmation() { if (characterAction.status === 'confirming') { pendingCharacter = null; publishCharacter({ status: 'idle' }); } },
    reset() { pendingCharacter = null; publishCharacter({ status: 'idle' }); },
    diagnostics: () => ({ version: 1, stage: 'unavailable', lastCode: 'play-path-unproved' }),
    subscribe(listener) {
      characterListeners.add(listener);
      const stop = lifecycle.subscribe(listener);
      return () => { characterListeners.delete(listener); stop(); };
    },
  };
  window.gwCharacterSwitch = characterSource;
  installCharacterSwitchHost(document.body).attach(characterSource);
  // The production Resign owner over a synthetic command queue: /resign is a recorded game action.
  const resign = installResignCommand({
    enhancement_configure_resign: () => 0,
    enhancement_resign: () => { record('RESIGN'); return 1; },
  } as unknown as WebAssembly.Exports);
  resign.update(settings.gwonmacTools && settings.resignEnabled);
  const foundation = createToolboxFoundation(document.body, {
    async mountTool(element, onVisibilityChange) {
      const app = mountToolsApp(element, { host: game.host, hub, mode: 'embedded', initiallyVisible: false, onVisibilityChange });
      return { setVisible: visible => visible ? app.show() : app.hide(), setActive: app.setActive, requestClose: app.requestClose, update() {}, dispose: app.dispose };
    },
    async mountTrade(element, onVisibilityChange) {
      const app = mountTradeChat(element, { host: createDemoTradeHost(), mode: 'embedded', initiallyVisible: false, onVisibilityChange });
      return { setVisible: visible => visible ? app.show() : app.hide(), setActive: app.setActive, requestClose: app.hide, stepBack: app.stepBack, search: app.search, update() {}, dispose: app.dispose };
    },
  });
  const travel = createHubTravel(travelHost, hub, (place, leave) => askLeaveArea(hub, leaveAreaCopy('travel', place), leave));
  // `?travel-load-ms=` attaches Travel late, as the game loads its lazy bundle after the Hub opened.
  const travelLoadMs = Number(params.get('travel-load-ms')) || 0;
  if (travelLoadMs) setTimeout(() => hub.attach(travel.source), travelLoadMs); else hub.attach(travel.source);
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
  const invites: string[] = [];
  const partyInvite = createPartyInvite({ region: lifecycle.region, chatReady: () => session.state.available, settleMs: 400,
    subscribeRegion: lifecycle.subscribe,
    invite: async name => {
      await delay('invite-ms');
      if (params.has('invite-fail')) throw new Error(params.get('invite-fail') || 'Guild Wars chat is not ready');
      invites.push(name); target.dataset.invites = invites.join('|'); record(`PARTY.INVITE ${name}`);
    },
    travel: async friend => { await travel.travel(friend.mapId); record(`PARTY.TRAVEL ${friend.character}`); },
  });
  const people = createHubPeople(hub, session, { unavailable: friend => { const region = lifecycle.region(); return region.status === 'ready' && region.mapId === friend.mapId ? 'You are already in this outpost' : null; },
    run: async friend => { await travel.travel(friend.mapId); record(`FRIEND.TRAVEL ${friend.character}`); } }, partyInvite);
  people.setEnabled(true);
  // Romi waits in the player's starting outpost, so `invite Romi` is ready to send there.
  // The injected party (`?party`): chat participants, four online Zed friends and a friend in a PvP outpost.
  const friendsFor = (injected: boolean) => ({ status: 'ready' as const, sequence: 1, generation: 1, friends: [
    { key: 'romi', alias: 'Romi', character: 'Romi Ranger', status: 'online' as const, mapId: 55 },
    { key: 'offline', alias: 'Offline Friend', character: '', status: 'offline' as const, mapId: 55 },
    // Four online friends whose person pages offer Travel, Invite and Travel and invite on rows 1-3.
    ...(injected ? ([['alpha', 449], ['beta', 81], ['delta', 55], ['gamma', 194]] as const).map(([key, mapId]) => {
      const name = `Zed ${key[0]!.toUpperCase()}${key.slice(1)}`;
      return { key, alias: name, character: name, status: 'online' as const, mapId };
    }) : []),
    ...(injected ? [{ key: 'arena', alias: 'Arena Ace', character: 'Arena Ace', status: 'online' as const, mapId: 188 }] : []),
  ] });
  let participantsSeen = false;
  const setParty = (injected: boolean) => {
    const friends = friendsFor(injected); session.updateFriends(friends); people.updateFriends(friends);
    if (injected && !participantsSeen) { participantsSeen = true; session.observe([{ id: ++id, sender: 'Mo Kaiser', direction: 'participant' }, { id: ++id, sender: 'Kai Mo Bearer', direction: 'participant' }]); }
  };
  setParty(params.has('party'));
  window.addEventListener('hub-fixture-scenario', event => { if (event instanceof CustomEvent) game.setScenario(String(event.detail)); });
  window.addEventListener('hub-fixture-lifecycle', event => { if (event instanceof CustomEvent && isFixtureLifecycle(event.detail)) lifecycle.set(event.detail); });
  window.addEventListener('hub-fixture-party', event => { if (event instanceof CustomEvent) setParty(event.detail !== false); });
  window.addEventListener('hub-fixture-withdraw', () => people.updateFriends({ status: 'waiting', reason: 'unavailable' }));
  // The Travel and Whispers owners' command listeners (`travel-palette.ts`, `whisper-surface.ts`), over the fixture's hosts.
  window.addEventListener('gw:travel-toggle', event => {
    if (!settings.gwonmacTools || !settings.travelPalette) return;
    event.preventDefault();
    hub.direct('travel', travel.open);
  });
  window.addEventListener('gw:whispers-toggle', event => {
    if (!settings.gwonmacTools || !settings.whispersEnabled || !session.state.available) return;
    toggleHubWhispers(event, hub, messenger, session);
    if (session.state.visible) whisperSurface.raise();
  });
  window.addEventListener('hub-fixture-settings', event => { if (event instanceof CustomEvent) {
    settings = { ...settings, ...event.detail }; for (const listener of settingsListeners) listener(settings);
    foundation.setAvailable({ builds: settings.gwonmacTools && settings.buildLibrary, trade: settings.gwonmacTools && settings.tradeChat });
    people.setEnabled(settings.gwonmacTools && (settings.travelPalette || settings.whispersEnabled));
    resign.update(settings.gwonmacTools && settings.resignEnabled);
    window.dispatchEvent(new Event('gw:tools-settings'));
  } });
  const controls = document.createElement('div'); controls.className = 'hub-fixture-controls';
  controls.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:10;display:flex;flex-wrap:wrap;align-items:center;gap:8px';
  const open = document.createElement('button'); open.textContent = 'Open Hub'; open.className = 'ui-button'; open.onclick = () => hub.show();
  const theme = document.createElement('button'); theme.textContent = 'Change theme'; theme.className = 'ui-button';
  let modern = false;
  theme.onclick = () => { modern = !modern; window.gwApplyFixtureAppearance?.({ uiStyle: modern ? 'obsidian' : 'guild-wars', uiPanelOpacity: 100 }); };
  const select = (label: string, options: readonly (readonly [string, string])[], value: string, change: (value: string) => void) => {
    const element = document.createElement('select'); element.className = 'ui-select'; element.setAttribute('aria-label', label);
    for (const [id, text] of options) { const option = document.createElement('option'); option.value = id; option.textContent = text; element.append(option); }
    element.value = value;
    element.onchange = () => { change(element.value); hub.show(); };
    return element;
  };
  const scenario = select('Fixture scenario', [['ready', 'Standard builds'], ['partial', 'Interrupted apply'], ['duplicate', 'Duplicate build names'], ['folders', 'Nested build folders'], ['mixed-professions', 'Mixed hero professions']], 'ready', game.setScenario);
  const lifecycleSelect = select('Lifecycle state', FIXTURE_LIFECYCLES, lifecycle.phase, value => { if (isFixtureLifecycle(value)) lifecycle.set(value); });
  lifecycle.subscribe(() => { lifecycleSelect.value = lifecycle.phase; });
  const partyToggle = document.createElement('label'); partyToggle.style.cssText = 'display:flex;gap:4px;align-items:center';
  const partyBox = document.createElement('input'); partyBox.type = 'checkbox'; partyBox.checked = params.has('party');
  partyBox.onchange = () => { setParty(partyBox.checked); hub.show(); };
  partyToggle.append(partyBox, 'Injected party');
  const reset = document.createElement('button'); reset.className = 'ui-button'; reset.textContent = 'Reset fixture'; reset.onclick = () => { localStorage.removeItem('hub-fixture-shortcuts'); localStorage.removeItem('hub-fixture-library'); location.reload(); };
  const label = document.createElement('span'); label.textContent = `Synthetic game · sample prices${game.librarySize ? ` · ${game.librarySize} builds` : ''}`;
  controls.append(open, theme, scenario, lifecycleSelect, partyToggle, reset, canvasCount, label); target.append(controls);
  // The game has keyboard focus before the player summons the Hub.
  canvas.focus(); hub.show(); target.dataset.ready = 'true';
  return hub;
}
