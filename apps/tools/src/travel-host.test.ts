import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type GwNativeApi,
} from "../../../src/shared/contracts";
import type { TravelCommand } from "../../../src/shared/travel-command";
import { DEFAULT_TRAVEL_SHORTCUTS, replaceTravelShortcut } from "../../../src/shared/travel";
import {
  createNativeTravelHost,
  type TravelHost,
  type TravelPreferences,
} from "./travel-host";

function fixture() {
  let travel: TravelPreferences = Object.freeze({
    shortcuts: DEFAULT_TRAVEL_SHORTCUTS,
    synonyms: Object.freeze([]),
  });
  const save = (patch: Parameters<TravelHost["savePreferences"]>[0]) => {
    travel = Object.freeze({
      shortcuts: patch.shortcuts ?? travel.shortcuts,
      synonyms: patch.synonyms ?? travel.synonyms,
    });
    return travel;
  };
  const setTravel = vi.fn(async ({ expected, patch }: Parameters<
    GwNativeApi["travelPreferences"]["set"]
  >[0]) => {
    expect(expected).toEqual(travel);
    return save(patch);
  });
  const api = {
    travelPreferences: {
      async get() { return travel; },
      set: setTravel,
    },
  } as unknown as GwNativeApi;
  const command: TravelCommand = { travel: vi.fn(), unavailable: () => null };
  return { host: createNativeTravelHost(api, command), setTravel };
}

afterEach(() => vi.useRealTimers());

describe("native Travel host", () => {
  it("delegates shortcut mutations to Main", async () => {
    const { host, setTravel } = fixture();
    await host.loadPreferences();
    const edited = replaceTravelShortcut(DEFAULT_TRAVEL_SHORTCUTS, 8, { mapId: 642 });

    await host.savePreferences({ shortcuts: edited });
    expect(setTravel.mock.calls[0]?.[0].patch.shortcuts?.[8]).toEqual({ mapId: 642 });
  });

  it("releases a travel attempt after Guild Wars confirms arrival", async () => {
    vi.useFakeTimers();
    const { host } = fixture();

    await host.travel({ mapId: 449 });
    host.updateGameState({ status: "waiting", reason: "loading" });
    host.updateGameState({ status: "ready", mapId: 449 });
    await vi.runAllTimersAsync();

    expect(host.attempt.value).toEqual({ status: "idle" });
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
