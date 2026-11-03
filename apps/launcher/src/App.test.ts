import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherNativeApi, LauncherSnapshot } from "@shared/launcher-contracts";
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
  it("keeps a live window-close update when the initial snapshot arrives late", async () => {
    const stale: LauncherSnapshot = {
      ...fixtureSnapshot,
      revision: 10,
      preferences: { ...fixtureSnapshot.preferences, lastPlayPage: "accounts" },
      profiles: fixtureSnapshot.profiles.map(profile => ({ ...profile, state: "running" })),
    };
    const closed: LauncherSnapshot = {
      ...stale,
      revision: 11,
      profiles: stale.profiles.map(profile => ({ ...profile, state: "ready" })),
    };
    let publish: (snapshot: LauncherSnapshot) => void = () => undefined;
    const unsubscribe = vi.fn();
    installNative({
      state: {
        onChange(listener: typeof publish) { publish = listener; return unsubscribe; },
        async get() { publish(closed); return stale; },
      },
      experience: { updatePreferences: vi.fn(async () => undefined) },
    });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get(".accounts-page").text()).toContain("0 open");
    expect(wrapper.findAll(".account-state").every(row => row.text() === "Ready")).toBe(true);
    publish(stale);
    await flushPromises();
    expect(wrapper.get(".accounts-page").text()).toContain("0 open");
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("opens the destination requested by the native application menu", async () => {
    let navigate: ((destination: "home" | "accounts") => void) | undefined;
    installNative({
      navigation: {
        onRequest(callback: (destination: "home" | "accounts") => void) {
          navigate = callback;
          return () => undefined;
        },
      },
    });
    const wrapper = mount(App);
    await flushPromises();

    navigate?.("accounts");
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".accounts-page h1").text()).toBe("Accounts");

    navigate?.("home");
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".hero-copy h1").text()).toContain("Seven skill fixes");
  });

  it("opens the Settings page from the gear and at Home from Home's Customize", async () => {
    const gear = mount(App);
    await flushPromises();
    await gear.get('button[aria-label="Settings"]').trigger("click");
    await flushPromises();
    expect(gear.find(".settings-page").exists()).toBe(true);
    gear.unmount();

    const home = mount(App);
    await flushPromises();
    await home.findAll("button").find(button => button.text() === "Customize")!.trigger("click");
    await flushPromises();
    expect(home.get(".settings-fields h1").text()).toBe("Home screen");
    home.unmount();
  });

  it("keeps support in the title bar without a funding counter and operational status only in the launch bar", () => {
    const wrapper = mount(App);

    expect(wrapper.get(".titlebar .support-pill").attributes("aria-label")).toBe("Support gwonmac on Ko-fi");
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(wrapper.get(".titlebar").text()).not.toContain("€");
    expect(wrapper.get(".launchbar").text()).toContain("Downloading game files");
    expect(wrapper.find(".priority-banner").exists()).toBe(false);
  });

  it("keeps Home focused on content and moves account management to Accounts", async () => {
    const wrapper = mount(App);
    expect(wrapper.get("h1").text()).toContain("Seven skill fixes");
    await wrapper.findAll("nav button")[1]!.trigger("click");
    expect(wrapper.get(".accounts-page h1").text()).toBe("Accounts");
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

  it("sends Help feedback through the native bridge", async () => {
    const send = vi.fn(async () => undefined);
    installNative({ feedback: { send } });
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.findAll("nav button").map((button) => button.text())).toEqual(["Home", "Accounts", "Help"]);
    await wrapper.findAll("nav button")[2]!.trigger("click");
    expect(wrapper.get(".help-page h1").text()).toBe("Known issues");
    await wrapper.get(".feedback-form textarea").setValue("Add a damage monitor.");
    await wrapper.get(".feedback-form select").setValue("idea");
    await wrapper.get(".feedback-form").trigger("submit");
    await flushPromises();
    expect(send).toHaveBeenCalledWith({ kind: "idea", message: "Add a damage monitor." });
    wrapper.unmount();
  });

  it("keeps Discord and GitHub in the global header", async () => {
    const wrapper = mount(App);

    expect(wrapper.get('.titlebar button[aria-label="Open Discord"]').attributes("title")).toBe("Discord");
    expect(wrapper.get('.titlebar button[aria-label="Open GitHub"]').attributes("title")).toBe("GitHub");
  });

  it("opens the launcher after setup and keeps Tools off unless explicitly enabled", async () => {
    let publish: (snapshot: LauncherSnapshot) => void = () => undefined;
    const completeSetup = vi.fn(async () => {
      publish({ ...fresh, revision: fresh.revision + 1, experience: { ...fresh.experience, setup: "complete" } });
    });
    const fresh = {
      ...fixtureSnapshot,
      experience: {
        ...fixtureSnapshot.experience,
        installationKind: "fresh" as const,
        setup: "pending" as const,
        showMigrationNotice: false,
      },
    };
    installNative({
      state: { get: async () => fresh, onChange(listener: typeof publish) { publish = listener; return () => undefined; } },
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
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.get(".launchbar").text()).toContain("Play");
    expect(wrapper.find(".intro-callout").exists()).toBe(false);
    wrapper.unmount();
  });

  it("uses saved news honestly when production is offline", async () => {
    installNative({
      state: {
        get: async () => ({
          ...fixtureSnapshot,
          experience: { ...fixtureSnapshot.experience, showMigrationNotice: false },
          news: { status: "offline", stories: fixtureSnapshot.news.stories },
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
    document.querySelector<HTMLButtonElement>(".archive-account-row button")!.click();
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
