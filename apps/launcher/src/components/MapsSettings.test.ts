import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import MapsSettings from "./MapsSettings.vue";
import { fixtureSnapshot } from "../fixtures";

describe("Maps settings", () => {
  it("keeps the global map controls and their style editor in the launcher", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(MapsSettings, {
      props: { settings: fixtureSnapshot.settings, save },
    });

    expect(wrapper.text()).toContain("These settings apply to every account");
    expect(wrapper.text()).toContain("Exploration grid");
    expect(wrapper.text()).toContain("Walkable terrain");

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
    expect(save).toHaveBeenCalledWith({ cartographyGridEnabled: true });

    await wrapper.get(".map-style-actions .secondary").trigger("click");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      cartographyPresetLibrary: expect.objectContaining({
        activePreset: expect.objectContaining({ kind: "custom" }),
      }),
    }));
  });

  it("refuses invalid imported style text without writing settings", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(MapsSettings, {
      props: { settings: fixtureSnapshot.settings, save },
    });
    const textarea = wrapper.get("textarea");
    await textarea.setValue("not a map style");
    await wrapper.get("details .secondary").trigger("click");
    expect(wrapper.get('[role="status"]').text()).toBe("That style text is not valid.");
    expect(save).not.toHaveBeenCalled();
  });
});
