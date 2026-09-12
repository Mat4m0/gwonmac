import { describe, expect, it, vi } from 'vitest';
import { createHubTravel } from './hub-travel';
import { createDemoTravelHost } from './travel-host';

describe('Hub travel recents', () => {
  it('shows actionable recents and keeps unavailable places in explicit search', () => {
    const host = createDemoTravelHost();
    const hub = { showView: vi.fn(), showRows: vi.fn(), attach: vi.fn(), close: vi.fn() };
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
});
