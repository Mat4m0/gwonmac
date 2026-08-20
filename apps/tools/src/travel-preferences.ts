/** Reactive owner for Travel preference loading, validation, and mutations. */
import { computed, ref } from "vue";
import {
  EMPTY_TRAVEL_SHORTCUTS,
  TRAVEL_SYNONYM_LIMIT,
  isTravelSynonyms,
  replaceTravelShortcut,
  searchTravelDestinations,
  type TravelDestination,
  type TravelRecentLimit,
  type TravelShortcuts,
  type TravelSynonyms,
} from "../../../src/shared/travel";
import type { TravelHost, TravelPreferences } from "./travel-host";

export function useTravelPreferences(host: TravelHost) {
  const shortcuts = ref<TravelShortcuts>(EMPTY_TRAVEL_SHORTCUTS);
  const synonyms = ref<TravelSynonyms>([]);
  const recentLimit = ref<TravelRecentLimit>(5);
  const recentMapIds = ref<readonly number[]>([]);
  const ready = ref(false);
  const pending = ref(false);
  const disabled = computed(() => !ready.value || pending.value);
  let loadGeneration = 0;

  const apply = (preferences: TravelPreferences): void => {
    shortcuts.value = preferences.shortcuts;
    synonyms.value = preferences.synonyms;
    recentLimit.value = preferences.recentLimit;
    recentMapIds.value = preferences.recentMapIds;
  };
  const load = async (): Promise<boolean> => {
    const generation = ++loadGeneration;
    ready.value = false;
    const loaded = await host.loadPreferences();
    if (generation !== loadGeneration) return false;
    apply(loaded);
    ready.value = true;
    return true;
  };
  const save = async (
    patch: Parameters<TravelHost["savePreferences"]>[0],
  ): Promise<boolean> => {
    if (disabled.value) return false;
    pending.value = true;
    try {
      apply(await host.savePreferences(patch));
      return true;
    } finally {
      pending.value = false;
    }
  };
  const saveSynonyms = async (
    next: TravelSynonyms,
    term: string,
    destination: TravelDestination,
  ) => {
    if (next.length > TRAVEL_SYNONYM_LIMIT) return "limit" as const;
    if (!isTravelSynonyms(next)) {
      return "invalid" as const;
    }
    if (searchTravelDestinations(term, next, 1)[0]?.mapId !== destination.mapId) {
      return "unverified" as const;
    }
    if (!await save({ synonyms: next })) return "busy" as const;
    const persisted = synonyms.value;
    return persisted.length === next.length && persisted.every((entry, index) =>
      entry.term === next[index]?.term && entry.mapId === next[index]?.mapId
    ) ? "saved" as const : "unverified" as const;
  };

  return Object.freeze({
    shortcuts,
    synonyms,
    recentLimit,
    recentMapIds,
    ready,
    pending,
    disabled,
    load,
    async assignShortcut(slot: number, destination: TravelDestination) {
      return save({
        shortcuts: replaceTravelShortcut(shortcuts.value, slot, { mapId: destination.mapId }),
      });
    },
    async removeShortcut(slot: number) {
      return save({ shortcuts: replaceTravelShortcut(shortcuts.value, slot, null) });
    },
    async addSynonym(term: string, destination: TravelDestination) {
      const next = [...synonyms.value, { term, mapId: destination.mapId }];
      return saveSynonyms(next, term, destination);
    },
    async updateSynonym(index: number, term: string, destination: TravelDestination) {
      if (synonyms.value[index] === undefined) return "invalid" as const;
      const next = synonyms.value.map((entry, candidate) => candidate === index
        ? { term, mapId: destination.mapId }
        : entry
      );
      return saveSynonyms(next, term, destination);
    },
    async removeSynonym(index: number) {
      return save({ synonyms: synonyms.value.filter((_, candidate) => candidate !== index) });
    },
    async setRecentLimit(limit: TravelRecentLimit) {
      return save({ recentLimit: limit, ...(limit === 0 ? { recentMapIds: [] } : {}) });
    },
    async clearRecentTrips() {
      return save({ recentMapIds: [] });
    },
  });
}
