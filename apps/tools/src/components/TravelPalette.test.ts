import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TRAVEL_SHORTCUTS, type TravelShortcuts } from "../../../../src/shared/travel";
import type { TravelHost } from "../travel-host";
import TravelPalette from "./TravelPalette.vue";

function fixture(initial: TravelShortcuts = DEFAULT_TRAVEL_SHORTCUTS) {
  let shortcuts: TravelShortcuts = initial;
  const travel = vi.fn<TravelHost["travel"]>(async () => undefined);
  const saveShortcuts = vi.fn<TravelHost["saveShortcuts"]>(async (next) => {
    shortcuts = next;
    return shortcuts;
  });
  const host: TravelHost = {
    state: ref({ status: "ready", mapId: 55 }),
    unavailable: null,
    async loadShortcuts() { return shortcuts; },
    saveShortcuts,
    travel,
  };
  const wrapper = mount(TravelPalette, { props: { host, visible: true } });
  return { wrapper, travel, saveShortcuts };
}

describe("TravelPalette", () => {
  it("opens with Quick Travel only and keeps Close out of the search label", async () => {
    const { wrapper } = fixture();
    await flushPromises();

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(wrapper.text()).toContain("Start typing to search all outposts");
    expect(wrapper.get('label[for="travel-search-input"]').text())
      .toBe("Search destinations");
    expect(wrapper.get('[aria-label="Close Travel"]').element.closest("label"))
      .toBeNull();
    wrapper.unmount();
  });

  it("autocompletes aliases and travels to the active result", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();

    await wrapper.get('[role="combobox"]').setValue("kama");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("Kamadan, Jewel of Istan");
    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "Enter" });

    expect(travel).toHaveBeenCalledWith({
      mapId: 449,
      district: "international",
      districtNumber: 0,
    });
    wrapper.unmount();
  });

  it("uses bare number keys for Quick Travel", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();

    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "1" });

    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
    wrapper.unmount();
  });

  it("keeps Quick Travel numbers active after using the district selector", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();

    await wrapper.get(".travel-district-region select").trigger("keydown", { key: "1" });

    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
    wrapper.unmount();
  });

  it("refuses a persisted shortcut outside the reviewed catalogue", async () => {
    const { wrapper, travel } = fixture([
      { mapId: 2_000, district: "international", districtNumber: 0 },
    ]);
    await flushPromises();

    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "1" });

    expect(travel).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not treat district input as a Quick Travel shortcut", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();

    const districtNumber = wrapper.get(".travel-district-number input");
    await districtNumber.setValue("1");
    await districtNumber.trigger("keydown", { key: "1" });

    expect(travel).not.toHaveBeenCalled();
    expect((districtNumber.element as HTMLInputElement).value).toBe("1");
    wrapper.unmount();
  });

  it("leaves arrow keys to the district controls", async () => {
    const { wrapper } = fixture();
    await flushPromises();
    await wrapper.get('[role="combobox"]').setValue("la");

    const region = wrapper.get(".travel-district-region select");
    await region.trigger("keydown", { key: "ArrowDown" });

    expect(wrapper.get('[role="option"]').attributes("aria-selected")).toBe("true");
    wrapper.unmount();
  });

  it("assigns any Cmd+1–9 slot without producing sparse settings", async () => {
    const { wrapper, saveShortcuts } = fixture();
    await flushPromises();
    await wrapper.get('[role="combobox"]').setValue("eotn");

    await wrapper.get(".travel-palette").trigger("keydown", { key: "9", metaKey: true });
    await flushPromises();

    const saved = saveShortcuts.mock.calls[0]![0];
    expect(saved).toHaveLength(9);
    expect(saved.slice(6, 8)).toEqual([null, null]);
    expect(saved[8]).toEqual({ mapId: 642, district: "international", districtNumber: 0 });
    expect(wrapper.text()).toContain("Eye of the North is now shortcut 9");
    wrapper.unmount();
  });

  it("preserves the previous shortcut and explains a failed save", async () => {
    const { wrapper, travel, saveShortcuts } = fixture();
    await flushPromises();
    saveShortcuts.mockRejectedValueOnce(new Error("private persistence detail"));
    await wrapper.get('[role="combobox"]').setValue("eotn");

    await wrapper.get(".travel-palette").trigger("keydown", { key: "1", metaKey: true });
    await flushPromises();
    expect(wrapper.text()).toContain(
      "Shortcut could not be saved. Your previous shortcut is still active.",
    );
    expect(wrapper.text()).not.toContain("private persistence detail");

    await wrapper.get('[role="combobox"]').setValue("");
    await wrapper.get(".travel-palette").trigger("keydown", { key: "1" });
    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
    wrapper.unmount();
  });

  it("turns host travel failures into actionable player copy", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();
    travel.mockRejectedValueOnce(new Error("private host detail"));
    await wrapper.get('[role="combobox"]').setValue("kama");

    await wrapper.get('[role="combobox"]').trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.text()).toContain("Travel could not start. Check Guild Wars, then try again.");
    expect(wrapper.text()).not.toContain("private host detail");
    wrapper.unmount();
  });
});
