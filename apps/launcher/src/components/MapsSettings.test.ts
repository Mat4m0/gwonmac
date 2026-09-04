import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import MapsSettings from "./MapsSettings.vue";
import { fixtureSnapshot } from "../fixtures";
import { CARTOGRAPHY_BUILTIN_PRESETS } from "@shared/cartography-overlay";
import { addCartographyPreset } from "@shared/cartography-presets";

describe("Maps settings", () => {
  it("names a custom style before deleting it and lets the player cancel", async () => {
    const save = vi.fn(async () => undefined);
    const library = addCartographyPreset(fixtureSnapshot.settings.cartographyPresetLibrary, { id: "test-style", name: "My map", style: CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style })!;
    const wrapper = mount(MapsSettings, { props: { settings: { ...fixtureSnapshot.settings, cartographyPresetLibrary: library }, save } });
    await wrapper.findAll('button').find(button => button.text() === 'Delete custom style')!.trigger('click');
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Delete My map?');
    expect(save).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[role="dialog"] .secondary')!.click();
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(button => button.text() === 'Delete custom style')!.trigger('click');
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[role="dialog"] .danger-button')!.click();
    await flushPromises();
    expect(save).toHaveBeenCalledWith({ cartographyPresetLibrary: expect.objectContaining({ customPresets: [] }) });
    wrapper.unmount();
  });

  it("adjusts built-in terrain thickness by creating a custom copy", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(MapsSettings, { props: { settings: fixtureSnapshot.settings, save } });
    await wrapper.get('[aria-label="Terrain border thickness value"]').setValue("4");
    expect(save).toHaveBeenCalledWith({
      cartographyPresetLibrary: expect.objectContaining({
        activePreset: expect.objectContaining({ kind: "custom" }),
        customPresets: [expect.objectContaining({
          style: {
            ...CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style,
            walkability: { ...CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style.walkability, boundaryWidth: 4 },
          },
        })],
      }),
    });
    expect(CARTOGRAPHY_BUILTIN_PRESETS.cartographer.style.walkability.boundaryWidth).not.toBe(4);
  });

  it("keeps the Compass opt-in separate from the map grid", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(MapsSettings, { props: { settings: { ...fixtureSnapshot.settings, cartographyGridEnabled: true }, save } });
    const compass = wrapper.findAll('input[type="checkbox"]')[1]!;
    expect((compass.element as HTMLInputElement).checked).toBe(false);
    await compass.setValue(true);
    expect(save).toHaveBeenCalledWith({ cartographyCompassGridEnabled: true });
    await wrapper.setProps({ settings: { ...fixtureSnapshot.settings, cartographyGridEnabled: false, cartographyCompassGridEnabled: true } });
    expect(compass.attributes("disabled")).toBeDefined();
    expect((compass.element as HTMLInputElement).checked).toBe(true);
  });

  it("offers Compass ranges independently from the Cartography layers", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(MapsSettings, {
      props: { settings: fixtureSnapshot.settings, save },
    });
    await wrapper.get('[aria-label="Compass ranges"]').setValue(true);
    expect(save).toHaveBeenCalledWith({ compassRangeIndicatorsEnabled: true });
    await wrapper.get('[aria-label="Show Cast range"]').setValue(false);
    expect(save).toHaveBeenCalledWith({ compassRangeCastEnabled: false });
    await wrapper.get('[aria-label="Cast opacity value"]').setValue("62");
    expect(save).toHaveBeenCalledWith({ compassRangeCastOpacity: 62 });
  });

  it("reports a failed persistence call without claiming the change was saved", async () => {
    const wrapper = mount(MapsSettings, { props: { settings: fixtureSnapshot.settings, save: async () => { throw new Error("disk"); } } });
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("could not be saved");
  });
  it("keeps the global map controls and their style editor in the launcher", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(MapsSettings, {
      props: { settings: fixtureSnapshot.settings, save },
    });

    expect(wrapper.text()).toContain("Layers and styles for every account");
    expect(wrapper.text()).toContain("World Map");
    expect(wrapper.text()).toContain("Exploration grid");
    expect(wrapper.text()).toContain("unexplored cells reachable in this instance");
    expect(wrapper.text()).toContain("Walkable terrain");
    expect(wrapper.text()).not.toContain("Other-map route");

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
    const textarea = wrapper.get('textarea[placeholder="Paste style text"]');
    await textarea.setValue("not a map style");
    await wrapper.get("details .secondary").trigger("click");
    expect(wrapper.get('[role="status"]').text()).toBe("That style text is not valid.");
    expect(save).not.toHaveBeenCalled();
  });
});
