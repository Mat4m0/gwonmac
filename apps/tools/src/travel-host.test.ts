import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type GwNativeApi,
} from "../../../src/shared/contracts";
import {
  DEFAULT_TRAVEL_PREFERENCES,
  applyTravelPreferencesPatch,
  recordRecentTravel,
  type TravelPreferencesDocument,
} from "../../../src/shared/travel-preferences";
import type { TravelCommand } from "../../../src/shared/travel-command";
import { DEFAULT_TRAVEL_SHORTCUTS, replaceTravelShortcut } from "../../../src/shared/travel";
import { createNativeTravelHost } from "./travel-host";

function fixture(recentLimit: 0 | 3 | 5 | 10 = 5) {
  let settings: AppSettings = DEFAULT_SETTINGS;
  let travel: TravelPreferencesDocument = Object.freeze({
    ...DEFAULT_TRAVEL_PREFERENCES,
    recentLimit,
    recentMapIds: recentLimit === 0 ? Object.freeze([]) : Object.freeze([55]),
  });
  const setSettings = vi.fn(async (patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  const setTravel = vi.fn(async (patch: Parameters<typeof applyTravelPreferencesPatch>[1]) => {
    travel = applyTravelPreferencesPatch(travel, patch);
    return travel;
  });
  const recordConfirmed = vi.fn(async (mapId: number) => {
    if (travel.recentLimit !== 0) {
      travel = applyTravelPreferencesPatch(travel, {
        recentMapIds: recordRecentTravel(travel.recentMapIds, mapId),
      });
    }
    return travel;
  });
  const api = {
    settings: { async get() { return settings; }, set: setSettings },
    travelPreferences: {
      async get() { return travel; },
      set: setTravel,
      recordConfirmed,
    },
  } as unknown as GwNativeApi;
  const command: TravelCommand = { travel: vi.fn(), unavailable: () => null };
  return { host: createNativeTravelHost(api, command), setSettings, recordConfirmed };
}

afterEach(() => vi.useRealTimers());

describe("native Travel host", () => {
  it("keeps shortcut storage Stable-readable and delegates recents to one atomic call", async () => {
    const { host, setSettings, recordConfirmed } = fixture();
    const edited = replaceTravelShortcut(DEFAULT_TRAVEL_SHORTCUTS, 8, { mapId: 642 });

    await host.savePreferences({ shortcuts: edited });
    await host.recordConfirmedTravel(449);

    expect(setSettings.mock.calls[0]?.[0].travelShortcuts?.[8]).toEqual({
      mapId: 642,
      district: "international",
      districtNumber: 0,
    });
    expect(recordConfirmed).toHaveBeenCalledExactlyOnceWith(449);
  });

  it("leaves Recent empty when recording is off", async () => {
    const { host, recordConfirmed } = fixture(0);
    const result = await host.recordConfirmedTravel(449);
    expect(result.recentMapIds).toEqual([]);
    expect(recordConfirmed).toHaveBeenCalledExactlyOnceWith(449);
  });

  it("records a recent destination only after Guild Wars confirms arrival", async () => {
    vi.useFakeTimers();
    const { host, recordConfirmed } = fixture();

    await host.travel({ mapId: 449 });
    host.updateGameState({ status: "waiting", reason: "loading" });
    expect(recordConfirmed).not.toHaveBeenCalled();

    host.updateGameState({ status: "ready", mapId: 449 });
    await vi.runAllTimersAsync();

    expect(host.attempt.value).toEqual({ status: "idle" });
    expect(recordConfirmed).toHaveBeenCalledExactlyOnceWith(449);
  });

  it("always releases a loading attempt after interruption or its arrival deadline", async () => {
    vi.useFakeTimers();
    const interrupted = fixture().host;
    await interrupted.travel({ mapId: 449 });
    interrupted.updateGameState({ status: "waiting", reason: "loading" });
    interrupted.updateGameState({ status: "waiting", reason: "game" });
    expect(interrupted.attempt.value).toEqual({ status: "idle" });

    const expired = fixture().host;
    await expired.travel({ mapId: 449 });
    expired.updateGameState({ status: "waiting", reason: "loading" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(expired.attempt.value).toEqual({ status: "idle" });
    expect(expired.notice.value?.message).toContain("ready to try again");
  });
});
