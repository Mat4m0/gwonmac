import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRAVEL_SHORTCUTS,
  recordRecentTravel,
  type TravelRecentLimit,
  type TravelShortcuts,
  type TravelSynonyms,
} from "../../../../src/shared/travel";
import type {
  TravelHost,
  TravelPreferencePatch,
  TravelPreferences,
} from "../travel-host";
import TravelPalette from "./TravelPalette.vue";

function fixture(options: Readonly<{
  shortcuts?: TravelShortcuts;
  synonyms?: TravelSynonyms;
  recentLimit?: TravelRecentLimit;
  recentMapIds?: readonly number[];
}> = {}) {
  const state = ref<TravelHost["state"]["value"]>({ status: "ready", mapId: 55 });
  let preferences: TravelPreferences = Object.freeze({
    shortcuts: options.shortcuts ?? DEFAULT_TRAVEL_SHORTCUTS,
    synonyms: options.synonyms ?? Object.freeze([]),
    recentLimit: options.recentLimit ?? 5,
    recentMapIds: options.recentMapIds ?? Object.freeze([55, 449, 194, 642, 81]),
  });
  const attempt = ref<TravelHost["attempt"]["value"]>({ status: "idle" });
  const notice = ref<TravelHost["notice"]["value"]>(null);
  const travel = vi.fn<TravelHost["travel"]>(async (request) => {
    attempt.value = { status: "queued", mapId: request.mapId };
  });
  const savePreferences = vi.fn<TravelHost["savePreferences"]>(async (
    patch: TravelPreferencePatch,
  ) => {
    const recentLimit = patch.recentLimit ?? preferences.recentLimit;
    preferences = Object.freeze({
      shortcuts: patch.shortcuts ?? preferences.shortcuts,
      synonyms: patch.synonyms ?? preferences.synonyms,
      recentLimit,
      recentMapIds: recentLimit === 0
        ? Object.freeze([])
        : patch.recentMapIds ?? preferences.recentMapIds,
    });
    return preferences;
  });
  const recordConfirmedTravel = vi.fn<TravelHost["recordConfirmedTravel"]>(async (mapId) => {
    if (preferences.recentLimit !== 0) {
      preferences = Object.freeze({
        ...preferences,
        recentMapIds: recordRecentTravel(preferences.recentMapIds, mapId),
      });
    }
    return preferences;
  });
  const traceSearch = vi.fn<TravelHost["traceSearch"]>();
  const host: TravelHost = {
    state,
    attempt,
    notice,
    unavailable: null,
    async loadPreferences() { return preferences; },
    savePreferences,
    recordConfirmedTravel,
    travel,
    updateGameState(next) {
      state.value = next;
      const current = attempt.value;
      if (current.status === "idle") return;
      if (next.status === "waiting" && next.reason === "loading") {
        attempt.value = { status: "loading", mapId: current.mapId };
      } else if (current.status === "loading" && next.status === "ready") {
        attempt.value = { status: "idle" };
        if (next.mapId === current.mapId) void recordConfirmedTravel(current.mapId);
      }
    },
    dispose() {},
    traceSearch,
  };
  const wrapper = mount(TravelPalette, { props: { host, visible: true } });
  return {
    wrapper,
    host,
    state,
    travel,
    savePreferences,
    recordConfirmedTravel,
    traceSearch,
  };
}

describe("TravelPalette", () => {
  it("shows the configured Recent rows and a complete 3×3 shortcut grid", async () => {
    const { wrapper } = fixture({ recentLimit: 3 });
    await flushPromises();

    expect(wrapper.findAll(".travel-recents .ui-row")).toHaveLength(3);
    expect(wrapper.findAll(".travel-shortcut-tile")).toHaveLength(9);
    expect(wrapper.text()).toContain("Lion's Arch");
    expect(wrapper.text()).toContain("Start typing to search all 199 direct-travel destinations");
    expect(wrapper.get('label[for="travel-search-input"]').text()).toBe("Search destinations");
    expect(wrapper.get('[aria-label="Close Travel"]').element.closest("label")).toBeNull();
    wrapper.unmount();
  });

  it("hides Recent when recording is off", async () => {
    const { wrapper } = fixture({ recentLimit: 0, recentMapIds: [] });
    await flushPromises();

    expect(wrapper.find(".travel-recents").exists()).toBe(false);
    expect(wrapper.findAll(".travel-shortcut-tile")).toHaveLength(9);
    wrapper.unmount();
  });

  it("autocompletes official and custom synonyms", async () => {
    const { wrapper } = fixture({ synonyms: [{ term: "daily run", mapId: 449 }] });
    await flushPromises();

    await wrapper.get('[role="combobox"]').setValue("daily run");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("Kamadan, Jewel of Istan");
    wrapper.unmount();
  });

  it("reports bounded search evidence when the catalogue has no match", async () => {
    const { wrapper, traceSearch } = fixture();
    await flushPromises();

    await wrapper.get('[role="combobox"]').setValue("zzzz-no-such-outpost");

    expect(traceSearch).toHaveBeenLastCalledWith("zzzz-no-such-outpost", []);
    expect(wrapper.text()).toContain("No matching destination");
    wrapper.unmount();
  });

  it("uses bare number keys for Quick Travel", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();

    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "1", code: "Digit1" });

    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
    wrapper.unmount();
  });

  it("assigns and removes any shortcut without producing sparse settings", async () => {
    const { wrapper, savePreferences } = fixture();
    await flushPromises();
    await wrapper.get('[role="combobox"]').setValue("eotn");

    await wrapper.get(".travel-palette").trigger("keydown", {
      key: "9",
      code: "Digit9",
      metaKey: true,
    });
    await flushPromises();

    const saved = savePreferences.mock.calls[0]?.[0].shortcuts;
    expect(saved).toHaveLength(9);
    expect(saved?.slice(6, 8)).toEqual([null, null]);
    expect(saved?.[8]).toEqual({ mapId: 642 });
    expect(wrapper.text()).toContain("Eye of the North is now shortcut 9");

    await wrapper.get('[role="combobox"]').setValue("");
    await wrapper.get(".travel-shortcuts header .ui-button").trigger("click");
    await wrapper.get('[aria-label="Remove shortcut 9"]').trigger("click");
    await flushPromises();
    expect(savePreferences.mock.calls[1]?.[0].shortcuts?.[8]).toBeNull();
    wrapper.unmount();
  });

  it("records a recent destination only after loading and the exact ready map", async () => {
    const { wrapper, host, recordConfirmedTravel } = fixture();
    await flushPromises();
    await wrapper.get('[role="combobox"]').setValue("kama");
    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(recordConfirmedTravel).not.toHaveBeenCalled();

    host.updateGameState({ status: "waiting", reason: "loading" });
    await flushPromises();
    expect(recordConfirmedTravel).not.toHaveBeenCalled();

    host.updateGameState({ status: "ready", mapId: 449 });
    await flushPromises();
    expect(recordConfirmedTravel).toHaveBeenCalledOnce();
    expect(recordConfirmedTravel).toHaveBeenCalledWith(449);
    wrapper.unmount();
  });

  it("does not record a rejected or mismatched trip", async () => {
    const rejected = fixture();
    await flushPromises();
    rejected.travel.mockImplementationOnce(async () => {
      rejected.host.notice.value = {
        message: "Travel could not start. Check Guild Wars, then try again.",
        level: "danger",
      };
      throw new Error("private host detail");
    });
    await rejected.wrapper.get('[role="combobox"]').setValue("kama");
    await rejected.wrapper.get('[role="combobox"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(rejected.recordConfirmedTravel).not.toHaveBeenCalled();
    expect(rejected.wrapper.text()).toContain(
      "Travel could not start. Check Guild Wars, then try again.",
    );
    rejected.wrapper.unmount();

    const mismatched = fixture();
    await flushPromises();
    await mismatched.wrapper.get('[role="combobox"]').setValue("kama");
    await mismatched.wrapper.get('[role="combobox"]').trigger("keydown", { key: "Enter" });
    mismatched.host.updateGameState({ status: "waiting", reason: "loading" });
    await flushPromises();
    mismatched.host.updateGameState({ status: "ready", mapId: 55 });
    await flushPromises();
    expect(mismatched.recordConfirmedTravel).not.toHaveBeenCalled();
    mismatched.wrapper.unmount();
  });

  it("preserves the previous shortcut and explains a failed save", async () => {
    const { wrapper, travel, savePreferences } = fixture();
    await flushPromises();
    savePreferences.mockRejectedValueOnce(new Error("private persistence detail"));
    await wrapper.get('[role="combobox"]').setValue("eotn");

    await wrapper.get(".travel-palette").trigger("keydown", {
      key: "1",
      code: "Digit1",
      metaKey: true,
    });
    await flushPromises();
    expect(wrapper.text()).toContain(
      "Shortcut could not be saved. Your previous shortcut is still active.",
    );
    expect(wrapper.text()).not.toContain("private persistence detail");

    await wrapper.get('[role="combobox"]').setValue("");
    await wrapper.get(".travel-palette").trigger("keydown", { key: "1", code: "Digit1" });
    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
    wrapper.unmount();
  });
});
