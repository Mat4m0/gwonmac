import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type GwNativeApi,
} from "../../../src/shared/contracts";
import {
  recordRecentTravel,
} from "../../../src/shared/travel-preferences";
import type { TravelCommand } from "../../../src/shared/travel-command";
import { DEFAULT_TRAVEL_SHORTCUTS, replaceTravelShortcut } from "../../../src/shared/travel";
import {
  createNativeTravelHost,
  type TravelHost,
  type TravelPreferences,
} from "./travel-host";

function fixture(recentLimit: 0 | 3 | 5 | 10 = 5, refuseRecord = false) {
  let travel: TravelPreferences = Object.freeze({
    shortcuts: DEFAULT_TRAVEL_SHORTCUTS,
    synonyms: Object.freeze([]),
    recentLimit,
    recentMapIds: recentLimit === 0 ? Object.freeze([]) : Object.freeze([55]),
  });
  const save = (patch: Parameters<TravelHost["savePreferences"]>[0]) => {
    const nextLimit = patch.recentLimit ?? travel.recentLimit;
    travel = Object.freeze({
      shortcuts: patch.shortcuts ?? travel.shortcuts,
      synonyms: patch.synonyms ?? travel.synonyms,
      recentLimit: nextLimit,
      recentMapIds: nextLimit === 0
        ? Object.freeze([])
        : patch.recentMapIds ?? travel.recentMapIds,
    });
    return travel;
  };
  const setTravel = vi.fn(async ({ expected, patch }: Parameters<
    GwNativeApi["travelPreferences"]["set"]
  >[0]) => {
    expect(expected).toEqual(travel);
    return save(patch);
  });
  const recordConfirmed = vi.fn(async (mapId: number) => {
    if (refuseRecord) throw new Error("injected unconfirmed Recent write");
    if (travel.recentLimit !== 0) {
      travel = save({
        recentMapIds: recordRecentTravel(travel.recentMapIds, mapId),
      });
    }
    return travel;
  });
  const api = {
    travelPreferences: {
      async get() { return travel; },
      set: setTravel,
      recordConfirmed,
    },
  } as unknown as GwNativeApi;
  const command: TravelCommand = { travel: vi.fn(), unavailable: () => null };
  return { host: createNativeTravelHost(api, command), setTravel, recordConfirmed };
}

afterEach(() => vi.useRealTimers());

describe("native Travel host", () => {
  it("delegates shortcut and Recent mutations to Main", async () => {
    const { host, setTravel, recordConfirmed } = fixture();
    await host.loadPreferences();
    const edited = replaceTravelShortcut(DEFAULT_TRAVEL_SHORTCUTS, 8, { mapId: 642 });

    await host.savePreferences({ shortcuts: edited });
    await host.recordConfirmedTravel(449);

    expect(setTravel.mock.calls[0]?.[0].patch.shortcuts?.[8]).toEqual({ mapId: 642 });
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

  it("does not claim Recent stayed unchanged when Main cannot confirm it", async () => {
    vi.useFakeTimers();
    const { host } = fixture(5, true);

    await host.travel({ mapId: 449 });
    host.updateGameState({ status: "waiting", reason: "loading" });
    host.updateGameState({ status: "ready", mapId: 449 });
    await vi.runAllTimersAsync();

    expect(host.notice.value?.message).toContain("could not confirm whether Recent was updated");
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
