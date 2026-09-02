import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherNativeApi } from "@shared/launcher-contracts";
import App from "./App.vue";
import { fixtureSnapshot } from "./fixtures";

function installNative(overrides: Record<string, unknown>): LauncherNativeApi {
  const native = {
    navigation: { onRequest: () => () => undefined },
    state: { get: async () => fixtureSnapshot, onChange: () => () => undefined },
    ...overrides,
  } as unknown as LauncherNativeApi;
  Object.defineProperty(window, "launcherNative", { configurable: true, value: native });
  return native;
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "launcherNative", { configurable: true, value: undefined });
  document.querySelectorAll(".modal-backdrop").forEach((element) => element.remove());
});

describe("unified launcher shell", () => {
  it("opens the destination requested by the native application menu", async () => {
    let navigate: ((destination: "home" | "settings") => void) | undefined;
    installNative({
      navigation: {
        onRequest(callback: (destination: "home" | "settings") => void) {
          navigate = callback;
          return () => undefined;
        },
      },
    });
    const wrapper = mount(App);
    await flushPromises();

    navigate?.("settings");
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".settings-content h1").text()).toBe("Updates");

    navigate?.("home");
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".hero-copy h1").text()).toContain("Seven skill fixes");
  });

  it("keeps funding on top and operational status only in the launch bar", () => {
    const wrapper = mount(App);

    expect(wrapper.get(".funding-banner").text()).toContain("Support gwonmac");
    expect(wrapper.get(".funding-banner").text()).not.toContain("yearly project costs");
    expect(wrapper.get(".funding-banner").text()).not.toContain("Downloading game files");
    expect(wrapper.get(".launchbar").text()).toContain("Downloading game files");
    expect(wrapper.find(".priority-banner").exists()).toBe(false);
  });

  it("keeps Home focused on content and moves account management to Accounts", async () => {
    const wrapper = mount(App);
    expect(wrapper.get("h1").text()).toContain("Seven skill fixes");
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    expect(wrapper.get(".settings-content h1").text()).toBe("Updates");
    await wrapper.findAll("nav button")[1]!.trigger("click");
    expect(wrapper.get(".accounts-page h1").text()).toBe("Game windows");
    expect(wrapper.text()).toContain("Main account");
  });

  it("shows a distinct daily schedule and a full-week disclosure", async () => {
    const wrapper = mount(App);
    await wrapper.findAll(".segmented button")[1]!.trigger("click");
    expect(wrapper.findAll(".daily-item")).toHaveLength(7);
    expect(wrapper.text()).toContain("Zaishen Mission");
    expect(wrapper.text()).toContain("Nicholas Sandford");
    expect(wrapper.text()).not.toContain("Daily activity");
    expect(wrapper.get(".load-more").text()).toBe("Show full week");
  });

  it("persists featured-news pause and opens only an opaque story id", async () => {
    const updatePreferences = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);
    installNative({
      experience: { updatePreferences },
      news: { open },
    });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('button[aria-label="Pause automatic story rotation"]').trigger("click");
    expect(updatePreferences).toHaveBeenCalledWith({ content: { autoRotateNews: false } });
    await wrapper.findAll(".news-row")[0]!.trigger("click");
    expect(open).toHaveBeenCalledWith("guild-wars-update-2026-09-01");
  });

  it("renders GWonMac notes as native article elements and opens opaque inline actions", async () => {
    const open = vi.fn(async () => undefined);
    installNative({ news: { open } });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll(".news-row")[2]!.trigger("click");
    expect(document.querySelector(".news-article h1")?.textContent).toContain("2026.8.10");
    expect(document.querySelectorAll(".news-article li")).toHaveLength(2);
    expect(document.querySelector(".news-article")?.innerHTML).not.toContain("v-html");
    document.querySelector<HTMLButtonElement>(".news-article .article-link")!.click();
    expect(open).toHaveBeenCalledWith("news-link-deadbeef");
  });

  it("uses a neutral home hero when both optional content sections are hidden", async () => {
    installNative({
      state: {
        get: async () => ({
          ...fixtureSnapshot,
          preferences: { content: { ...fixtureSnapshot.preferences.content, news: false, dailies: false } },
        }),
        onChange: () => () => undefined,
      },
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get(".hero-copy h1").text()).toBe("Your accounts. One launcher.");
    expect(wrapper.find("#news-panel").exists()).toBe(false);
  });

  it("labels automatic rotation truthfully when Reduced Motion is active", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const wrapper = mount(App);
    await wrapper.vm.$nextTick();
    const control = wrapper.get('button[aria-label="Automatic story rotation paused for Reduced Motion"]');
    expect(control.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".motion-note").text()).toBe("Reduced Motion");
    matchMedia.mockRestore();
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
    await wrapper.findAll(".settings-page aside button").find((button) => button.text() === "Tools")!.trigger("click");
    expect(wrapper.text()).toContain("Tools apply to every account");
    expect(wrapper.text()).toContain("Build Management");
    expect(wrapper.text()).toContain("⌘B");
    expect(wrapper.text()).toContain("Quick Travel");
    expect(wrapper.text()).toContain("Xunlai Storage");
    expect(wrapper.text()).not.toContain("Trade Chat");
  });

  it("keeps Discord and GitHub in the global header", async () => {
    const wrapper = mount(App);

    expect(wrapper.get('.titlebar button[aria-label="Open Discord"]').attributes("title")).toBe("Discord");
    expect(wrapper.get('.titlebar button[aria-label="Open GitHub"]').attributes("title")).toBe("GitHub");
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    expect(wrapper.find(".settings-community-links").exists()).toBe(false);
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
    installNative({
      state: { get: async () => fresh, onChange: () => () => undefined },
      experience: { completeSetup },
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(document.body.textContent).toContain("Welcome to Guild Wars Reforged");
    document.querySelector<HTMLButtonElement>(".setup-card .primary")!.click();
    await wrapper.vm.$nextTick();
    expect(document.body.textContent).toContain("Tools apply to every account");
    document.querySelectorAll<HTMLButtonElement>(".setup-card .secondary")[1]!.click();
    await flushPromises();
    expect(completeSetup).toHaveBeenCalledWith({ enableTools: false });
  });

  it("asks before replacing another Tool shortcut", async () => {
    const replaceShortcut = vi.fn(async () => undefined);
    installNative({
      tools: {
        captureShortcut: async () => ({
          status: "conflict" as const,
          tool: "quick-travel" as const,
          binding: { key: "t", shift: false, option: false },
        }),
        replaceShortcut,
      },
    });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    await wrapper.findAll(".settings-page aside button").find((button) => button.text() === "Tools")!.trigger("click");
    await wrapper.findAll(".tool-row .secondary")[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("already used by Quick Travel");
    await wrapper.findAll(".settings-content .form-actions .primary")[0]!.trigger("click");
    expect(replaceShortcut).toHaveBeenCalledWith({
      tool: "build-management",
      binding: { key: "t", shift: false, option: false },
    });
  });

  it("uses saved news honestly when production is offline", async () => {
    installNative({
      state: {
        get: async () => ({
          ...fixtureSnapshot,
          experience: { ...fixtureSnapshot.experience, showMigrationNotice: false },
          news: { status: "offline", stories: fixtureSnapshot.news.stories },
          contentAvailability: { news: "placeholder", dailies: "placeholder", knownIssues: "placeholder", feedback: "placeholder" },
        }),
        onChange: () => () => undefined,
      },
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get(".hero-copy h1").text()).toContain("Seven skill fixes");
    expect(wrapper.get("#news-panel").text()).toContain("Saved news · offline");
    expect(wrapper.get(".segmented").text()).toContain("Dailies");
    expect(wrapper.text()).not.toContain("Wayfarer’s Reverie");
    await wrapper.findAll("nav button")[3]!.trigger("click");
    expect(wrapper.text()).toContain("Direct feedback is not connected yet.");
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Add screenshot or file");
  });

  it("persists and clears the migrated-account notice after one short appearance", async () => {
    vi.useFakeTimers();
    const dismissMigrationNotice = vi.fn(async () => undefined);
    installNative({ experience: { dismissMigrationNotice } });
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get(".toast").text()).toContain("Your existing account is ready");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(dismissMigrationNotice).toHaveBeenCalledOnce();
  });

  it("shows a recoverable startup failure", async () => {
    installNative({ state: { get: async () => { throw new Error("unavailable"); }, onChange: () => () => undefined } });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('[role="alert"] h1').text()).toBe("The launcher could not open");
    expect(wrapper.text()).toContain("accounts and game files were not changed");
  });

  it("persists dismissal of the recovered-preferences notice", async () => {
    const dismissPreferencesReset = vi.fn(async () => undefined);
    installNative({
      state: {
        get: async () => ({
          ...fixtureSnapshot,
          experience: {
            ...fixtureSnapshot.experience,
            preferencesReset: true,
            showMigrationNotice: false,
          },
        }),
        onChange: () => () => undefined,
      },
      experience: { dismissPreferencesReset },
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.text()).toContain("Launcher preferences were reset");
    await wrapper.get('.toast button[aria-label="Dismiss"]').trigger("click");
    expect(dismissPreferencesReset).toHaveBeenCalledOnce();
  });

  it("opens only selected accounts that are not already running", async () => {
    const play = vi.fn(async () => undefined);
    installNative({ profiles: { play } });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get(".account-picker").trigger("click");
    await wrapper.findAll('[role="checkbox"]')[1]!.trigger("click");
    await wrapper.get(".launch").trigger("click");
    await flushPromises();
    expect(wrapper.get(".launch").text()).toContain("Play");
    expect(play).toHaveBeenCalledWith([fixtureSnapshot.profiles[0]!.id]);
  });

  it("loads real cache information when Game Files opens", async () => {
    const info = vi.fn(async () => ({ bytes: 1024 ** 3, chunks: 10, totalBytes: 2 * 1024 ** 3, totalChunks: 20, freeBytes: 3 * 1024 ** 3, fullDownloadShortfall: 0 }));
    installNative({ gameFiles: { info } });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    await wrapper.findAll(".settings-page aside button").find((button) => button.text() === "Game files")!.trigger("click");
    await flushPromises();
    expect(info).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("1.0 GB of 2.0 GB verified");
  });

  it("creates an account with its optional appearance in one step", async () => {
    const create = vi.fn(async () => undefined);
    installNative({ profiles: { create } });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll("nav button")[1]!.trigger("click");
    await wrapper.get(".page-head .secondary").trigger("click");
    const name = document.querySelector<HTMLInputElement>('input[placeholder="Second account"]')!;
    name.value = "PvP account";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLDetailsElement>(".modal details")!.open = true;
    document.querySelectorAll<HTMLButtonElement>(".modal .icon-options button")[2]!.click();
    document.querySelectorAll<HTMLButtonElement>(".modal .color-options > button")[2]!.click();
    document.querySelector<HTMLFormElement>(".modal form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(create).toHaveBeenCalledWith({ name: "PvP account", appearance: { icon: "map", color: "#46658a" } });
  });

  it("keeps reversible account archiving inside account appearance", async () => {
    const archive = vi.fn(async () => undefined);
    const readyProfiles = fixtureSnapshot.profiles.map((profile) => ({
      ...profile,
      state: "ready" as const,
    }));
    installNative({
      state: {
        get: async () => ({ ...fixtureSnapshot, profiles: readyProfiles }),
        onChange: () => () => undefined,
      },
      profiles: { archive },
    });
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll("nav button")[1]!.trigger("click");

    expect(wrapper.text()).not.toContain("Archive");
    await wrapper.findAll(".account-appearance")[1]!.trigger("click");
    expect(document.body.textContent).toContain("Hide this account without deleting its data");
    document.querySelector<HTMLButtonElement>(".archive-account-row .archive-button")!.click();
    await flushPromises();

    expect(archive).toHaveBeenCalledWith(readyProfiles[1]!.id);
  });

  it("supports arrow-key navigation for Home tabs", async () => {
    const wrapper = mount(App);
    await wrapper.get("#news-tab").trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.get("#dailies-tab").attributes("aria-selected")).toBe("true");
    expect(wrapper.get("#dailies-tab").attributes("tabindex")).toBe("0");
  });
});
