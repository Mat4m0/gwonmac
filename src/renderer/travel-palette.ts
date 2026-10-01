/**
 * Owns lazy optional Travel presentation inside the Core Hub surface.
 * The existing Travel host remains the command and preference owner.
 */
import { currentTravelFriend, type TravelFriend, type TravelFriends } from '../shared/friends.js';
import type { TravelCommand, TravelGameState } from '../shared/travel-command.js';
import type { EmbeddedToolsBundle } from '../shared/tools-bundle-contracts.js';
import { matchHubRows, type HubSource, type HubViewMount } from '../shared/hub.js';
import { ensureToolsStylesheet } from './tools-stylesheet.js';
import { askLeaveArea, leaveAreaCopy } from './leave-area.js';
import { requireToolsApi } from './tools-native-api.js';

/** The Travel tool is switched on; a map load, character select or PvP only makes it unavailable for now. */
const toolOn = () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().travelPalette;

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
      app = bundle.createHubTravel({ nativeApi: native, command, development: window.gwNative.init.development, hub,
        leaveArea: (place, leave) => askLeaveArea(hub, leaveAreaCopy('travel', place), leave) });
      app.update(state); app.updateFriends(friends);
      unsubscribe = app.source.subscribe(refresh);
      app.source.setVisible(enabled && hub.visible); refresh();
    })().finally(() => { loading = null; });
    await loading;
    return app;
  }
  /**
   * The Travel page. Before the lazy bundle has loaded, the page shows its loading line and the
   * loaded view mounts into that same page, so the first ⌘T or `/tp` never leaves a placeholder
   * parent behind (HUB-018).
   */
  function open() {
    /** This page's Travel content, created once so Back restores its state. */
    let page: HubViewMount<HTMLElement> | null = null;
    hub.showView('Travel', (target, back, footer) => {
      if (app) return (page ??= app.page())(target, back, footer);
      let active = true;
      let unmount = () => {};
      const doc = target.ownerDocument;
      const message = doc.createElement('p'); message.className = 'hub-empty'; message.setAttribute('role', 'status');
      const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'ui-button'; retry.textContent = 'Try again'; retry.hidden = true;
      target.append(message, retry);
      const attempt = () => {
        message.textContent = 'Loading Travel…'; retry.hidden = true;
        load().then(loaded => {
          if (!active || !loaded || !enabled) return;
          message.remove(); retry.remove(); unmount = (page ??= loaded.page())(target, back, footer);
          // The keyboard that waited on the loading page moves to Travel's search.
          if (!target.contains(doc.activeElement)) target.querySelector<HTMLElement>('input[role=combobox]')?.focus();
        }).catch(() => {
          if (!active) return;
          message.textContent = 'Travel could not load. Your Travel preferences are unchanged.'; retry.hidden = false; retry.focus();
        });
      };
      retry.onclick = attempt; attempt();
      return () => { active = false; message.remove(); retry.remove(); unmount(); };
    }, () => !disposed && toolOn(), 'travel');
  }
  const source: HubSource = {
    feature: 'travelPalette',
    lookup: id => app?.source.lookup?.(id),
    context: () => app?.source.context?.() ?? null,
    lifecycle: () => app?.source.lifecycle?.() ?? null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(visible) {
      if (!visible) visibilityGeneration++;
      app?.source.setVisible(visible);
      if (visible) void load().catch(() => { /* The explicit Travel action offers a retry. */ });
    },
    search(query) {
      const unavailable = command.unavailable();
      return app?.source.search(query) ?? matchHubRows([{ id: 'travel', title: 'Travel', detail: 'Outposts, favourites and recent places', group: 'Tools', keywords: 'tp teleport destination', action: 'Browse travel', ...(unavailable ? { unavailable } : {}), navigate: open, run: open }], query);
    },
  };
  const onCommand = (event: Event) => {
    if (!enabled) return;
    event.preventDefault();
    hub.direct('travel', open);
  };
  window.addEventListener('gw:travel-toggle', onCommand);
  // Attached for the palette's whole life: a map load, character select or PvP only makes its
  // rows unavailable, with the command's reason, so the open page and the Home query survive
  // (HUB-051, HUB-135). Disposal withdraws it; the Travel setting hides it.
  detach = hub.attach(source);
  return {
    observingFriends: () => enabled && hub.visible,
    async travelToFriend(friend: TravelFriend, generation: number) {
      const reason = command.unavailable();
      if (reason) throw new Error(reason);
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
    /** Whether Travel can act now; the rows follow the command's reason. */
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      refresh();
    },
    updateFriends(next: TravelFriends) { friends = next; app?.updateFriends(next); },
    update(next: TravelGameState) { state = next; app?.update(next); },
    dispose() {
      disposed = true; app?.dispose(); detach?.(); unsubscribe(); listeners.clear();
      window.removeEventListener('gw:travel-toggle', onCommand);
    },
  };
}
