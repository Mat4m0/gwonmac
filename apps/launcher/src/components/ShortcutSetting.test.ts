import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@shared/keyboard-shortcuts";
import type { LauncherNativeApi } from "@shared/launcher-contracts";
import ShortcutSetting from "./ShortcutSetting.vue";

function api() {
  return {
    setMasterEnabled: vi.fn(), setFeature: vi.fn(), restartToApply: vi.fn(),
    restoreDefaultShortcut: vi.fn(),
    captureShortcut: vi.fn(async () => ({ status: "captured" as const, binding: { key: "g", shift: false, option: false } })),
    replaceShortcut: vi.fn(async () => undefined),
  } satisfies LauncherNativeApi["tools"];
}
describe("Shortcut setting", () => {
  it("starts Maps unassigned and can capture or clear a binding", async () => {
    const tools = api();
    const wrapper = mount(ShortcutSetting, { props: { action: "cartography.grid.toggle", shortcuts: DEFAULT_SHORTCUTS, api: tools } });
    expect(wrapper.text()).toContain("Not set");
    await wrapper.get(".secondary").trigger("click");
    await flushPromises();
    expect(tools.replaceShortcut).toHaveBeenCalledWith({ action: "cartography.grid.toggle", binding: { key: "g", shift: false, option: false } });
    await wrapper.setProps({ shortcuts: { ...DEFAULT_SHORTCUTS, "cartography.grid.toggle": { key: "g", shift: false, option: false } } });
    await wrapper.get('[aria-label="Clear Exploration grid shortcut"]').trigger("click");
    expect(tools.replaceShortcut).toHaveBeenLastCalledWith({ action: "cartography.grid.toggle", binding: null });
  });
  it("asks before restoring a default that another action owns", async () => {
    const tools = api();
    const wrapper = mount(ShortcutSetting, { props: { action: "character.switch", shortcuts: { ...DEFAULT_SHORTCUTS, "character.switch": null, "cartography.grid.toggle": DEFAULT_SHORTCUTS["character.switch"] }, api: tools } });
    await wrapper.get('[aria-label="Restore Switch Character default shortcut"]').trigger("click");
    expect(wrapper.text()).toContain("Already used by Exploration grid");
    expect(tools.replaceShortcut).not.toHaveBeenCalled();
    await wrapper.get(".primary").trigger("click");
    expect(tools.replaceShortcut).toHaveBeenCalledWith({ action: "character.switch", binding: DEFAULT_SHORTCUTS["character.switch"] });
  });
  it("does not save a capture after its settings surface closes", async () => {
    let finish!: (value: { status: "cleared" }) => void;
    const tools = { ...api(), captureShortcut: vi.fn(() => new Promise<{ status: "cleared" }>(resolve => { finish = resolve; })) };
    const wrapper = mount(ShortcutSetting, { props: { action: "cartography.grid.toggle", shortcuts: DEFAULT_SHORTCUTS, api: tools } });
    await wrapper.get(".secondary").trigger("click");
    wrapper.unmount();
    finish({ status: "cleared" });
    await flushPromises();
    expect(tools.replaceShortcut).not.toHaveBeenCalled();
  });
});
