import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../model";
import ShortcutRecorder from "../components/ShortcutRecorder.vue";
import SettingsView from "./SettingsView.vue";

describe("Settings", () => {
  it("keeps shortcuts with the enabled tool instead of a separate section", async () => {
    const settings = createDefaultSettings();
    const wrapper = mount(SettingsView, {
      props: { activeSection: "tools", settings },
    });

    expect(wrapper.text()).not.toContain("Keyboard shortcuts");
    expect(wrapper.text()).toContain("Build management");
    expect(wrapper.text()).toContain("Quick Travel");
    expect(wrapper.text()).toContain("Xunlai storage");
    expect(wrapper.text()).not.toContain("Apply teams");
    expect(wrapper.text()).not.toContain("Show or hide Tools");
    expect(wrapper.findAllComponents(ShortcutRecorder)).toHaveLength(3);

    const quickTravelRecorder = wrapper.findAllComponents(ShortcutRecorder)[1]!;
    await quickTravelRecorder.get(".shortcut-record-button").trigger("click");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyG", key: "G", ctrlKey: true, shiftKey: true }),
    );
    await wrapper.vm.$nextTick();
    expect(settings.shortcuts.quickTravel).toBe("⌃⇧G");
  });

  it("removes tool-only choices when Tools are disabled", async () => {
    const settings = createDefaultSettings();
    const wrapper = mount(SettingsView, {
      props: { activeSection: "tools", settings },
    });

    await wrapper.get("input[type='checkbox']").setValue(false);
    expect(wrapper.text()).not.toContain("Quick Travel");
    expect(wrapper.findComponent(ShortcutRecorder).exists()).toBe(false);
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
