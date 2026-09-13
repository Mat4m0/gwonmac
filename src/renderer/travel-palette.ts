/**
 * Owns lazy optional Travel presentation inside the Core Hub surface.
 * The existing Travel host remains the command and preference owner.
 */
import { currentTravelFriend, type TravelFriend, type TravelFriends } from '../shared/friends.js';
import type { TravelCommand, TravelGameState } from '../shared/travel-command.js';
import type { EmbeddedToolsBundle } from '../shared/tools-bundle-contracts.js';
import { matchHubRows, type HubSource } from '../shared/hub.js';
import { ensureToolsStylesheet } from './tools-stylesheet.js';
import { requireToolsApi } from './tools-native-api.js';

export function createTravelPalette(parent: HTMLElement, command: TravelCommand) {
  const installed = window.gwHub;
  if (!installed) throw new Error('Hub is not installed');
  const hub = installed;
  const native = requireToolsApi();
  let enabled = false;
  let visibilityGeneration = 0;
  let disposed = false;
  let state: TravelGameState = { status: 'waiting', reason: 'game' };
  let friends: TravelFriends = { status: 'waiting', reason: 'unavailable' };
  let app: ReturnType<EmbeddedToolsBundle<HTMLElement>['createHubTravel']> | null = null;
  let loading: Promise<void> | null = null;
  let detach: (() => void) | null = null;
  let unsubscribe = () => {};
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  async function load() {
    if (app) return app;
    if (!loading) loading = (async () => {
      ensureToolsStylesheet(parent.ownerDocument);
      const specifier = './tools/tools-app.js';
      const bundle: EmbeddedToolsBundle<HTMLElement> = await import(specifier);
      if (disposed) return;
      app = bundle.createHubTravel({ nativeApi: native, command, development: window.gwNative.init.development, hub });
      app.update(state); app.updateFriends(friends);
      unsubscribe = app.source.subscribe(refresh);
      app.source.setVisible(enabled && hub.visible); refresh();
    })().finally(() => { loading = null; });
    await loading;
    return app;
  }
  async function open() {
    if (app) { app.open(); return; }
    let active = true;
    hub.showView('Travel', target => {
      const message = target.ownerDocument.createElement('p');
      message.className = 'hub-empty'; message.textContent = 'Loading Travel…';
      target.append(message);
      return () => { active = false; message.remove(); };
    });
    try {
      const loaded = await load();
      if (active && !disposed && enabled) loaded?.open();
    } catch (error) { if (active) throw error; }
  }
  const source: HubSource = {
    feature: 'travelPalette',
    lookup: id => app?.source.lookup?.(id),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(visible) {
      if (!visible) visibilityGeneration++;
      app?.source.setVisible(visible);
      if (visible) void load().catch(() => { /* The explicit Travel action offers a retry. */ });
    },
    search(query) {
      return app?.source.search(query) ?? matchHubRows([{ id: 'travel', title: 'Travel', detail: 'Outposts, favourites and recent places', group: 'Tools', keywords: 'tp teleport destination', action: 'Browse travel', navigate: open, run: open }], query);
    },
  };
  const onCommand = (event: Event) => {
    if (!enabled) return;
    event.preventDefault();
    if (app?.active && (!(event instanceof CustomEvent) || event.detail !== 'show')) { hub.close(); return; }
    void open().catch(() => hub.showRows('Travel could not load', () => [{ id: 'retry-travel', title: 'Try again', detail: 'Your Travel preferences are unchanged', group: 'Travel', action: 'Retry', run: open }]));
  };
  window.addEventListener('gw:travel-toggle', onCommand);
  return {
    observingFriends: () => enabled && hub.visible,
    async travelToFriend(friend: TravelFriend, generation: number) {
      if (!enabled) throw new Error('Travel is turned off');
      const intent = visibilityGeneration;
      await load();
      if (intent !== visibilityGeneration) throw new Error('Travel cancelled');
      if (!enabled || disposed || !app) throw new Error('Travel is unavailable');
      const current = currentTravelFriend(friends, friend, generation);
      if (!current) {
        throw new Error('This friend’s location changed. Select them again.');
      }
      await app.travel(current.mapId);
    },
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (next) detach = hub.attach(source);
      else { detach?.(); detach = null; }
    },
    updateFriends(next: TravelFriends) { friends = next; app?.updateFriends(next); },
    update(next: TravelGameState) { state = next; app?.update(next); },
    dispose() {
      disposed = true; detach?.(); unsubscribe(); app?.dispose(); listeners.clear();
      window.removeEventListener('gw:travel-toggle', onCommand);
    },
  };
}
