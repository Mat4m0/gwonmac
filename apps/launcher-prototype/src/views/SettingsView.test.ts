import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../model";
import SettingsView from "./SettingsView.vue";

describe("Settings", () => {
  it("keeps shortcuts with the enabled tool instead of a separate section", async () => {
    const settings = createDefaultSettings();
    const wrapper = mount(SettingsView, {
      props: { activeSection: "tools", settings },
    });

    expect(wrapper.text()).not.toContain("Keyboard shortcuts");
    expect(wrapper.findAll("[aria-label$='shortcut']")).toHaveLength(3);

    await wrapper.get("[aria-label='Quick Travel shortcut']").setValue("⌘G");
    expect(settings.shortcuts.quickTravel).toBe("⌘G");
  });

  it("removes tool-only choices when Tools are disabled", async () => {
    const settings = createDefaultSettings();
    const wrapper = mount(SettingsView, {
      props: { activeSection: "tools", settings },
    });

    await wrapper.get("input[type='checkbox']").setValue(false);
    expect(wrapper.text()).not.toContain("Quick Travel");
    expect(wrapper.find(".shortcut-input").exists()).toBe(false);
  });

  it("removes daily choices when Dailies are disabled", async () => {
    const settings = createDefaultSettings();
    const wrapper = mount(SettingsView, {
      props: { activeSection: "home", settings },
    });

    await wrapper.get("input[type='checkbox']").setValue(false);
    expect(wrapper.text()).not.toContain("Daily activities");
    expect(wrapper.text()).not.toContain("Open Home with");
  });
});
