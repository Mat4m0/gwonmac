import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TRAVEL_SHORTCUTS, type TravelShortcuts } from "../../../../src/shared/travel";
import type { TravelHost } from "../travel-host";
import TravelPalette from "./TravelPalette.vue";

function fixture() {
  let shortcuts: TravelShortcuts = DEFAULT_TRAVEL_SHORTCUTS;
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
  it("autocompletes aliases and travels to the active result", async () => {
    const { wrapper, travel } = fixture();
    await flushPromises();

    await wrapper.get('[role="combobox"]').setValue("kama");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("Kamadan, Jewel of Istan");
    await wrapper.get(".travel-palette").trigger("keydown", { key: "Enter" });

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

    await wrapper.get(".travel-palette").trigger("keydown", { key: "1" });

    expect(travel).toHaveBeenCalledWith(DEFAULT_TRAVEL_SHORTCUTS[0]);
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
});
