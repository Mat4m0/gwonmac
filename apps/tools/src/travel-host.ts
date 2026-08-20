/**
 * Host boundary for Quick Travel. The Vue palette owns presentation; this
 * module owns serialized settings writes, confirmed recents, and one named
 * game command.
 */
import { ref, type Ref } from "vue";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type {
  TravelCommand,
  TravelGameState,
} from "../../../src/shared/travel-command";
import {
  DEFAULT_TRAVEL_SHORTCUTS,
  TRAVEL_DESTINATIONS,
  travelDestination,
  recordRecentTravel,
  storeTravelShortcuts,
  travelShortcutsFromStored,
  type TravelRecentLimit,
  type TravelRecentMapIds,
  type TravelRequest,
  type TravelShortcuts,
  type TravelSynonyms,
} from "../../../src/shared/travel";

export type TravelAttempt =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "queued" | "loading"; mapId: number }>;
export type TravelNotice = Readonly<{
  message: string;
  level: "info" | "success" | "warning" | "danger";
}>;

export type TravelPreferences = Readonly<{
  shortcuts: TravelShortcuts;
  synonyms: TravelSynonyms;
  recentLimit: TravelRecentLimit;
  recentMapIds: TravelRecentMapIds;
}>;

export type TravelPreferencePatch = Readonly<{
  shortcuts?: TravelShortcuts;
  synonyms?: TravelSynonyms;
  recentLimit?: TravelRecentLimit;
  recentMapIds?: TravelRecentMapIds;
}>;

export interface TravelHost {
  readonly state: Ref<TravelGameState>;
  readonly attempt: Ref<TravelAttempt>;
  readonly notice: Ref<TravelNotice | null>;
  readonly unavailable: string | null;
  loadPreferences(): Promise<TravelPreferences>;
  savePreferences(patch: TravelPreferencePatch): Promise<TravelPreferences>;
  recordConfirmedTravel(mapId: number): Promise<TravelPreferences>;
  travel(request: TravelRequest): Promise<void>;
  updateGameState(state: TravelGameState): void;
  dispose(): void;
  traceSearch(query: string, resultMapIds: readonly number[]): void;
}

function preferences(
  settings: Awaited<ReturnType<GwNativeApi["settings"]["get"]>>,
  travel: Awaited<ReturnType<GwNativeApi["travelPreferences"]["get"]>>,
): TravelPreferences {
  return Object.freeze({
    shortcuts: travelShortcutsFromStored(settings.travelShortcuts),
    synonyms: travel.synonyms,
    recentLimit: travel.recentLimit,
    recentMapIds: travel.recentMapIds,
  });
}

export function createNativeTravelHost(
  api: GwNativeApi,
  command: TravelCommand,
  development = false,
): TravelHost {
  const state = ref<TravelGameState>({ status: "waiting", reason: "game" });
  const attempt = ref<TravelAttempt>({ status: "idle" });
  const notice = ref<TravelNotice | null>(null);
  let attemptTimer = 0;
  const clearAttempt = () => {
    window.clearTimeout(attemptTimer);
    attemptTimer = 0;
    attempt.value = { status: "idle" };
  };
  let writes: Promise<unknown> = Promise.resolve();
  const serialize = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const pending = writes.then(operation);
    writes = pending.catch(() => undefined);
    return pending;
  };
  const recordConfirmedTravel = (mapId: number): Promise<TravelPreferences> =>
    serialize(async () => preferences(
      await api.settings.get(),
      await api.travelPreferences.recordConfirmed(mapId),
    ));
  return {
    state,
    attempt,
    notice,
    get unavailable() {
      return command.unavailable();
    },
    async loadPreferences() {
      await writes;
      const [settings, travel] = await Promise.all([
        api.settings.get(),
        api.travelPreferences.get(),
      ]);
      return preferences(settings, travel);
    },
    savePreferences(patch) {
      return serialize(async () => {
        const currentSettings = await api.settings.get();
        const nextSettings = patch.shortcuts === undefined
          ? currentSettings
          : await api.settings.set({
              travelShortcuts: storeTravelShortcuts(
                patch.shortcuts,
                currentSettings.travelShortcuts,
              ),
            });
        const travelPatch = {
          ...(patch.synonyms === undefined ? {} : { synonyms: patch.synonyms }),
          ...(patch.recentLimit === undefined ? {} : { recentLimit: patch.recentLimit }),
          ...(patch.recentMapIds === undefined ? {} : { recentMapIds: patch.recentMapIds }),
        };
        const nextTravel = Object.keys(travelPatch).length === 0
          ? await api.travelPreferences.get()
          : await api.travelPreferences.set(travelPatch);
        return preferences(nextSettings, nextTravel);
      });
    },
    recordConfirmedTravel,
    async travel(request) {
      if (attempt.value.status !== "idle") return;
      attempt.value = { status: "queued", mapId: request.mapId };
      notice.value = {
        message: `Travelling to ${travelDestination(request.mapId)?.name ?? "destination"}…`,
        level: "info",
      };
      try {
        command.travel(request);
        attemptTimer = window.setTimeout(() => {
          if (attempt.value.status !== "queued" || attempt.value.mapId !== request.mapId) return;
          clearAttempt();
          notice.value = {
            message: "Travel did not start. Check that this destination is unlocked, then try again.",
            level: "warning",
          };
        }, 3_000);
        if (development) {
          console.debug(`[tools:dev] travel.queued ${JSON.stringify({ mapId: request.mapId })}`);
        }
      } catch (error) {
        clearAttempt();
        notice.value = {
          message: "Travel could not start. Check Guild Wars, then try again.",
          level: "danger",
        };
        if (development) {
          console.debug(`[tools:dev] travel.refused ${JSON.stringify({
            mapId: request.mapId,
            reason: error instanceof Error ? error.message : "unknown travel error",
          })}`);
        }
        throw error;
      }
    },
    updateGameState(next) {
      state.value = next;
      const current = attempt.value;
      if (current.status === "idle") return;
      if (next.status === "waiting" && next.reason === "loading") {
        window.clearTimeout(attemptTimer);
        attempt.value = { status: "loading", mapId: current.mapId };
        notice.value = { message: "Travel started.", level: "success" };
        attemptTimer = window.setTimeout(() => {
          if (attempt.value.status !== "loading") return;
          clearAttempt();
          notice.value = {
            message: "Guild Wars did not confirm arrival. Travel is ready to try again.",
            level: "warning",
          };
        }, 30_000);
        return;
      }
      if (current.status !== "loading") return;
      if (next.status === "waiting") {
        clearAttempt();
        notice.value = {
          message: "Travel was interrupted. Travel is ready to try again.",
          level: "warning",
        };
        return;
      }
      clearAttempt();
      if (next.mapId !== current.mapId) return;
      void recordConfirmedTravel(current.mapId).catch(() => {
        notice.value = {
          message: "Travel succeeded, but Recent could not be updated.",
          level: "warning",
        };
      });
    },
    dispose() {
      clearAttempt();
    },
    traceSearch(query, resultMapIds) {
      if (!development) return;
      const trimmed = query.trim();
      console.debug(`[tools:dev] travel.search ${JSON.stringify({
        queryLength: trimmed.length,
        tokenCount: trimmed === "" ? 0 : trimmed.split(/\s+/u).length,
        catalogueSize: TRAVEL_DESTINATIONS.length,
        resultCount: resultMapIds.length,
        resultMapIds: resultMapIds.slice(0, 12),
      })}`);
    },
  };
}

/** Standalone fixture host for visual and interaction development. */
export function createDemoTravelHost(): TravelHost {
  const state = ref<TravelGameState>({ status: "ready", mapId: 55 });
  const attempt = ref<TravelAttempt>({ status: "idle" });
  const notice = ref<TravelNotice | null>(null);
  let current: TravelPreferences = Object.freeze({
    shortcuts: DEFAULT_TRAVEL_SHORTCUTS,
    synonyms: Object.freeze([]),
    recentLimit: 5,
    recentMapIds: Object.freeze([55, 449, 194]),
  });
  const save = (patch: TravelPreferencePatch): TravelPreferences => {
    const recentLimit = patch.recentLimit ?? current.recentLimit;
    current = Object.freeze({
      shortcuts: patch.shortcuts ?? current.shortcuts,
      synonyms: patch.synonyms ?? current.synonyms,
      recentLimit,
      recentMapIds: recentLimit === 0
        ? Object.freeze([])
        : patch.recentMapIds ?? current.recentMapIds,
    });
    return current;
  };
  return {
    state,
    attempt,
    notice,
    unavailable: null,
    async loadPreferences() {
      return current;
    },
    async savePreferences(patch) {
      return save(patch);
    },
    async recordConfirmedTravel(mapId) {
      if (current.recentLimit === 0) return current;
      return save({ recentMapIds: recordRecentTravel(current.recentMapIds, mapId) });
    },
    async travel(request) {
      attempt.value = { status: "queued", mapId: request.mapId };
      state.value = { status: "waiting", reason: "loading" };
      attempt.value = { status: "loading", mapId: request.mapId };
      window.setTimeout(() => {
        state.value = { status: "ready", mapId: request.mapId };
        attempt.value = { status: "idle" };
      }, 600);
    },
    updateGameState(next) {
      state.value = next;
    },
    dispose() {},
    traceSearch() {},
  };
}
