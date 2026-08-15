/**
 * Host boundary for the focused Travel palette. Search and shortcuts remain
 * in the Vue bundle; the renderer supplies only settings, state, and one named
 * command.
 */
import { ref, type Ref } from "vue";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type { TravelCommand } from "../../../src/shared/travel-command";
import {
  DEFAULT_TRAVEL_SHORTCUTS,
  type TravelRequest,
  type TravelShortcuts,
} from "../../../src/shared/travel";

export type TravelState = Readonly<{
  status: "waiting" | "ready";
  reason?: string;
  mapId?: number;
}>;

export interface TravelHost {
  readonly state: Ref<TravelState>;
  readonly unavailable: string | null;
  loadShortcuts(): Promise<TravelShortcuts>;
  saveShortcuts(shortcuts: TravelShortcuts): Promise<TravelShortcuts>;
  travel(request: TravelRequest): Promise<void>;
}

export function createNativeTravelHost(
  api: GwNativeApi,
  command: TravelCommand,
): TravelHost {
  const state = ref<TravelState>({ status: "waiting", reason: "game" });
  return {
    state,
    get unavailable() {
      return command.unavailable();
    },
    async loadShortcuts() {
      return (await api.settings.get()).travelShortcuts;
    },
    async saveShortcuts(shortcuts) {
      return (await api.settings.set({ travelShortcuts: shortcuts })).travelShortcuts;
    },
    async travel(request) {
      command.travel(request);
    },
  };
}

/** Standalone fixture host for visual and interaction development. */
export function createDemoTravelHost(): TravelHost {
  const state = ref<TravelState>({ status: "ready", mapId: 55 });
  let shortcuts: TravelShortcuts = DEFAULT_TRAVEL_SHORTCUTS;
  return {
    state,
    unavailable: null,
    async loadShortcuts() {
      return shortcuts;
    },
    async saveShortcuts(next) {
      shortcuts = Object.freeze(next.map((entry) =>
        entry === null ? null : Object.freeze({ ...entry })
      ));
      return shortcuts;
    },
    async travel(request) {
      state.value = { status: "waiting", reason: "loading" };
      window.setTimeout(() => {
        state.value = { status: "ready", mapId: request.mapId };
      }, 600);
    },
  };
}
