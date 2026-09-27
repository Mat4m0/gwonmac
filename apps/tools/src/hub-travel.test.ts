import { describe, expect, it, vi } from 'vitest';
import { createHubTravel } from './hub-travel';
import { createDemoTravelHost } from './travel-host';

describe('Hub travel recents', () => {
  it('shows actionable recents and keeps unavailable places in explicit search', () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub);
    try {
      const state = host.state.value;
      if (state.status !== 'ready') throw new Error('Expected outpost fixture');
      host.state.value = { ...state, mapId: 449 };
      expect(travel.source.search('').filter(row => row.group === 'Continue')).toHaveLength(3);
      expect(travel.source.search('').some(row => row.id === 'place:449')).toBe(false);
      expect(travel.source.search('kamadan').find(row => row.id === 'place:449')?.unavailable).toBe('Current location');
      host.state.value = { ...state, unlockedMapWords: Array.from({ length: 28 }, () => 0) };
      expect(travel.source.search('').filter(row => row.group === 'Continue')).toHaveLength(0);
      expect(travel.source.search('kamadan').find(row => row.id === 'place:449')?.unavailable).toBe('Not unlocked by this character');
    } finally { travel.dispose(); }
  });

  it('marks places consequential, flags leaving an explorable area and names the game state', () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub);
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
      expect(travel.source.context?.()).toBe('Explorable area');
      expect(travel.source.lifecycle?.()).toBe('Explorable area — Travel leaves this area');
      host.state.value = { status: 'waiting', reason: 'loading' };
      expect(travel.source.context?.()).toBe('Map loading');
      expect(travel.source.lifecycle?.()).toBe('Map loading — Travel returns when the map has loaded');
    } finally { travel.dispose(); }
  });

  it('starts a trip from a row and ends only the Hub task that asked for it', async () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn(), notify: vi.fn() };
    const travel = createHubTravel(host, hub);
    try {
      const done = vi.fn();
      await travel.source.search('kamadan').find(row => row.id === 'place:449')!.run({ live: () => false, progress() {}, done });
      expect(done).toHaveBeenCalledOnce();
      expect(hub.close).not.toHaveBeenCalled();
    } finally { travel.dispose(); }
  });
});
