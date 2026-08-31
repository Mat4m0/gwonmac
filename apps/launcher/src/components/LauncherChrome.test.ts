import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import LauncherHeader from "./LauncherHeader.vue";
import LaunchBar from "./LaunchBar.vue";
import AccountsView from "./AccountsView.vue";
import { fixtureSnapshot } from "../fixtures";

describe("launcher chrome", () => {
  it("announces the current navigation destination", async () => {
    const wrapper = mount(LauncherHeader, { props: { route: "accounts" } });
    expect(wrapper.get('button[aria-current="page"]').text()).toContain("Accounts");
    expect(wrapper.text()).not.toContain("Show introduction");
    expect(wrapper.text()).not.toContain("Unofficial client");
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    expect(wrapper.emitted("settings")).toHaveLength(1);
    await wrapper.get('button[aria-label="Open Discord"]').trigger("click");
    await wrapper.get('button[aria-label="Open GitHub"]').trigger("click");
    expect(wrapper.emitted("external")).toEqual([["discord"], ["github"]]);
  });

  it("keeps the account picker accessible and restores focus on Escape", async () => {
    const wrapper = mount(LaunchBar, {
      attachTo: document.body,
      props: { snapshot: fixtureSnapshot, selected: fixtureSnapshot.selectedProfileIds, busy: false },
    });
    const trigger = wrapper.get<HTMLButtonElement>(".account-picker");
    await trigger.trigger("click");
    expect(wrapper.get(".profile-picker").attributes("role")).toBe("group");
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(wrapper.find(".profile-picker").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("shows an already-open account directly from the picker", async () => {
    const running = {
      ...fixtureSnapshot,
      profiles: fixtureSnapshot.profiles.map((profile, index) => ({
        ...profile,
        state: index === 0 ? "running" as const : profile.state,
      })),
    };
    const wrapper = mount(LaunchBar, {
      props: { snapshot: running, selected: running.selectedProfileIds, busy: false },
    });
    await wrapper.get(".account-picker").trigger("click");
    await wrapper.get('button[aria-label="Show Main account"]').trigger("click");
    expect(wrapper.emitted("show")).toEqual([[running.profiles[0]!.id]]);
  });

  it("labels mixed selections by the number of closed accounts", () => {
    const wrapper = mount(LaunchBar, {
      props: { snapshot: fixtureSnapshot, selected: fixtureSnapshot.profiles.map((profile) => profile.id), busy: false },
    });
    expect(wrapper.get(".launch").text()).toContain("Play");
    expect(wrapper.get(".launch").text()).not.toContain("Open 2");
  });

  it("keeps global repair reachable when several selected accounts are open", () => {
    const repair = {
      ...fixtureSnapshot,
      readiness: { state: "repair-required" as const, reason: "artifact_unverified" as const },
      profiles: fixtureSnapshot.profiles.map((profile) => ({ ...profile, state: "running" as const })),
    };
    const wrapper = mount(LaunchBar, {
      props: { snapshot: repair, selected: repair.profiles.map((profile) => profile.id), busy: false },
    });
    expect(wrapper.get<HTMLButtonElement>(".launch").element.disabled).toBe(false);
    expect(wrapper.get(".launch").text()).toContain("Open Game Files");
  });

  it("does not offer another launch while the selected account is starting", () => {
    const opening = {
      ...fixtureSnapshot,
      profiles: fixtureSnapshot.profiles.map((profile, index) => ({
        ...profile,
        state: index === 0 ? "checking" as const : profile.state,
      })),
    };
    const wrapper = mount(LaunchBar, {
      props: { snapshot: opening, selected: [opening.profiles[0]!.id], busy: false },
    });

    expect(wrapper.get(".launch").text()).toContain("Checking game window");
    expect(wrapper.get<HTMLButtonElement>(".launch").element.disabled).toBe(true);
  });

  it("keeps paused background work visible without implying Tools are enabled", () => {
    const paused = {
      ...fixtureSnapshot,
      readiness: {
        state: "playable" as const,
        backgroundDownload: { status: "paused" as const },
      },
      tools: { ...fixtureSnapshot.tools, loaded: false },
    };
    const wrapper = mount(LaunchBar, {
      props: { snapshot: paused, selected: paused.selectedProfileIds, busy: false },
    });

    expect(wrapper.get(".readiness").text()).toContain("Game file download paused");
    expect(wrapper.get(".readiness").text()).toContain("resume the offline files");
    expect(wrapper.get(".readiness").text()).not.toContain("Tools are available");
  });

  it("keeps download progress and its action in the launch bar", async () => {
    const wrapper = mount(LaunchBar, {
      props: { snapshot: fixtureSnapshot, selected: fixtureSnapshot.selectedProfileIds, busy: false },
    });

    expect(wrapper.get(".readiness").text()).toContain("Downloading game files");
    expect(wrapper.get(".readiness progress").attributes("value")).toBe("92");
    await wrapper.get(".status-action").trigger("click");
    expect(wrapper.emitted("gameFiles")).toHaveLength(1);
  });

  it("keeps errors in the launch bar and makes them dismissible", async () => {
    const wrapper = mount(LaunchBar, {
      props: {
        snapshot: fixtureSnapshot,
        selected: fixtureSnapshot.selectedProfileIds,
        busy: false,
        operationError: "Guild Wars could not be opened.",
      },
    });

    expect(wrapper.get(".readiness").attributes("role")).toBe("alert");
    expect(wrapper.get(".readiness").text()).toContain("Guild Wars could not be opened.");
    await wrapper.get('button[aria-label="Dismiss error"]').trigger("click");
    expect(wrapper.emitted("dismissError")).toHaveLength(1);
  });

  it("keeps destructive and duplicate actions away from waiting accounts", () => {
    const waiting = fixtureSnapshot.profiles.map((profile, index) => ({
      ...profile,
      state: index === 1 ? "queued" as const : profile.state,
    }));
    const wrapper = mount(AccountsView, { props: { profiles: waiting } });
    const cards = wrapper.findAll(".account-card");

    expect(cards[1]!.text()).toContain("Waiting for game files");
    expect(cards[1]!.findAll("button").map((button) => button.text()))
      .toEqual(["Edit"]);
  });

  it("keeps archive out of the primary account actions", () => {
    const readyProfiles = fixtureSnapshot.profiles.map((profile) => ({
      ...profile,
      state: "ready" as const,
    }));
    const wrapper = mount(AccountsView, { props: { profiles: readyProfiles } });

    expect(wrapper.text()).not.toContain("Archive");
    expect(wrapper.findAll(".account-appearance")).toHaveLength(2);
  });
});
