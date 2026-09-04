/**
 * Host boundary for Quick Travel. The Vue palette owns presentation; this
 * module owns one named game command. Main owns every
 * durable preference write and stale-window refusal.
 */
import { ref, type Ref } from "vue";
import type { TravelFriends } from "../../../src/shared/friends";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type {
  TravelCommand,
  TravelGameState,
} from "../../../src/shared/travel-command";
import { travelContextRefusal } from "../../../src/shared/travel-command";
import {
  DEFAULT_TRAVEL_SHORTCUTS,
  TRAVEL_DESTINATIONS,
  travelDestination,
  type TravelRequest,
  type TravelUserPreferences,
  type TravelUserPreferencesPatch,
} from "../../../src/shared/travel";
import {
  recordVisitedTravel,
  travelCharacterKey,
  type TravelHistory,
} from "../../../src/shared/travel-history";
import { createTravelHistoryObservation } from "./travel-history-observation";

export type TravelAttempt =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "queued" | "loading"; kind: "map"; mapId: number }>
  | Readonly<{
      status: "queued" | "loading";
      kind: "guild-hall";
      target: "inside" | "outside";
    }>;
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
  readonly friends: Ref<TravelFriends>;
  readonly unavailable: string | null;
  readonly guildHallUnavailable: string | null;
  loadPreferences(): Promise<TravelPreferences>;
  savePreferences(patch: TravelPreferencePatch): Promise<TravelPreferences>;
  loadHistory(): Promise<TravelHistory>;
  travel(request: TravelRequest): Promise<void>;
  guildHall(): Promise<void>;
  updateGameState(state: TravelGameState): void;
  updateFriends(friends: TravelFriends): void;
  dispose(): void;
  traceSearch(query: string, resultMapIds: readonly number[]): void;
}

export function createNativeTravelHost(
  api: GwNativeApi,
  command: TravelCommand,
  development = false,
): TravelHost {
  const state = ref<TravelGameState>({ status: "waiting", reason: "game" });
  const friends = ref<TravelFriends>({ status: "waiting", reason: "unavailable" });
  const attempt = ref<TravelAttempt>({ status: "idle" });
  const notice = ref<TravelNotice | null>(null);
  const historyObservation = createTravelHistoryObservation(
    api.travelHistory,
    state,
    development,
  );
  let attemptTimer = 0;
  let unidentifiedOriginMapId: number | null = null;
  let settledAttempt: Readonly<{
    mapId: number;
    phase: "queued" | "loading";
  }> | null = null;
  const clearAttempt = () => {
    window.clearTimeout(attemptTimer);
    attemptTimer = 0;
    unidentifiedOriginMapId = null;
    attempt.value = { status: "idle" };
  };
  const settleAttempt = (mapId: number, phase: "queued" | "loading") => {
    clearAttempt();
    settledAttempt = { mapId, phase };
  };
  const beginLoading = (mapId: number) => {
    window.clearTimeout(attemptTimer);
    settledAttempt = null;
    attempt.value = { status: "loading", kind: "map", mapId };
    notice.value = { message: "Travel started.", level: "success" };
    attemptTimer = window.setTimeout(() => {
      if (attempt.value.status !== "loading"
        || attempt.value.kind !== "map"
        || attempt.value.mapId !== mapId) return;
      settleAttempt(mapId, "loading");
      notice.value = {
        message: "Guild Wars did not confirm arrival. Travel is ready to try again.",
        level: "warning",
      };
    }, 30_000);
  };
  let currentPreferences: TravelPreferences | null = null;
  const remember = (next: TravelPreferences): TravelPreferences => {
    currentPreferences = next;
    return next;
  };
  const loadPreferences = async (): Promise<TravelPreferences> =>
    remember(await api.travelPreferences.get());
  return {
    state,
    friends,
    attempt,
    notice,
    history: historyObservation.history,
    get unavailable() {
      return command.unavailable();
    },
    get guildHallUnavailable() {
      return command.guildHallUnavailable();
    },
    loadPreferences,
    async savePreferences(patch) {
      const expected = currentPreferences ?? await loadPreferences();
      return remember(await api.travelPreferences.set({ expected, patch }));
    },
    loadHistory: historyObservation.load,
    async travel(request) {
      if (attempt.value.status !== "idle") return;
      const contextRefusal = travelContextRefusal(state.value, request.mapId);
      if (contextRefusal !== null) {
        notice.value = { message: contextRefusal, level: "warning" };
        throw new Error(contextRefusal);
      }
      settledAttempt = null;
      unidentifiedOriginMapId = state.value.status === "ready"
        && state.value.characterKey === null
        ? state.value.mapId
        : null;
      attempt.value = { status: "queued", kind: "map", mapId: request.mapId };
      notice.value = {
        message: `Travelling to ${travelDestination(request.mapId)?.name ?? "destination"}…`,
        level: "info",
      };
      try {
        command.travel(request);
        attemptTimer = window.setTimeout(() => {
          if (attempt.value.status !== "queued"
            || attempt.value.kind !== "map"
            || attempt.value.mapId !== request.mapId) return;
          settleAttempt(request.mapId, "queued");
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
    async guildHall() {
      if (attempt.value.status !== "idle") return;
      const ready = state.value.status === "ready" ? state.value : null;
      if (ready === null || (!ready.guildHall && !ready.hasGuildHall)) {
        const message = ready === null
          ? "Guild Hall travel is waiting for Guild Wars."
          : "This character does not have a Guild Hall.";
        notice.value = { message, level: "warning" };
        throw new Error(message);
      }
      const target = ready.guildHall ? "outside" : "inside";
      attempt.value = { status: "queued", kind: "guild-hall", target };
      notice.value = {
        message: target === "inside" ? "Travelling to your Guild Hall…" : "Leaving Guild Hall…",
        level: "info",
      };
      try {
        command.guildHall();
        attemptTimer = window.setTimeout(() => {
          const current = attempt.value;
          if (current.status !== "queued" || current.kind !== "guild-hall") return;
          clearAttempt();
          notice.value = {
            message: "Guild Wars did not start Guild Hall travel. Try again.",
            level: "warning",
          };
        }, 3_000);
      } catch (error) {
        clearAttempt();
        notice.value = { message: "Guild Hall travel could not start.", level: "danger" };
        throw error;
      }
    },
    updateFriends(next) { friends.value = next; },
    updateGameState(next) {
      state.value = next;
      const current = attempt.value;
      if (current.status !== "idle" && current.kind === "guild-hall") {
        const arrived = next.status === "ready"
          && next.guildHall === (current.target === "inside");
        if (arrived) {
          clearAttempt();
          notice.value = null;
        } else if (next.status === "waiting" && next.reason === "loading") {
          if (current.status === "queued") {
            window.clearTimeout(attemptTimer);
            attempt.value = { ...current, status: "loading" };
            notice.value = { message: "Travel started.", level: "success" };
            attemptTimer = window.setTimeout(() => {
              const active = attempt.value;
              if (active.status === "loading" && active.kind === "guild-hall") {
                clearAttempt();
                notice.value = {
                  message: "Guild Wars did not confirm Guild Hall travel. Try again.",
                  level: "warning",
                };
              }
            }, 30_000);
          }
        } else if (current.status === "loading" && next.status !== "ready") {
          clearAttempt();
          notice.value = { message: "Guild Hall travel was interrupted.", level: "warning" };
        }
        return;
      }
      const arrived = current.status !== "idle"
        && current.kind === "map"
        && next.status === "ready"
        && next.mapId === current.mapId;
      if (arrived
        && next.characterKey !== null
        && unidentifiedOriginMapId !== null) {
        historyObservation.record({
          characterKey: next.characterKey,
          mapId: unidentifiedOriginMapId,
        });
      }
      historyObservation.update(next);
      if (current.status === "idle") {
        const settled = settledAttempt;
        if (settled === null) return;
        if (next.status === "ready" && next.mapId === settled.mapId) {
          settledAttempt = null;
          notice.value = null;
        } else if (
          settled.phase === "queued"
          && next.status === "waiting"
          && next.reason === "loading"
        ) {
          beginLoading(settled.mapId);
        }
        return;
      }
      if (arrived) {
        clearAttempt();
        settledAttempt = null;
        notice.value = null;
        return;
      }
      if (next.status === "waiting" && next.reason === "loading") {
        if (current.status === "queued") beginLoading(current.mapId);
        return;
      }
      if (current.status !== "loading") return;
      if (next.status === "waiting") {
        settleAttempt(current.mapId, "loading");
        notice.value = {
          message: "Travel was interrupted. Travel is ready to try again.",
          level: "warning",
        };
        return;
      }
      settleAttempt(current.mapId, "loading");
      notice.value = {
        message: "Guild Wars did not confirm arrival. Travel is ready to try again.",
        level: "warning",
      };
    },
    dispose() {
      historyObservation.dispose();
      clearAttempt();
      settledAttempt = null;
      notice.value = null;
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
  const characterKey = travelCharacterKey("0123456789abcdef");
  const state = ref<TravelGameState>({
    status: "ready", mapId: 55, travelContext: "world", characterKey, unlockedMapWords,
    guildHall: false, hasGuildHall: true,
  });
  const friends = ref<TravelFriends>({ status: "waiting", reason: "unavailable" });
  const attempt = ref<TravelAttempt>({ status: "idle" });
  const notice = ref<TravelNotice | null>(null);
  const history = ref<TravelHistory>(Object.freeze([449, 194, 642, 857, 81, 248]));
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
    friends,
    attempt,
    notice,
    history,
    unavailable: null,
    guildHallUnavailable: null,
    async loadPreferences() {
      return current;
    },
    async savePreferences(patch) {
      return save(patch);
    },
    async loadHistory() { return history.value; },
    async travel(request) {
      attempt.value = { status: "queued", kind: "map", mapId: request.mapId };
      state.value = { status: "waiting", reason: "loading" };
      attempt.value = { status: "loading", kind: "map", mapId: request.mapId };
      window.setTimeout(() => {
        history.value = recordVisitedTravel(history.value, request.mapId);
        state.value = {
          status: "ready", mapId: request.mapId, travelContext: "world",
          characterKey, unlockedMapWords, guildHall: false, hasGuildHall: true,
        };
        attempt.value = { status: "idle" };
      }, 600);
    },
    async guildHall() {
      const ready = state.value.status === "ready" ? state.value : null;
      if (ready === null) return;
      const target = ready.guildHall ? "outside" : "inside";
      attempt.value = { status: "loading", kind: "guild-hall", target };
      state.value = { status: "waiting", reason: "loading" };
      window.setTimeout(() => {
        state.value = { ...ready, guildHall: target === "inside", hasGuildHall: true };
        attempt.value = { status: "idle" };
      }, 600);
    },
    updateFriends(next) { friends.value = next; },
    updateGameState(next) {
      state.value = next;
    },
    dispose() {},
    traceSearch() {},
  };
}
