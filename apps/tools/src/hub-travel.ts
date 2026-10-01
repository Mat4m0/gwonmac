/** One Travel host serves both unified search and the existing detailed view. */
import { createApp, h, watch } from 'vue';
import type { HubPresenter, HubRow, HubSource, HubTask, HubViewMount } from '../../../src/shared/hub';
import { matchHubRows, parseHubQuery, hubTier } from '../../../src/shared/hub';
import { TRAVEL_DESTINATIONS, isPvpTravelDestination, travelDestination, type TravelDestination } from '../../../src/shared/travel';
import { guildWarsMapName } from '../../../src/shared/guild-wars-map-names';
import { travelContextRefusal, travelDestinationAvailability } from '../../../src/shared/travel-command';
import TravelPalette from './components/TravelPalette.vue';
import type { TravelHost } from './travel-host';
import { useTravelPreferences } from './travel-preferences';

/** Home shows the best few places; the rest are one row away, in Travel. */
const PLACES_SHOWN = 8;

/**
 * Asks "Leave this area?" on its own Hub page before a trip out of an explorable area, runs
 * `leave` when the player leaves, and rejects with an AbortError when they stay (D-27).
 */
export type LeaveArea = (place: string, leave: () => Promise<void>) => Promise<void>;

export function createHubTravel(host: TravelHost, hub: HubPresenter<HTMLElement>, leaveArea: LeaveArea) {
  const preferences = useTravelPreferences(host);
  let visible = false;
  let active = false;
  let disposed = false;
  let loadError = '';
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  const stop = watch([host.state, host.attempt, host.history, preferences.synonyms], refresh, { flush: 'sync' });
  // A trip that fails after the quiet close ("did not start", "did not confirm arrival") is
  // reported once through the Hub's receipt; success stays quiet, and the open Travel view
  // shows its own notice (HUB-072).
  const stopNotice = watch(host.notice, notice => {
    if (notice && (notice.level === 'warning' || notice.level === 'danger') && !active) hub.notify(notice.message, 'failed');
  }, { flush: 'sync' });
  const load = async () => {
    try { await Promise.all([preferences.load(), host.loadHistory()]); loadError = ''; }
    catch { loadError = 'Travel preferences could not load. Open Travel to retry.'; }
    if (!disposed) refresh();
  };
  /**
   * The content of one Travel page. The page keeps its search and Customize state while Back
   * or a resume restores it; a new Travel page starts fresh. Core's lazy loader mounts it into
   * the page it already shows.
   */
  function page(query = ''): HubViewMount<HTMLElement> {
    // A page opened with a search starts on it, e.g. from Home's "show all places" row.
    let resume: InstanceType<typeof TravelPalette>['$props']['resume'] = query
      ? { query, selected: null, mode: 'travel', editingSlot: null, addingPhrase: false, phrase: '', mapId: null, scroll: 0 } : undefined;
    return (target, back, footer) => {
      active = true;
      const app = createApp({ setup: () => () => h(TravelPalette, {
        host, preferences, footer, leaveArea, ...(resume ? { resume } : {}), onRemember: state => { resume = state; }, inset: true, hubParent: !!hub.hasParent, visible: true, nativeDialog: true, onClose: back,
        // A trip ends the task: the Hub closes, whether Travel opened from Home or by Command-T (HUB-017).
        onTravelled: () => hub.close(),
      }) });
      app.mount(target);
      return () => { active = false; app.unmount(); };
    };
  }
  const available = () => !disposed && !!window.gwToolsSettings?.().gwonmacTools && !!window.gwToolsSettings?.().travelPalette;
  function open() { hub.showView('Travel', page(), available, 'travel'); }
  /** The certified instance type, never the catalogue: a Guild Hall or an uncatalogued outpost is no explorable area. */
  const explorable = () => host.state.value.status === 'ready' && host.state.value.explorable;
  function refusal(mapId: number) {
    const availability = travelDestinationAvailability(host.state.value, mapId);
    return host.unavailable ?? travelContextRefusal(host.state.value, mapId)
      ?? (host.attempt.value.status !== 'idle' ? 'Travel is already in progress' : null)
      ?? (host.state.value.status !== 'ready' ? 'Waiting for Guild Wars' : null)
      ?? (host.state.value.status === 'ready' && host.state.value.mapId === mapId ? `You are already in ${travelDestination(mapId)?.name ?? 'this outpost'}` : null)
      ?? (availability === 'locked' ? 'Not unlocked by this character' : null);
  }
  /**
   * Starts one trip; the Hub task that asked for it ends the Hub session. A trip out of an
   * explorable area asks first, whichever row, person page or invite asked for it (D-27).
   */
  async function travel(mapId: number) {
    const reason = refusal(mapId);
    if (reason) throw new Error(reason);
    const trip = () => host.travel({ mapId });
    if (explorable()) await leaveArea(travelDestination(mapId)?.name ?? guildWarsMapName(mapId), trip);
    else await trip();
  }
  const source: HubSource = {
    feature: 'travelPalette',
    context() {
      const state = host.state.value;
      if (state.status !== 'ready') return state.reason === 'loading' ? 'Map loading' : null;
      if (state.guildHall) return 'Guild Hall';
      // An explorable area by its name when the game names it; a PvP outpost says so.
      if (state.explorable) { const name = guildWarsMapName(state.mapId); return name.startsWith('Unknown map') ? 'Explorable area' : `${name} · Explorable area`; }
      const outpost = travelDestination(state.mapId)?.name ?? null;
      return outpost && isPvpTravelDestination(state.mapId) ? `${outpost} · PvP` : outpost;
    },
    lifecycle() {
      const state = host.state.value;
      if (state.status !== 'ready') return state.reason === 'loading' ? 'Map loading — Travel returns when the map has loaded' : 'Waiting for Guild Wars — Travel returns in game';
      return explorable() ? 'Explorable area — Travel leaves this area' : null;
    },
    lookup(id) { const place = travelDestination(Number(id.replace('place:', ''))); return place ? source.search(place.name).find(row => row.id === id) : undefined; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) { if (next && !visible) void load(); visible = next; },
    search(query) {
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'travel') return [];
      query = parsed.term;
      const tools: HubRow[] = [{ id: 'travel', title: 'Travel', detail: loadError || 'Outposts, favourites, recent places and Guild Hall', group: 'Tools', keywords: 'tp teleport destination', action: 'Browse travel', navigate: open, run: open }];
      // Home ranks every matching place by the shared tier (its catalogue aliases and the
      // player's Travel phrases count as names) before it keeps the best eight (HUB-010, HUB-057).
      const aliasesOf = (destination: TravelDestination) => [...destination.aliases, ...preferences.synonyms.value.filter(entry => entry.mapId === destination.mapId).map(entry => entry.term)];
      const matches = query.trim() ? TRAVEL_DESTINATIONS.flatMap(destination => {
        const tier = hubTier({ title: destination.name, aliases: aliasesOf(destination) }, query);
        return tier === null ? [] : [{ destination, tier }];
      }).sort((a, b) => a.tier - b.tier || a.destination.name.localeCompare(b.destination.name)) : [];
      const destinations = query.trim() ? matches.slice(0, PLACES_SHOWN).map(match => match.destination)
        : host.history.value.filter(id => !refusal(id)).slice(0, 3).flatMap(id => { const destination = travelDestination(id); return destination ? [destination] : []; });
      const state = host.state.value;
      const inHall = state.status === 'ready' && state.guildHall;
      const guildHall: HubRow[] = query.trim() && hubTier({ title: 'Guild Hall', aliases: ['gh'] }, query) !== null ? [{
        id: 'place:guild-hall', title: inHall ? 'Leave Guild Hall' : 'Guild Hall', detail: inHall ? 'Return to the outpost you came from' : 'Your guild’s hall',
        group: 'Places', action: inHall ? 'Leave Guild Hall' : 'Travel to Guild Hall', consequential: true, leavesArea: explorable(),
        ...(host.guildHallUnavailable ? { unavailable: host.guildHallUnavailable } : {}), run: async (task: HubTask) => { await host.guildHall(); task.done(); },
      }] : [];
      // The rest stay one step away, in Travel with the same search.
      const more: HubRow[] = matches.length > PLACES_SHOWN ? [{ id: 'places:more', title: `All ${matches.length} places`, detail: 'Open Travel with this search', group: 'Places', action: 'Show in Travel',
        navigate: () => hub.showView('Travel', page(parsed.text), available, 'travel'), run: () => hub.showView('Travel', page(parsed.text), available, 'travel') }] : [];
      return [...guildHall, ...destinations.map(destination => {
        const reason = refusal(destination.mapId);
        // The aliases travel with the row, so Home ranks it by them as this list did.
        return { id: `place:${destination.mapId}`, title: destination.name, aliases: aliasesOf(destination),
          detail: query.trim() ? 'Outpost · Any district' : 'Recently visited · Any district',
          group: query.trim() ? 'Places' : 'Continue', action: `Travel to ${destination.name}`, consequential: true, leavesArea: explorable(),
          ...(reason ? { unavailable: reason } : {}), run: async (task: HubTask) => { await travel(destination.mapId); task.done(); } };
      }), ...more, ...matchHubRows(tools, query)];
    },
  };
  /**
   * The Travel row stays through a map load, character select or PvP and says why it waits, so a
   * fresh Home never starts on it and Enter never runs a dead row (HUB-135).
   */
  const withReason = (row: HubRow): HubRow => row.id === 'travel' && host.unavailable ? { ...row, unavailable: host.unavailable } : row;
  return { source: { ...source, search: (query: string) => source.search(query).map(withReason) }, open, page, travel, get active() { return active; },
    update: host.updateGameState, updateFriends: host.updateFriends,
    dispose() { disposed = true; stop(); stopNotice(); listeners.clear(); host.dispose(); },
  };
}
