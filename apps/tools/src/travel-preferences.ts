/** Reactive owner for Travel preference loading, validation, and mutations. */
import { computed, ref } from "vue";
import {
  EMPTY_TRAVEL_SHORTCUTS,
  TRAVEL_SYNONYM_LIMIT,
  isTravelSynonyms,
  replaceTravelShortcut,
  searchTravelDestinations,
  type TravelDestination,
  type TravelShortcuts,
  type TravelSynonyms,
} from "../../../src/shared/travel";
import { hubPhraseReserved } from "../../../src/shared/hub-preferences";
import { normaliseHubQuery } from "../../../src/shared/hub";
import type { TravelHost, TravelPreferences } from "./travel-host";

export function useTravelPreferences(host: TravelHost) {
  const shortcuts = ref<TravelShortcuts>(EMPTY_TRAVEL_SHORTCUTS);
  const synonyms = ref<TravelSynonyms>([]);
  const ready = ref(false);
  const pending = ref(false);
  const disabled = computed(() => !ready.value || pending.value);
  let loadGeneration = 0;

  const apply = (preferences: TravelPreferences): void => {
    shortcuts.value = preferences.shortcuts;
    synonyms.value = preferences.synonyms;
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
    /** Read legacy global place phrases without moving them into Travel's store. */
    searchSynonyms(query: string): TravelSynonyms {
      const term = normaliseHubQuery(query);
      const global = window.gwToolsSettings?.().hubShortcuts ?? [];
      return [...synonyms.value, ...global.flatMap(entry => {
        if (!entry.id.startsWith('place:') || !term || normaliseHubQuery(entry.phrase) !== term || hubPhraseReserved(entry.phrase)) return [];
        return [{ term: entry.phrase, mapId: Number(entry.id.slice(6)) }];
      })];
    },
    ready,
    pending,
    disabled,
    load,
    /** A destination holds one number: assigning it to another number moves it there. */
    async assignShortcut(slot: number, destination: TravelDestination) {
      const moved = shortcuts.value.findIndex((entry, index) => index !== slot && entry?.mapId === destination.mapId);
      const freed = moved < 0 ? shortcuts.value : replaceTravelShortcut(shortcuts.value, moved, null);
      return save({
        shortcuts: replaceTravelShortcut(freed, slot, { mapId: destination.mapId }),
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
  });
}
