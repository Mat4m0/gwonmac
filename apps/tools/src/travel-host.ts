/**
 * Host boundary for Quick Travel. The Vue palette owns presentation; this
 * module owns one named game command. Main owns every
 * durable preference write and stale-window refusal.
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
  type TravelRequest,
  type TravelUserPreferences,
  type TravelUserPreferencesPatch,
} from "../../../src/shared/travel";
import {
  EMPTY_TRAVEL_HISTORY,
  recordVisitedTravel,
  type TravelCharacterKey,
  type TravelHistory,
} from "../../../src/shared/travel-history";

export type TravelAttempt =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "queued" | "loading"; mapId: number }>;
export type TravelNotice = Readonly<{
  message: string;
  level: "info" | "success" | "warning" | "danger";
}>;

export type TravelPreferences = TravelUserPreferences;
export type TravelPreferencePatch = TravelUserPreferencesPatch;

export interface TravelHost {
  readonly state: Ref<TravelGameState>;
  readonly attempt: Ref<TravelAttempt>;
  readonly notice: Ref<TravelNotice | null>;
  readonly history: Ref<TravelHistory>;
  readonly unavailable: string | null;
  loadPreferences(): Promise<TravelPreferences>;
  savePreferences(patch: TravelPreferencePatch): Promise<TravelPreferences>;
  loadHistory(): Promise<TravelHistory>;
  travel(request: TravelRequest): Promise<void>;
  updateGameState(state: TravelGameState): void;
  dispose(): void;
  traceSearch(query: string, resultMapIds: readonly number[]): void;
}

export function createNativeTravelHost(
  api: GwNativeApi,
  command: TravelCommand,
  development = false,
): TravelHost {
  const state = ref<TravelGameState>({ status: "waiting", reason: "game" });
  const attempt = ref<TravelAttempt>({ status: "idle" });
  const notice = ref<TravelNotice | null>(null);
  const history = ref<TravelHistory>(EMPTY_TRAVEL_HISTORY);
  let attemptTimer = 0;
  const clearAttempt = () => {
    window.clearTimeout(attemptTimer);
    attemptTimer = 0;
    attempt.value = { status: "idle" };
  };
  let currentPreferences: TravelPreferences | null = null;
  const remember = (next: TravelPreferences): TravelPreferences => {
    currentPreferences = next;
    return next;
  };
  const loadPreferences = async (): Promise<TravelPreferences> =>
    remember(await api.travelPreferences.get());
  let historyTail: Promise<void> = Promise.resolve();
  let activeCharacter: TravelCharacterKey | null = null;
  let lastObservedMapId: number | null = null;
  let disposed = false;
  const enqueueHistory = (
    characterKey: TravelCharacterKey,
    operation: () => Promise<TravelHistory>,
  ): Promise<TravelHistory> => {
    const result = historyTail.then(operation);
    historyTail = result.then(() => undefined, () => undefined);
    return result.then((next) => {
      if (!disposed && activeCharacter === characterKey) history.value = next;
      return next;
    });
  };
  const loadHistory = (): Promise<TravelHistory> => {
    const characterKey = activeCharacter;
    return characterKey === null
      ? Promise.resolve(EMPTY_TRAVEL_HISTORY)
      : enqueueHistory(characterKey, () => api.travelHistory.get({ characterKey }));
  };
  const observeMap = (next: TravelGameState): void => {
    if (next.status !== "ready" || typeof next.characterKey !== "string") return;
    const key = next.characterKey as TravelCharacterKey;
    const characterChanged = key !== activeCharacter;
    if (characterChanged) {
      activeCharacter = key;
      lastObservedMapId = null;
      history.value = EMPTY_TRAVEL_HISTORY;
      void enqueueHistory(key, () => api.travelHistory.get({ characterKey: key }));
    }
    if (next.mapId === lastObservedMapId) return;
    lastObservedMapId = next.mapId;
    if (travelDestination(next.mapId) === null) return;
    void enqueueHistory(key, () => api.travelHistory.record({
      characterKey: key,
      mapId: next.mapId,
    })).catch((error) => {
      if (development) console.debug(`[tools:dev] travel.history.refused ${JSON.stringify({
        mapId: next.mapId,
        reason: error instanceof Error ? error.message : "unknown history error",
      })}`);
    });
  };
  return {
    state,
    attempt,
    notice,
    history,
    get unavailable() {
      return command.unavailable();
    },
    loadPreferences,
    async savePreferences(patch) {
      const expected = currentPreferences ?? await loadPreferences();
      return remember(await api.travelPreferences.set({ expected, patch }));
    },
    loadHistory,
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
      observeMap(next);
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
    },
    dispose() {
      disposed = true;
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
  const unlockedMapWords = Object.freeze(Array.from({ length: 28 }, () => 0xffff_ffff));
  const state = ref<TravelGameState>({
    status: "ready", mapId: 55, characterKey: "0123456789abcdef", unlockedMapWords,
  });
  const attempt = ref<TravelAttempt>({ status: "idle" });
  const notice = ref<TravelNotice | null>(null);
  const history = ref<TravelHistory>(Object.freeze([55, 449, 194, 642, 857]));
  let current: TravelPreferences = Object.freeze({
    shortcuts: DEFAULT_TRAVEL_SHORTCUTS,
    synonyms: Object.freeze([]),
  });
  const save = (patch: TravelPreferencePatch): TravelPreferences => {
    current = Object.freeze({
      shortcuts: patch.shortcuts ?? current.shortcuts,
      synonyms: patch.synonyms ?? current.synonyms,
    });
    return current;
  };
  return {
    state,
    attempt,
    notice,
    history,
    unavailable: null,
    async loadPreferences() {
      return current;
    },
    async savePreferences(patch) {
      return save(patch);
    },
    async loadHistory() { return history.value; },
    async travel(request) {
      attempt.value = { status: "queued", mapId: request.mapId };
      state.value = { status: "waiting", reason: "loading" };
      attempt.value = { status: "loading", mapId: request.mapId };
      window.setTimeout(() => {
        history.value = recordVisitedTravel(history.value, request.mapId);
        state.value = {
          status: "ready", mapId: request.mapId,
          characterKey: "0123456789abcdef", unlockedMapWords,
        };
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
