/** The fixture lifecycle must feed every consumer the facts the game would. */
import { describe, expect, it, vi } from 'vitest';
import { createFixtureLifecycle, FIXTURE_LIFECYCLES } from './hub-fixture-lifecycle';
import { createDemoTravelHost } from './travel-host';

describe('Hub fixture lifecycle', () => {
  it('derives the play region, pre-game screen and switch context from one Travel state', () => {
    const host = createDemoTravelHost();
    const lifecycle = createFixtureLifecycle(host);
    const facts = () => {
      const region = lifecycle.region();
      return [lifecycle.phase, region.status === 'ready' ? `${region.mapId}:${region.instanceType}:${region.playRegion}` : region.reason, lifecycle.preGame(), lifecycle.context(), host.state.value.status];
    };
    try {
      expect(facts()).toEqual(['outpost', '55:0:pve', 'unknown', 'outpost', 'ready']);
      const seen = FIXTURE_LIFECYCLES.map(([phase]) => { lifecycle.set(phase); return facts(); });
      expect(seen).toEqual([
        ['outpost', '55:0:pve', 'unknown', 'outpost', 'ready'],
        ['pve-explorable', '58:1:pve', 'unknown', 'pve-explorable', 'ready'],
        ['pvp-outpost', '188:0:pvp', 'unknown', 'outpost', 'ready'],
        // A Guild Hall is an outpost (instance 0) that is no Travel destination.
        ['guild-hall', '4:0:pve', 'unknown', 'outpost', 'ready'],
        ['map-loading', 'loading', 'loading', 'loading', 'waiting'],
        ['character-select', 'game', 'character-select', 'character-select', 'waiting'],
      ]);
    } finally { lifecycle.dispose(); }
  });

  it('follows a Travel arrival and returns to the last outpost', async () => {
    vi.useFakeTimers();
    const host = createDemoTravelHost();
    const lifecycle = createFixtureLifecycle(host);
    const listener = vi.fn();
    lifecycle.subscribe(listener);
    try {
      await host.travel({ mapId: 449 });
      expect(lifecycle.phase).toBe('map-loading');
      vi.advanceTimersByTime(600);
      expect(lifecycle.phase).toBe('outpost');
      lifecycle.set('pve-explorable');
      lifecycle.set('outpost');
      const region = lifecycle.region();
      expect(region.status === 'ready' && region.mapId).toBe(449);
      expect(listener).toHaveBeenCalled();
    } finally { lifecycle.dispose(); vi.useRealTimers(); }
  });
});
