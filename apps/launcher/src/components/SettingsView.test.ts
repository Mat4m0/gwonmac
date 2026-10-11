import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherNativeApi, LauncherSnapshot } from "@shared/launcher-contracts";
import { SETTINGS, type SettingsTarget } from "@shared/settings-catalogue";
import SettingsView from "./SettingsView.vue";
import { fixtureSnapshot } from "../fixtures";

const allToolsOn: LauncherSnapshot = {
  ...fixtureSnapshot,
  tools: { ...fixtureSnapshot.tools, configured: true, loaded: true, features: Object.fromEntries(Object.entries(fixtureSnapshot.tools.features).map(([tool, feature]) => [tool, { ...feature, enabled: true }])) as LauncherSnapshot["tools"]["features"] },
};

/** Mounts the page as the launcher does; it opens on Tools unless `target` names another place. */
function mountView(overrides: Record<string, unknown> = {}, { snapshot = fixtureSnapshot, target = { section: "tools" } as SettingsTarget | null, attach = false } = {}) {
  const native = { ...overrides } as unknown as LauncherNativeApi;
  return mount(SettingsView, { props: { snapshot, native, launcher: { snapshot, native }, target }, ...(attach ? { attachTo: document.body } : {}) });
}

async function openSection(wrapper: ReturnType<typeof mount>, label: string) {
  await wrapper.findAll(".settings-page aside button").find(button => button.text() === label)!.trigger("click");
  await flushPromises();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Settings page", () => {
  it("renders exactly one control, with the same label, for every setting search can open", async () => {
    const wrapper = mountView({}, { snapshot: allToolsOn });
    await flushPromises();
    const found = new Map<string, string[]>();
    for (const button of wrapper.findAll(".settings-page aside button")) {
      await button.trigger("click");
      await flushPromises();
      for (const control of wrapper.findAll("[data-setting]")) {
        const id = control.attributes("data-setting")!;
        found.set(id, [...found.get(id) ?? [], `${control.attributes("aria-label") ?? ""} ${control.text()}`]);
      }
    }
    for (const entry of SETTINGS) {
      expect(found.get(entry.id), entry.id).toHaveLength(1);
      expect(found.get(entry.id)![0], entry.id).toContain(entry.label);
    }
    wrapper.unmount();
  });

  it("finds a setting by its words and focuses its control", async () => {
    const wrapper = mountView({}, { attach: true });
    await flushPromises();
    await wrapper.get('input[type="search"]').setValue("memory");
    const result = wrapper.findAll(".settings-results button").find(button => button.text().includes("Extended memory"));
    expect(result).toBeDefined();
    await result!.trigger("click");
    await flushPromises();
    expect(wrapper.get(".settings-fields h1").text()).toBe("Game");
    const row = wrapper.get('[data-setting="extendedMemoryEnabled"]');
    expect(row.classes()).toContain("setting-focus");
    expect(document.activeElement).toBe(row.get('input[type="checkbox"]').element);
    wrapper.unmount();
  });

  it("opens at the control the Hub asked for, inside its closed tool options", async () => {
    const wrapper = mountView({}, { snapshot: allToolsOn, target: { section: "tools", control: "chatFilterAllyDrops" }, attach: true });
    await flushPromises();
    const row = wrapper.get('[data-setting="chatFilterAllyDrops"]');
    expect(row.element.closest("details")!.open).toBe(true);
    expect(document.activeElement).toBe(row.get("input").element);
    wrapper.unmount();
  });

  it("says what was saved and when it applies", async () => {
    const update = vi.fn(async () => undefined);
    const wrapper = mountView({ settings: { update } }, { target: { section: "game" } });
    await flushPromises();
    await wrapper.get('[data-setting="extendedMemoryEnabled"] input').setValue(true);
    await flushPromises();
    expect(update).toHaveBeenCalledWith({ extendedMemoryEnabled: true });
    expect(wrapper.get(".settings-status").text()).toBe("Saved: Extended memory. Applies after you restart GWonMac.");
    wrapper.unmount();
  });

  it("retains a refused save for an exact retry and locks conflicting edits", async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce(undefined);
    const wrapper = mountView({ settings: { update } }, { target: { section: "updates" } });
    await flushPromises();
    await wrapper.get('[data-setting="autoCheckUpdates"] input').setValue(false);
    await flushPromises();
    expect(wrapper.get('.settings-status[role="alert"]').text()).toContain("change shown is not saved");
    expect(wrapper.get(".settings-fields").attributes("disabled")).toBeDefined();
    await wrapper.findAll(".save-actions button").find(button => button.text() === "Retry")!.trigger("click");
    await flushPromises();
    expect(update.mock.calls).toEqual([[{ autoCheckUpdates: false }], [{ autoCheckUpdates: false }]]);
    expect(wrapper.get(".settings-fields").attributes("disabled")).toBeUndefined();
    expect(wrapper.find('.settings-status[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("reverts unsaved native control state to the canonical snapshot", async () => {
    const update = vi.fn(async () => { throw new Error("disk"); });
    const wrapper = mountView({ settings: { update } }, { target: { section: "updates" } });
    await flushPromises();
    const original = fixtureSnapshot.settings.autoCheckUpdates;
    await wrapper.get('[data-setting="autoCheckUpdates"] input').setValue(!original);
    await flushPromises();
    await wrapper.findAll(".save-actions button").find(button => button.text() === "Revert")!.trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-setting="autoCheckUpdates"] input').element.checked).toBe(original);
    expect(update).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.settings-status[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps each Tool's switch and shortcut on one row, with the Hub key first", async () => {
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.get(".settings-fields h1").text()).toBe("Tools");
    expect(wrapper.get('[data-setting="hub"]').text()).toContain("Built in");
    const builds = wrapper.get('[data-setting="tool:build-management"]');
    expect(builds.text()).toContain("Build Library");
    expect(builds.text()).toContain("⌘B");
    expect(wrapper.find(".settings-page aside").text()).not.toContain("Shortcuts");
  });

  it("saves each enabled Chat Filter category independently", async () => {
    const update = vi.fn(async () => undefined);
    const wrapper = mountView({ settings: { update } }, { snapshot: allToolsOn });
    await flushPromises();
    await wrapper.get('[data-setting="chatFilterAllyDrops"] input').setValue(false);
    await flushPromises();
    expect(update).toHaveBeenCalledWith({ chatFilterAllyDrops: false });
  });

  it("keeps Maps discoverable and explains disabled and restart states", async () => {
    const restart = vi.fn(async () => undefined);
    const wrapper = mountView({ tools: { restartToApply: restart } });
    const update = (snapshot: LauncherSnapshot) => wrapper.setProps({ snapshot, launcher: { snapshot, native: wrapper.props("launcher")!.native } });
    await flushPromises();
    await openSection(wrapper, "Maps");
    expect(wrapper.get(".settings-fields h1").text()).toBe("Maps");
    expect(wrapper.text()).toContain("Tools are off");
    update({ ...fixtureSnapshot, revision: 2, tools: { ...fixtureSnapshot.tools, configured: true, loaded: false, restartRequired: true } });
    await flushPromises();
    expect(wrapper.text()).toContain("Restart the launcher to enable Maps");
    await wrapper.findAll("button").find(button => button.text() === "Open restart options")!.trigger("click");
    await flushPromises();
    expect(wrapper.get(".settings-fields h1").text()).toBe("Tools");
    expect(wrapper.get(".restart-row button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".restart-row").text()).toContain("Close every game window");
    update({ ...fixtureSnapshot, revision: 3, profiles: fixtureSnapshot.profiles.map(profile => ({ ...profile, state: "ready" })), tools: { ...fixtureSnapshot.tools, configured: true, loaded: false, restartRequired: true } });
    await flushPromises();
    await wrapper.get(".restart-row button").trigger("click");
    expect(restart).toHaveBeenCalledOnce();
  });

  it("asks before replacing another Tool shortcut", async () => {
    const replaceShortcut = vi.fn(async () => undefined);
    const wrapper = mountView({
      tools: {
        captureShortcut: async () => ({ status: "conflict" as const, action: "travel.open" as const, binding: { key: "t", shift: false, option: false } }),
        replaceShortcut,
      },
    });
    await flushPromises();
    await wrapper.get('button[aria-label="Change Switch Character shortcut"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Already used by Travel");
    await wrapper.get(".shortcut-actions .primary").trigger("click");
    expect(replaceShortcut).toHaveBeenCalledWith({ action: "character.switch", binding: { key: "t", shift: false, option: false } });
  });

  it("in the Hub, keeps the launcher's sections listed and opens the launcher for them", async () => {
    const openInLauncher = vi.fn();
    const { tools, shortcuts } = fixtureSnapshot;
    const wrapper = mount(SettingsView, { props: { snapshot: { settings: fixtureSnapshot.settings, tools, shortcuts }, native: undefined, openInLauncher, target: { section: "updates", control: "autoCheckUpdates" } } });
    await flushPromises();
    expect(openInLauncher).toHaveBeenCalledWith({ section: "updates", control: "autoCheckUpdates" });
    await openSection(wrapper, "Game files");
    expect(openInLauncher).toHaveBeenLastCalledWith({ section: "game-files" });
    expect(wrapper.get(".settings-fields h1").text()).toBe("Tools");
    await openSection(wrapper, "Maps");
    expect(wrapper.get(".settings-fields h1").text()).toBe("Maps");
  });

  it("loads real cache information when Game Files opens", async () => {
    const info = vi.fn(async () => ({ bytes: 1024 ** 3, chunks: 10, totalBytes: 2 * 1024 ** 3, totalChunks: 20, freeBytes: 3 * 1024 ** 3, fullDownloadShortfall: 0 }));
    const wrapper = mountView({ gameFiles: { info } });
    await flushPromises();
    await openSection(wrapper, "Game files");
    expect(info).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("1.0 GB of 2.0 GB verified");
  });
});
