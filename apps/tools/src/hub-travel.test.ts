import { describe, expect, it, vi } from 'vitest';
import { createHubTravel } from './hub-travel';
import { TRAVEL_DESTINATIONS } from '../../../src/shared/travel';
import { travelDestinationAvailability } from '../../../src/shared/travel-command';
import { searchTravelDestinations } from '../../../src/shared/travel-search';
import { createDemoTravelHost } from './travel-host';
import { progressFixture } from './progress-fixture';
import { nextTick } from 'vue';
import type { HubViewAction } from '../../../src/shared/hub';

describe('Hub travel recents', () => {
  it('shows actionable recents and keeps unavailable places in explicit search', () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub, async (_place, leave) => leave());
    try {
      const state = host.state.value;
      if (state.status !== 'ready') throw new Error('Expected outpost fixture');
      host.state.value = { ...state, mapId: 449 };
      expect(travel.source.search('').filter(row => row.group === 'Continue')).toHaveLength(3);
      expect(travel.source.search('').some(row => row.id === 'place:449')).toBe(false);
      expect(travel.source.search('kamadan').find(row => row.id === 'place:449')?.unavailable).toBe('You are already in Kamadan, Jewel of Istan');
      host.state.value = { ...state, unlockedMapWords: Array.from({ length: 28 }, () => 0) };
      expect(travel.source.search('').filter(row => row.group === 'Continue')).toHaveLength(0);
      expect(travel.source.search('kamadan').find(row => row.id === 'place:449')?.unavailable).toBe('Not unlocked by this character');
    } finally { travel.dispose(); }
  });

  it('ranks official aliases and saved Travel phrases before limiting Home places', async () => {
    const host = createDemoTravelHost();
    await host.savePreferences({ synonyms: [{ term: 'fort', mapId: 857 }] });
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub, async (_place, leave) => leave());
    try {
      travel.source.setVisible?.(true);
      await vi.waitFor(() => expect(travel.source.search('fort')[0]?.id).toBe('place:857'));
      for (const destination of TRAVEL_DESTINATIONS) for (const alias of destination.aliases) {
        const places = travel.source.search(alias).filter(row => row.group === 'Places').map(row => row.id);
        // A place outside this character's world is left out at root, as in the Travel view (HUB-065).
        if (travelDestinationAvailability(host.state.value, destination.mapId) === 'outside-context') expect(places, alias).not.toContain(`place:${destination.mapId}`);
        else expect(places[0], alias).toBe(`place:${destination.mapId}`);
        expect(searchTravelDestinations(alias)[0]?.mapId, alias).toBe(destination.mapId);
      }
      expect(travel.source.search('ascalon city').filter(row => row.group === 'Places').map(row => row.id)).toEqual(['place:81']);
      for (const query of ['guild hall', 'gh']) expect(travel.source.search(query)[0]?.id).toBe('place:guild-hall');
      for (const [query, ids] of [['la', [55, 120, 333, 334, 559, 442]], ['toa', [138]], ['kamadan', [449]], ['eye of the north', [642]], ['kmaadan', []], ['ada', []]] as const) {
        expect(searchTravelDestinations(query).map(place => place.mapId), query).toEqual(ids);
      }
      expect(travel.source.search('kmaadan')).toEqual([]);
      expect(travel.source.search('ada')).toEqual([]);
    } finally { travel.dispose(); }
  });

  it('marks places consequential, flags leaving an explorable area and names the game state', () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub, async (_place, leave) => leave());
    try {
      const state = host.state.value;
      if (state.status !== 'ready') throw new Error('Expected outpost fixture');
      const places = () => travel.source.search('').filter(row => row.id.startsWith('place:'));
      expect(places().every(row => row.consequential && !row.leavesArea)).toBe(true);
      expect(travel.source.search('').find(row => row.id === 'travel')?.consequential).toBeUndefined();
      expect(travel.source.context?.()).toBe("Lion's Arch");
      expect(travel.source.lifecycle?.()).toBeNull();
      // The certified instance type decides, not the catalogue: a Guild Hall is no Travel
      // destination and still no explorable area.
      host.state.value = { ...state, mapId: 4, guildHall: true };
      expect(places().every(row => !row.leavesArea)).toBe(true);
      expect(travel.source.context?.()).toBe('Guild Hall');
      expect(travel.source.lifecycle?.()).toBeNull();
      host.state.value = { ...state, mapId: 4 };
      expect(travel.source.context?.()).toBeNull();
      expect(places().every(row => !row.leavesArea)).toBe(true);
      // North Kryta Province is an explorable area (instance type 1).
      host.state.value = { ...state, mapId: 58, explorable: true };
      expect(places().length).toBeGreaterThan(0);
      expect(places().every(row => row.leavesArea)).toBe(true);
      expect(travel.source.context?.()).toBe('North Kryta Province · Explorable area');
      expect(travel.source.lifecycle?.()).toBe('Explorable area — Travel leaves this area');
      host.state.value = { status: 'waiting', reason: 'loading' };
      expect(travel.source.context?.()).toBe('Map loading');
      expect(travel.source.lifecycle?.()).toBe('Map loading — Travel returns when the map has loaded');
    } finally { travel.dispose(); }
  });

  it('names a place by its Travel search phrase as exactly as by its name, so Hub refuses that phrase for another result (HUB-062)', async () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub, async (_place, leave) => leave());
    try {
      await host.savePreferences({ synonyms: [{ term: 'home', mapId: 194 }] });
      travel.source.setVisible(true);
      await vi.waitFor(() => expect(travel.source.search('home').map(row => row.id)).toContain('place:194'));
      expect(travel.source.search('home').find(row => row.id === 'place:194')?.aliases).toEqual(['kc', 'kaineng', 'home']);
    } finally { travel.dispose(); }
  });

  it('reports a trip that fails after the quiet close once, and keeps success quiet (HUB-072)', () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub, async (_place, leave) => leave());
    try {
      host.notice.value = { message: 'Travelling to Kamadan…', level: 'info' };
      host.notice.value = { message: 'Travel started.', level: 'success' };
      expect(hub.notify).not.toHaveBeenCalled();
      host.notice.value = { message: 'Travel did not start. Check that this destination is unlocked, then try again.', level: 'warning' };
      expect(hub.notify).toHaveBeenCalledOnce();
      expect(hub.notify).toHaveBeenCalledWith('Travel did not start. Check that this destination is unlocked, then try again.', 'failed');
      host.notice.value = null;
      expect(hub.notify).toHaveBeenLastCalledWith('Travel did not start. Check that this destination is unlocked, then try again.', 'cleared');
    } finally { travel.dispose(); }
  });

  it('starts a trip from a row and ends only the Hub task that asked for it', async () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub, async (_place, leave) => leave());
    try {
      const done = vi.fn();
      await travel.source.search('kamadan').find(row => row.id === 'place:449')!.run({ live: () => false, progress() {}, done });
      expect(done).toHaveBeenCalledOnce();
      expect(hub.close).not.toHaveBeenCalled();
    } finally { travel.dispose(); }
  });
});


it('root Guild Hall travel asks before leaving an explorable area', async () => {
  const host = createDemoTravelHost();
  const state = host.state.value;
  if (state.status !== 'ready') throw new Error('Expected ready fixture');
  host.state.value = {...state, mapId: 58, explorable: true};
  const leave = vi.fn(async () => {throw new DOMException('Stayed in area', 'AbortError');});
  const hub = {showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn()};
  const travel = createHubTravel(host, hub, leave);
  try {
    const row = travel.source.search('gh').find(row => row.id === 'place:guild-hall');
    expect(row).toBeDefined();
    await expect(row!.run({live: () => true, progress() {}, done() {}})).rejects.toMatchObject({name: 'AbortError'});
    expect(leave).toHaveBeenCalledOnce();
    expect(host.state.value).toMatchObject({mapId: 58, explorable: true, guildHall: false});
  } finally {travel.dispose();}
});

it('offers Progress once the reader publishes, opens a goal by its word and travels from it', async () => {
  const host = createDemoTravelHost();
  const trip = vi.spyOn(host, 'travel');
  const hub = {showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn()};
  const travel = createHubTravel(host, hub, async (_place, leave) => leave());
  const target = document.createElement('div');
  document.body.append(target);
  try {
    // A client without the certified reader never publishes, so it has no Progress row.
    expect(travel.source.search('progress').map(row => row.id)).not.toContain('progress');
    travel.updateProgress(progressFixture(55));
    expect(travel.source.search('progress').map(row => row.id)).toContain('progress');
    await travel.source.search('vq').find(row => row.id === 'progress:vanquisher')!.run({live: () => true, progress() {}, done() {}});
    const [title, mount] = hub.showView.mock.calls.at(-1)!;
    expect(title).toBe('Progress');
    let primary: HubViewAction | null = null;
    const unmount = mount(target, vi.fn(), {primary: (action: HubViewAction | null) => { primary = action; }, secondary: vi.fn(), openActions: vi.fn()});
    await nextTick();
    expect(target.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Vanquisher');
    const action = primary as HubViewAction | null;
    expect(action?.label).toMatch(/^Travel to .+ \(nearest\)$/);
    await action!.run({live: () => true, progress() {}, done() {}});
    expect(target.querySelector('.ui-status-line')?.textContent ?? '').toBe('');
    expect(trip).toHaveBeenCalledOnce();
    expect(hub.close).toHaveBeenCalledOnce();
    unmount();
  } finally { target.remove(); travel.dispose(); }
});
