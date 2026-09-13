/** One Travel host serves both unified search and the existing detailed view. */
import { createApp, h, watch } from 'vue';
import type { HubPresenter, HubRow, HubSource } from '../../../src/shared/hub';
import { matchHubRows, parseHubQuery, hubMatch } from '../../../src/shared/hub';
import { TRAVEL_DESTINATIONS, travelDestination } from '../../../src/shared/travel';
import { travelContextRefusal, travelDestinationAvailability } from '../../../src/shared/travel-command';
import TravelPalette from './components/TravelPalette.vue';
import type { TravelHost } from './travel-host';
import { useTravelPreferences } from './travel-preferences';

export function createHubTravel(host: TravelHost, hub: HubPresenter<HTMLElement>) {
  const preferences = useTravelPreferences(host);
  let visible = false;
  let active = false;
  let disposed = false;
  let loadError = '';
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const stop = watch([host.state, host.attempt, host.history, preferences.synonyms], refresh, { flush: 'sync' });
  const load = async () => {
    try { await Promise.all([preferences.load(), host.loadHistory()]); loadError = ''; }
    catch { loadError = 'Travel preferences could not load. Open Travel to retry.'; }
    if (!disposed) refresh();
  };
  function open() {
    let resume: InstanceType<typeof TravelPalette>['$props']['resume'];
    hub.showView('Travel', (target, back) => {
      active = true;
      const app = createApp({ setup: () => () => h(TravelPalette, {
        host, preferences, ...(resume ? { resume } : {}), onRemember: state => { resume = state; }, inset: true, visible: true, nativeDialog: true, onClose: back,
      }) });
      app.mount(target);
      return () => { active = false; app.unmount(); };
    }, () => !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().travelPalette);
  }
  function refusal(mapId: number) {
    const availability = travelDestinationAvailability(host.state.value, mapId);
    return host.unavailable ?? travelContextRefusal(host.state.value, mapId)
      ?? (host.attempt.value.status !== 'idle' ? 'Travel is already in progress' : null)
      ?? (host.state.value.status !== 'ready' ? 'Waiting for Guild Wars' : null)
      ?? (host.state.value.status === 'ready' && host.state.value.mapId === mapId ? 'Current location' : null)
      ?? (availability === 'locked' ? 'Not unlocked by this character' : null);
  }
  async function travel(mapId: number) {
    const reason = refusal(mapId);
    if (reason) throw new Error(reason);
    await host.travel({ mapId });
    hub.close();
  }
  const source: HubSource = {
    feature: 'travelPalette',
    context: () => host.state.value.status === 'ready' ? travelDestination(host.state.value.mapId)?.name ?? null : null,
    lookup(id) { const place = travelDestination(Number(id.replace('place:', ''))); return place ? source.search(place.name).find(row => row.id === id) : undefined; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) { if (next && !visible) void load(); visible = next; },
    search(query) {
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'travel') return [];
      query = parsed.term;
      const tools: HubRow[] = [{ id: 'travel', title: 'Travel', detail: loadError || 'Outposts, favourites, recent places and Guild Hall', group: 'Tools', keywords: 'tp teleport destination', action: 'Browse travel', navigate: open, run: open }];
      const destinations = query.trim() ? TRAVEL_DESTINATIONS.filter(destination => hubMatch(destination.name, query, preferences.synonyms.value.filter(entry => entry.mapId === destination.mapId).map(entry => entry.term)) !== null).slice(0, 8)
        : host.history.value.filter(id => !refusal(id)).slice(0, 3).flatMap(id => { const destination = travelDestination(id); return destination ? [destination] : []; });
      return [...destinations.map(destination => {
        const reason = refusal(destination.mapId);
        return { id: `place:${destination.mapId}`, title: destination.name,
          detail: query.trim() ? 'Outpost · Any district' : 'Recently visited · Any district',
          group: query.trim() ? 'Places' : 'Continue', action: `Travel to ${destination.name}`,
          ...(reason ? { unavailable: reason } : {}), run: () => travel(destination.mapId) };
      }), ...matchHubRows(tools, query)];
    },
  };
  return { source, open, travel, get active() { return active; },
    update: host.updateGameState, updateFriends: host.updateFriends,
    dispose() { disposed = true; stop(); listeners.clear(); host.dispose(); },
  };
}
