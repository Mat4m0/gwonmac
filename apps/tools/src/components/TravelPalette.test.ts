import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRAVEL_SHORTCUTS,
  type TravelShortcuts,
  type TravelSynonyms,
} from "../../../../src/shared/travel";
import type { TravelFriends } from "../../../../src/shared/friends";
import type {
  TravelHost,
  TravelPreferencePatch,
  TravelPreferences,
} from "../travel-host";
import TravelDestinationPicker from "./TravelDestinationPicker.vue";
import TravelPalette from "./TravelPalette.vue";
import {
  EMPTY_TRAVEL_HISTORY,
  travelCharacterKey,
} from "../../../../src/shared/travel-history";

function fixture(options: Readonly<{
  shortcuts?: TravelShortcuts;
  synonyms?: TravelSynonyms;
  history?: readonly number[];
  friends?: TravelFriends;
}> = {}, attachTo?: Element) {
  const state = ref<TravelHost["state"]["value"]>({
    status: "ready", mapId: 55, travelContext: "world", characterKey: null, unlockedMapWords: null,
  });
  let preferences: TravelPreferences = Object.freeze({
    shortcuts: options.shortcuts ?? DEFAULT_TRAVEL_SHORTCUTS,
    synonyms: options.synonyms ?? Object.freeze([]),
  });
  const friends = ref<TravelFriends>(options.friends ?? { status: "waiting", reason: "unavailable" });
  const attempt = ref<TravelHost["attempt"]["value"]>({ status: "idle" });
  const notice = ref<TravelHost["notice"]["value"]>(null);
  const history = ref(options.history ?? EMPTY_TRAVEL_HISTORY);
  const travel = vi.fn<TravelHost["travel"]>(async (request) => {
    attempt.value = { status: "queued", mapId: request.mapId };
  });
  const savePreferences = vi.fn<TravelHost["savePreferences"]>(async (
    patch: TravelPreferencePatch,
  ) => {
    preferences = Object.freeze({
      shortcuts: patch.shortcuts ?? preferences.shortcuts,
      synonyms: patch.synonyms ?? preferences.synonyms,
    });
    return preferences;
  });
  const traceSearch = vi.fn<TravelHost["traceSearch"]>();
  const host: TravelHost = {
    state,
    friends,
    attempt,
    notice,
    history,
    unavailable: null,
    async loadPreferences() { return preferences; },
    savePreferences,
    async loadHistory() { return history.value; },
    travel,
    updateFriends(next) { friends.value = next; },
    updateGameState(next) {
      state.value = next;
      const current = attempt.value;
      if (current.status === "idle") return;
      if (next.status === "waiting" && next.reason === "loading") {
        attempt.value = { status: "loading", mapId: current.mapId };
      } else if (current.status === "loading" && next.status === "ready") {
        attempt.value = { status: "idle" };
      }
    },
    dispose() {},
    traceSearch,
  };
  const wrapper = mount(TravelPalette, {
    props: { host, visible: true },
    ...(attachTo === undefined ? {} : { attachTo }),
  });
  return {
    wrapper,
    host,
    notice,
    state,
    travel,
    savePreferences,
    traceSearch,
  };
}

describe("TravelPalette", () => {
  it("opens in Travel with compact assigned favorites", async () => {
    const { wrapper } = fixture();
    await flushPromises();

    expect(wrapper.findAll(".travel-favorite")).toHaveLength(6);
    expect(wrapper.text()).toContain("Lion's Arch");
    expect(wrapper.findAll(".travel-favorite").map((favorite) => favorite.text())).toEqual([
      "1Ascalon",
      "2Lion's Arch",
      "3Kamadan",
      "4Kaineng",
      "5Eye",
      "6Embark",
    ]);
    expect(wrapper.text()).not.toContain("Travel is the default");
    expect(wrapper.find('label[for="travel-search-input"] > span').exists()).toBe(false);
    expect(wrapper.get("#travel-search-input").attributes("aria-label")).toBe(
      "Destination, phrase, or friend",
    );
    expect(wrapper.get("#travel-search-input").attributes("placeholder")).toBe(
      "Search destinations or friends…",
    );
    expect(wrapper.get('[aria-label="Close Quick Travel"]').element.closest("label")).toBeNull();
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Customize Travel"]').attributes("aria-pressed")).toBe("false");
    wrapper.unmount();
  });

  it("keeps Travel as the default and reveals setup from the cog button", async () => {
    const { wrapper } = fixture({}, document.body);
    await flushPromises();
    const settings = wrapper.get('[aria-label="Customize Travel"]');

    expect(wrapper.find("#travel-panel").exists()).toBe(true);
    expect(settings.attributes("aria-pressed")).toBe("false");
    await settings.trigger("click");
    await flushPromises();
    expect(wrapper.find("#travel-customize-panel").exists()).toBe(true);
    expect(settings.attributes("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(settings.element);

    await wrapper.get(".travel-palette").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(wrapper.find("#travel-panel").exists()).toBe(true);
    expect(settings.attributes("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(wrapper.get("#travel-search-input").element);
    wrapper.unmount();
  });

  it("finds Ruins of Morah by the saved daily run search phrase", async () => {
    const { wrapper, travel } = fixture({ synonyms: [{ term: "daily run", mapId: 480 }] });
    await flushPromises();

    await wrapper.get("#travel-search-input").setValue("daily");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("Ruins of Morah");
    expect(wrapper.get(".travel-match").text()).toBe("Search phrase");
    await wrapper.get('[role="option"]').trigger("click");
    expect(travel).toHaveBeenCalledWith({ mapId: 480 });
    wrapper.unmount();
  });

  it("closes after submitting a destination", async () => {
    const { wrapper } = fixture({ synonyms: [{ term: "daily run", mapId: 480 }] });
    await flushPromises();

    await wrapper.get("#travel-search-input").setValue("daily");
    await wrapper.get('[role="option"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps the palette open when destination submission is refused", async () => {
    const test = fixture({ synonyms: [{ term: "daily run", mapId: 480 }] });
    test.travel.mockRejectedValueOnce(new Error("travel refused"));
    await flushPromises();

    await test.wrapper.get("#travel-search-input").setValue("daily");
    await test.wrapper.get('[role="option"]').trigger("click");
    await flushPromises();

    expect(test.wrapper.emitted("close")).toBeUndefined();
    test.wrapper.unmount();
  });

  it("tabs from search through recents and favorites before header actions", async () => {
    const { wrapper } = fixture({ history: [449] });
    await flushPromises();
    const controls = wrapper.findAll("input, button").filter(({ element }) =>
      !(element as HTMLInputElement | HTMLButtonElement).disabled
      && element.getAttribute("tabindex") !== "-1"
    );

    expect(controls[0]?.attributes("aria-label")).toBe("Destination, phrase, or friend");
    expect(controls[1]?.classes()).toContain("travel-recent");
    expect(controls.slice(2, -2).every((control) =>
      control.classes().includes("travel-favorite"))).toBe(true);
    expect(controls.at(-2)?.attributes("aria-label")).toBe("Customize Travel");
    expect(controls.at(-1)?.attributes("aria-label")).toBe("Close Quick Travel");
    wrapper.unmount();
  });

  it("shows at most six per-character recents without repeating the current map", async () => {
    const { wrapper } = fixture({ history: [55, 449, 81, 194, 642, 857, 248, 15] });
    await flushPromises();
    expect(wrapper.findAll(".travel-recent")).toHaveLength(6);
    expect(wrapper.get(".travel-history").text()).toContain("Kamadan");
    expect(wrapper.get(".travel-history").text()).toContain("Ascalon City");
    expect(wrapper.get(".travel-history").text()).not.toContain("Lion's Arch");
    expect(wrapper.get(".travel-history").text()).toContain("Great Temple of Balthazar");
    expect(wrapper.get(".travel-history").text()).not.toContain("D'Alessio Seaboard");
    wrapper.unmount();
  });

  it("filters positively locked destinations while unlock observation is available", async () => {
    const { wrapper, state } = fixture();
    const unlockedMapWords = Array.from({ length: 28 }, () => 0);
    unlockedMapWords[Math.floor(55 / 32)] = 1 << (55 % 32);
    state.value = {
      status: "ready",
      mapId: 55,
      travelContext: "world",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords,
    };
    await wrapper.get("#travel-search-input").setValue("Kamadan");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    await wrapper.get("#travel-search-input").setValue("Lion's Arch");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it("shows every local unlocked destination when cross-campaign unlocks make the account catalogue large", async () => {
    const shortcuts: TravelShortcuts = [
      { mapId: 164 }, null, null, null, null, null, null, null, null,
    ];
    const { wrapper, state, travel } = fixture({ history: [164, 165], shortcuts });
    const unlockedMapWords = Array.from({ length: 28 }, () => 0);
    for (const mapId of [148, 164, 165, 166, 163, 778]) {
      unlockedMapWords[Math.floor(mapId / 32)]! |= 1 << (mapId % 32);
    }
    for (const mapId of [188, 248, 281, 282, 330, 368, 467, 721, 795, 796, 857]) {
      unlockedMapWords[Math.floor(mapId / 32)]! |= 1 << (mapId % 32);
    }
    state.value = {
      status: "ready",
      mapId: 148,
      travelContext: "pre-searing",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords,
    };
    await flushPromises();

    expect(wrapper.get("#travel-available-title").text()).toBe("Available destinations");
    expect(wrapper.findAll(".travel-available .travel-recent")).toHaveLength(6);
    expect(wrapper.get(".travel-available").text()).toContain("6 unlocked");
    expect(wrapper.get(".travel-available").text()).toContain("Ascalon City (pre-Searing)");
    expect(wrapper.get(".travel-available").text()).toContain("Piken Square (pre-Searing)");
    expect(wrapper.get(".travel-available").text()).toContain("Current");
    expect(wrapper.get('[aria-label="Travel to Ashford Abbey, Prophecies, shortcut 1, recent"]').text()).toContain("1Recent");
    expect(wrapper.get('[aria-current="location"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find(".travel-history").exists()).toBe(false);
    expect(wrapper.find(".travel-favorites").exists()).toBe(false);
    expect(wrapper.findAll(".travel-available strong").map((name) => name.text())).toEqual([
      "Ascalon City (pre-Searing)",
      "Ashford Abbey",
      "Foible's Fair",
      "Fort Ranik (pre-Searing)",
      "Piken Square (pre-Searing)",
      "The Barradin Estate",
    ]);
    expect(wrapper.get(".travel-key-hints").text()).toContain("⌘1–9 save");

    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    expect(wrapper.get('[role="combobox"]').attributes("aria-controls")).toBeUndefined();
    expect(wrapper.get(".travel-key-hints").text()).toContain("back");
    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "Enter" });
    expect(travel).toHaveBeenCalledWith({ mapId: 164 });
    wrapper.unmount();
  });

  it("uses the same local rule for another early campaign", async () => {
    const { wrapper, state } = fixture();
    const unlockedMapWords = Array.from({ length: 28 }, () => 0);
    for (const mapId of [194, 242, 243, 249, 250, 251, 188, 248, 281, 282, 330, 368, 467, 721, 795, 796, 857]) {
      unlockedMapWords[Math.floor(mapId / 32)]! |= 1 << (mapId % 32);
    }
    state.value = {
      status: "ready",
      mapId: 242,
      travelContext: "world",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords,
    };
    await flushPromises();

    expect(wrapper.get(".travel-available").text()).toContain("6 unlocked");
    expect(wrapper.get(".travel-available").text()).toContain("Shing Jea Monastery");
    expect(wrapper.get(".travel-available").text()).not.toContain("Great Temple of Balthazar");
    wrapper.unmount();
  });

  it("shows the bounded Pre-Searing scope without claiming unknown unlocks", async () => {
    const { wrapper, state } = fixture();
    state.value = {
      status: "ready",
      mapId: 148,
      travelContext: "pre-searing",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords: null,
    };
    await flushPromises();

    expect(wrapper.get("#travel-available-title").text()).toBe("Destinations");
    expect(wrapper.get(".travel-available").text()).toContain("6 nearby");
    expect(wrapper.get(".travel-available").text()).toContain("Ashford Abbey");
    expect(wrapper.get(".travel-available").text()).not.toContain("unlocked");
    wrapper.unmount();
  });

  it("keeps Recent and Favorites when more than ten destinations are unlocked", async () => {
    const { wrapper, state } = fixture({ history: [81] });
    const unlockedMapWords = Array.from({ length: 28 }, () => 0);
    for (const mapId of [81, 55, 20, 49, 109, 85, 133, 136, 57, 155, 159]) {
      unlockedMapWords[Math.floor(mapId / 32)]! |= 1 << (mapId % 32);
    }
    state.value = {
      status: "ready",
      mapId: 55,
      travelContext: "world",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords,
    };
    await flushPromises();

    expect(wrapper.find(".travel-available").exists()).toBe(false);
    expect(wrapper.find(".travel-history").exists()).toBe(true);
    expect(wrapper.find(".travel-favorites").exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps typed search inside Pre-Searing and explains excluded matches", async () => {
    const { wrapper, state } = fixture();
    state.value = {
      status: "ready",
      mapId: 148,
      travelContext: "pre-searing",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords: Array.from({ length: 28 }, () => 0xffff_ffff),
    };

    await wrapper.get("#travel-search-input").setValue("asc");
    expect(wrapper.get("#travel-results-panel").text()).toContain("Ascalon City (pre-Searing)");
    expect(wrapper.get("#travel-results-panel").text()).not.toContain("Heroes' Ascent");

    await wrapper.get("#travel-search-input").setValue("heroes ascent");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(wrapper.get(".travel-empty").text()).toContain("Destination unavailable here");
    expect(wrapper.get(".travel-empty").text()).toContain(
      "Only Pre-Searing destinations are available to this character.",
    );
    wrapper.unmount();
  });

  it("shows the Pre-Searing browse scope from an explorable map", async () => {
    const { wrapper, state } = fixture();
    state.value = {
      status: "ready",
      mapId: 149,
      travelContext: "pre-searing",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords: Array.from({ length: 28 }, () => 0xffff_ffff),
    };
    await flushPromises();

    expect(wrapper.findAll(".travel-available .travel-recent")).toHaveLength(6);
    expect(wrapper.get(".travel-available").text()).toContain("Ascalon City (pre-Searing)");
    wrapper.unmount();
  });

  it("hides incompatible favorites and recents and blocks their numbered shortcuts", async () => {
    const shortcuts: TravelShortcuts = [
      { mapId: 330 }, null, null, null, null, null, null, null, null,
    ];
    const { wrapper, state, travel } = fixture({ history: [330], shortcuts });
    state.value = {
      status: "ready",
      mapId: 148,
      travelContext: "pre-searing",
      characterKey: travelCharacterKey("0123456789abcdef"),
      unlockedMapWords: Array.from({ length: 28 }, () => 0xffff_ffff),
    };
    await flushPromises();

    expect(wrapper.text()).not.toContain("Heroes' Ascent");
    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "1", code: "Digit1" });
    expect(travel).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Only Pre-Searing destinations are available");
    wrapper.unmount();
  });

  it("does not offer irreversible Pre-Searing destinations after the Searing", async () => {
    const { wrapper } = fixture();
    await wrapper.get("#travel-search-input").setValue("pre ascalon");

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(wrapper.get(".travel-empty").text()).toContain(
      "Pre-Searing destinations are unavailable after the Searing.",
    );
    wrapper.unmount();
  });

  it("shows phrase search results from customization and returns through the cog", async () => {
    const { wrapper } = fixture({ synonyms: [{ term: "daily run", mapId: 480 }] });
    await flushPromises();

    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    await wrapper.get("#travel-search-input").setValue("daily");

    expect(wrapper.find("#travel-customize-panel").exists()).toBe(false);
    expect(wrapper.get("#travel-results-panel").text()).toContain("Ruins of Morah");
    expect(wrapper.get(".travel-match").text()).toBe("Search phrase");

    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    expect(wrapper.find("#travel-results-panel").exists()).toBe(false);
    expect(wrapper.find("#travel-customize-panel").exists()).toBe(true);
    expect(wrapper.get("#travel-search-input").element).toHaveProperty("value", "");
    wrapper.unmount();
  });

  it("reports bounded search evidence when the catalogue has no match", async () => {
    const { wrapper, traceSearch } = fixture();
    await flushPromises();

    await wrapper.get('[role="combobox"]').setValue("zzzz-no-such-outpost");

    expect(traceSearch).toHaveBeenLastCalledWith("zzzz-no-such-outpost", []);
    expect(wrapper.text()).toContain("No destinations for “zzzz-no-such-outpost”");
    expect(wrapper.text()).toContain("Clear search");
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
    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    await wrapper.get('[aria-label^="Change shortcut 9"]').trigger("click");
    wrapper.getComponent(TravelDestinationPicker).vm.$emit("update:modelValue", null);
    await flushPromises();
    expect(savePreferences.mock.calls[1]?.[0].shortcuts?.[8]).toBeNull();
    wrapper.unmount();
  });

  it("adds, verifies, edits, and removes search phrases in Customize", async () => {
    const { wrapper, savePreferences } = fixture();
    await flushPromises();

    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    await wrapper.get(".travel-customize-group:nth-of-type(2) .travel-section-head .ui-button").trigger("click");
    await wrapper.get("#travel-new-phrase").setValue("daily run");
    wrapper.getComponent(TravelDestinationPicker).vm.$emit("update:modelValue", 480);
    await flushPromises();
    await wrapper.get(".travel-add-phrase").trigger("submit");
    await flushPromises();

    expect(savePreferences.mock.calls[0]?.[0].synonyms).toEqual([
      { term: "daily run", mapId: 480 },
    ]);
    expect(wrapper.text()).toContain("Search was verified");
    expect(wrapper.get('[role="combobox"]').element).toHaveProperty("value", "daily run");
    expect(wrapper.get('[aria-label="Customize Travel"]').attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("Ruins of Morah");
    expect(wrapper.get(".travel-match").text()).toBe("Search phrase");

    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    expect(wrapper.findAll(".travel-phrase-row")).toHaveLength(1);

    await wrapper.get(".travel-phrase-row .ui-input").setValue("nightfall daily");
    await flushPromises();
    expect(savePreferences.mock.calls[1]?.[0].synonyms).toEqual([
      { term: "nightfall daily", mapId: 480 },
    ]);

    await wrapper.get('[aria-label="Remove search phrase nightfall daily"]').trigger("click");
    await flushPromises();
    expect(savePreferences.mock.calls[2]?.[0].synonyms).toEqual([]);
    wrapper.unmount();
  });

  it("never claims a phrase was saved when persistence returns without it", async () => {
    const { wrapper, savePreferences } = fixture();
    await flushPromises();
    savePreferences.mockResolvedValueOnce(Object.freeze({
      shortcuts: DEFAULT_TRAVEL_SHORTCUTS,
      synonyms: Object.freeze([]),
    }));

    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");
    await wrapper.get(".travel-customize-group:nth-of-type(2) .travel-section-head .ui-button").trigger("click");
    await wrapper.get("#travel-new-phrase").setValue("daily run");
    wrapper.getComponent(TravelDestinationPicker).vm.$emit("update:modelValue", 480);
    await flushPromises();
    await wrapper.get(".travel-add-phrase").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("did not confirm that phrase was saved");
    expect(wrapper.get('[aria-label="Customize Travel"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.findAll(".travel-phrase-row")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Search was verified");
    wrapper.unmount();
  });

  it("restores phrase controls when an edit cannot be saved", async () => {
    const { wrapper, savePreferences } = fixture({
      synonyms: [{ term: "daily run", mapId: 480 }],
    });
    await flushPromises();
    await wrapper.get('[aria-label="Customize Travel"]').trigger("click");

    savePreferences.mockRejectedValueOnce(new Error("private phrase failure"));
    const phraseInput = wrapper.get(".travel-phrase-row .ui-input");
    await phraseInput.setValue("nightly run");
    await flushPromises();

    expect((phraseInput.element as HTMLInputElement).value).toBe("daily run");
    expect(wrapper.text()).toContain("search phrase could not be changed");
    expect(wrapper.text()).not.toContain("private phrase failure");

    savePreferences.mockRejectedValueOnce(new Error("private destination failure"));
    const destinationPicker = wrapper.getComponent(TravelDestinationPicker);
    destinationPicker.vm.$emit("update:modelValue", 449);
    await flushPromises();

    expect(destinationPicker.props("modelValue")).toBe(480);
    expect(wrapper.text()).toContain("Reopen Travel to confirm its destination");
    expect(wrapper.text()).not.toContain("private destination failure");
    wrapper.unmount();
  });

  it("shows a rejected trip without leaking private host details", async () => {
    const rejected = fixture();
    await flushPromises();
    await rejected.wrapper.get('[role="combobox"]').setValue("eotn");
    await rejected.wrapper.get(".travel-palette").trigger("keydown", {
      key: "9",
      code: "Digit9",
      metaKey: true,
    });
    await flushPromises();
    expect(rejected.wrapper.text()).toContain("is now shortcut 9");
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
    expect(rejected.wrapper.text()).toContain(
      "Travel could not start. Check Guild Wars, then try again.",
    );
    expect(rejected.wrapper.text()).not.toContain("is now shortcut 9");
    expect(rejected.wrapper.emitted("close")).toBeUndefined();
    rejected.wrapper.unmount();

  });

  it("searches an online friend by alias and travels to the reported outpost", async () => {
    const { wrapper, travel } = fixture({ friends: {
      status: "ready", sequence: 2, generation: 1,
      friends: [{ key: "0123456789abcdef", status: "online", mapId: 449,
        alias: "Romi", character: "Example Ranger" }],
    } });
    await flushPromises();
    await wrapper.get('[role="combobox"]').setValue("romi");
    expect(wrapper.text()).toContain("Romi");
    expect(wrapper.text()).toContain("Example Ranger");
    expect(wrapper.text()).toContain("Kamadan, Jewel of Istan");
    await wrapper.get(".travel-result").trigger("click");
    expect(travel).toHaveBeenCalledWith({ mapId: 449 });
    wrapper.unmount();
  });

  it("keeps a delayed host failure visible when Travel reopens", async () => {
    const { wrapper, notice } = fixture();
    await flushPromises();
    await wrapper.setProps({ visible: false });

    notice.value = {
      message: "Guild Wars did not confirm arrival. Travel is ready to try again.",
      level: "warning",
    };
    await wrapper.setProps({ visible: true });
    await flushPromises();

    expect(wrapper.text()).toContain("did not confirm arrival");
    expect(wrapper.get(".travel-notice").attributes("data-level")).toBe("warning");
    wrapper.unmount();
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
      "Shortcut could not be saved. Reopen Travel to confirm the active shortcut.",
    );
    expect(wrapper.text()).not.toContain("private persistence detail");

    await wrapper.get('[role="combobox"]').setValue("");
    await wrapper.get(".travel-palette").trigger("keydown", { key: "1", code: "Digit1" });
    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
    wrapper.unmount();
  });
});
