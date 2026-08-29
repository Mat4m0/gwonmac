import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherNativeApi } from "@shared/launcher-contracts";
import App from "./App.vue";
import { fixtureSnapshot } from "./fixtures";

afterEach(() => {
  Object.defineProperty(window, "launcherNative", { configurable: true, value: undefined });
});

describe("unified launcher shell", () => {
  it("keeps Home focused on content and moves account management to Accounts", async () => {
    const wrapper = mount(App);
    expect(wrapper.get("h1").text()).toContain("Wayfarer’s Reverie");
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    expect(wrapper.get(".settings-content h1").text()).toBe("General");
    await wrapper.findAll("nav button")[1]!.trigger("click");
    expect(wrapper.get(".accounts-page h1").text()).toBe("Game windows");
    expect(wrapper.text()).toContain("Main account");
  });

  it("shows seven daily cards and a full-week disclosure", async () => {
    const wrapper = mount(App);
    await wrapper.findAll(".segmented button")[1]!.trigger("click");
    expect(wrapper.findAll(".daily-grid article")).toHaveLength(7);
    expect(wrapper.get(".load-more").text()).toBe("Show the next 7 days");
  });

  it("uses truthful production wording for feedback submission", async () => {
    const wrapper = mount(App);
    await wrapper.findAll("nav button")[3]!.trigger("click");
    expect(wrapper.get(".placeholder-note").text()).toContain("not connected yet");
    expect(wrapper.text()).not.toContain("submitted");
  });

  it("keeps Tool switches and shortcuts together", async () => {
    const wrapper = mount(App);
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    await wrapper.findAll(".settings-page aside button")[2]!.trigger("click");
    expect(wrapper.text()).toContain("Tools apply to every account");
    expect(wrapper.text()).toContain("Build Management");
    expect(wrapper.text()).toContain("⌘B");
    expect(wrapper.text()).toContain("Quick Travel");
    expect(wrapper.text()).toContain("Xunlai Storage");
    expect(wrapper.text()).not.toContain("Trade Chat");
  });

  it("keeps Tools off unless a fresh player explicitly enables them", async () => {
    const completeSetup = vi.fn(async () => undefined);
    const fresh = {
      ...fixtureSnapshot,
      experience: {
        ...fixtureSnapshot.experience,
        installationKind: "fresh" as const,
        setup: "pending" as const,
        introduction: "pending" as const,
        showMigrationNotice: false,
      },
    };
    Object.defineProperty(window, "launcherNative", {
      configurable: true,
      value: {
        state: { get: async () => fresh, onChange: () => () => undefined },
        experience: { completeSetup },
      } as unknown as LauncherNativeApi,
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.text()).toContain("Welcome to Guild Wars Reforged");
    await wrapper.get(".setup-card .primary").trigger("click");
    expect(wrapper.text()).toContain("Tools apply to every account");
    await wrapper.findAll(".setup-card .secondary")[1]!.trigger("click");
    expect(completeSetup).toHaveBeenCalledWith({ enableTools: false });
  });

  it("asks before replacing another Tool shortcut", async () => {
    const replaceShortcut = vi.fn(async () => undefined);
    Object.defineProperty(window, "launcherNative", {
      configurable: true,
      value: {
        state: { get: async () => fixtureSnapshot, onChange: () => () => undefined },
        tools: {
          captureShortcut: async () => ({
            status: "conflict" as const,
            tool: "quick-travel" as const,
            binding: { key: "t", shift: false, option: false },
          }),
          replaceShortcut,
        },
      } as unknown as LauncherNativeApi,
    });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    await wrapper.findAll(".settings-page aside button")[2]!.trigger("click");
    await wrapper.findAll(".tool-row .secondary")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("already used by Quick Travel");
    await wrapper.findAll(".settings-content .form-actions .primary")[0]!.trigger("click");
    expect(replaceShortcut).toHaveBeenCalledWith({
      tool: "build-management",
      binding: { key: "t", shift: false, option: false },
    });
  });
});
