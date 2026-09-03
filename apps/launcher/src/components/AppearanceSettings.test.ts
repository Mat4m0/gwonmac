import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppearanceSettings from "./AppearanceSettings.vue";
import { fixtureSnapshot } from "../fixtures";
import { UI_THEME_COLOR_FIELDS } from "@shared/ui-theme";

describe("in-game appearance settings", () => {
  it("keeps saved custom colors when switching the active style", async () => {
    const save = vi.fn(async () => undefined);
    const wrapper = mount(AppearanceSettings, { props: { settings: fixtureSnapshot.settings, save } });
    await wrapper.get("select").setValue("custom");
    expect(save).toHaveBeenCalledWith({ uiStyle: "custom" });
    await wrapper.setProps({ settings: { ...fixtureSnapshot.settings, uiStyle: "custom" } });
    expect(wrapper.findAll('input[type="color"]')).toHaveLength(UI_THEME_COLOR_FIELDS.length);
    await wrapper.get('[aria-label="Accent hex"]').setValue("ABCDEF");
    expect(save).toHaveBeenLastCalledWith({ uiCustomTheme: { ...fixtureSnapshot.settings.uiCustomTheme, accent: "#abcdef" } });
  });
  it("rejects invalid imports and reports failed saves", async () => {
    const save = vi.fn(async () => { throw new Error("disk"); });
    const wrapper = mount(AppearanceSettings, { props: { settings: { ...fixtureSnapshot.settings, uiStyle: "custom" }, save } });
    await wrapper.get('textarea[placeholder="Paste theme text"]').setValue("invalid theme");
    await wrapper.get(".theme-sharing .secondary").trigger("click");
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.get('[role="status"]').text()).toContain("not valid");
    await wrapper.get('[aria-label="Panel opacity value"]').setValue("80");
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("could not be saved");
  });
});
