/**
 * Synthetic game lifecycle for the Hub fixture. The demo Travel host's game
 * state is the one source: the play region, the pre-game screen and the
 * character-switch context derive from it the way the certified runtime
 * derives them, so Travel, Characters, invites and builds always agree. A zone
 * change first reads as the game's unavailable state for a moment, as it can live.
 */
import { watch } from 'vue';
import { isPvpTravelDestination } from '../../../src/shared/travel';
import type { TravelGameState } from '../../../src/shared/travel-command';
// eslint-disable-next-line no-restricted-imports
import { characterSwitchContext, type CharacterSwitchContext } from '../../../src/renderer/character-switch-model';
// eslint-disable-next-line no-restricted-imports
import type { CompanionPlayRegionState } from '../../../src/renderer/companion-play-region-snapshot';
import type { TravelHost } from './travel-host';

export const FIXTURE_LIFECYCLES = [
  ['outpost', 'Ready in outpost'],
  ['pve-explorable', 'PvE explorable area'],
  ['pvp-outpost', 'PvP outpost'],
  ['pvp-explorable', 'Active PvP'],
  ['guild-hall', 'Guild Hall'],
  ['map-loading', 'Map loading'],
  ['character-select', 'Character select'],
] as const;
export type FixtureLifecycle = (typeof FIXTURE_LIFECYCLES)[number][0];

/** North Kryta Province borders Lion's Arch; it is no Travel destination. */
const EXPLORABLE_MAP = 58;
/** Random Arenas is a PvP outpost. */
const PVP_OUTPOST = 188;
/** Warrior's Isle is a Guild Hall: an outpost (instance 0) that is no Travel destination. */
const GUILD_HALL_MAP = 4;
const DEFAULT_OUTPOST = 55;

export function isFixtureLifecycle(value: unknown): value is FixtureLifecycle {
  return FIXTURE_LIFECYCLES.some(([id]) => id === value);
}

/** Where a Travel game state puts the player, read from its instance type the way the runtime reads it. */
export function fixtureLifecycleOf(state: TravelGameState): FixtureLifecycle {
  if (state.status !== 'ready') return state.reason === 'loading' ? 'map-loading' : 'character-select';
  if (state.explorable) return isPvpTravelDestination(state.mapId) ? 'pvp-explorable' : 'pve-explorable';
  if (state.guildHall) return 'guild-hall';
  return isPvpTravelDestination(state.mapId) ? 'pvp-outpost' : 'outpost';
}

export function createFixtureLifecycle(host: Pick<TravelHost, 'state' | 'updateGameState'>) {
  const initial = host.state.value;
  // Character, unlocks and Guild Hall facts survive a trip to character select and back.
  let known = initial.status === 'ready' ? initial : null;
  let outpost = known && fixtureLifecycleOf(known) === 'outpost' ? known.mapId : DEFAULT_OUTPOST;
  let sequence = 1;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of [...listeners]) listener(); };
  // The live kernel can read a zone change as its unavailable game state for a moment before the map loads.
  let zoneChange = false;
  const stop = watch(host.state, (state, previous) => {
    sequence++;
    if (state.status === 'ready') {
      known = state;
      if (fixtureLifecycleOf(state) === 'outpost') outpost = state.mapId;
    }
    if (previous.status === 'ready' && state.status === 'waiting' && state.reason === 'loading') {
      zoneChange = true;
      try { publish(); } finally { zoneChange = false; }
    }
    publish();
  }, { flush: 'sync' });
  const ready = (mapId: number, place: 'outpost' | 'explorable' | 'guild-hall' = 'outpost'): TravelGameState => ({
    status: 'ready', mapId, travelContext: known?.travelContext ?? 'world', characterKey: known?.characterKey ?? null,
    unlockedMapWords: known?.unlockedMapWords ?? null, guildHall: place === 'guild-hall',
    hasGuildHall: place === 'guild-hall' || (known?.hasGuildHall ?? false), explorable: place === 'explorable',
  });
  /** The certified play-region fact: an outpost is instance 0, an explorable area instance 1. */
  const region = (): CompanionPlayRegionState => {
    const state = host.state.value;
    if (state.status !== 'ready') return { status: 'waiting', reason: state.reason === 'loading' && !zoneChange ? 'loading' : 'game' };
    return { status: 'ready', sequence, mapId: state.mapId, instanceType: state.explorable ? 1 : 0,
      playRegion: isPvpTravelDestination(state.mapId) ? 'pvp' : 'pve', travelContext: state.travelContext,
      characterKey: state.characterKey, unlockedMapWords: state.unlockedMapWords ? [...state.unlockedMapWords] : null,
      guildHall: state.guildHall, hasGuildHall: state.hasGuildHall };
  };
  const preGame = (): PreGameState => {
    const phase = fixtureLifecycleOf(host.state.value);
    return phase === 'character-select' ? 'character-select' : phase === 'map-loading' ? 'loading' : 'unknown';
  };
  return {
    get phase(): FixtureLifecycle { return fixtureLifecycleOf(host.state.value); },
    region,
    preGame,
    context: (): CharacterSwitchContext => characterSwitchContext(preGame(), region()),
    set(phase: FixtureLifecycle) {
      host.updateGameState(phase === 'map-loading' ? { status: 'waiting', reason: 'loading' }
        : phase === 'character-select' ? { status: 'waiting', reason: 'game' }
          : phase === 'pvp-explorable' ? ready(PVP_OUTPOST, 'explorable')
          : phase === 'pve-explorable' ? ready(EXPLORABLE_MAP, 'explorable') : phase === 'guild-hall' ? ready(GUILD_HALL_MAP, 'guild-hall')
            : ready(phase === 'pvp-outpost' ? PVP_OUTPOST : outpost));
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { stop(); listeners.clear(); },
  };
}
