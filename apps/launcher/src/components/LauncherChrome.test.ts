import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import LauncherHeader from "./LauncherHeader.vue";
import LaunchBar from "./LaunchBar.vue";
import { fixtureSnapshot } from "../fixtures";

describe("launcher chrome", () => {
  it("announces the current navigation destination", async () => {
    const wrapper = mount(LauncherHeader, { props: { route: "accounts" } });
    expect(wrapper.get('button[aria-current="page"]').text()).toContain("Accounts");
    await wrapper.get('button[aria-label="Settings"]').trigger("click");
    expect(wrapper.emitted("settings")).toHaveLength(1);
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
      readiness: { state: "repair-required" as const, reason: "client-invalid" },
      profiles: fixtureSnapshot.profiles.map((profile) => ({ ...profile, state: "running" as const })),
    };
    const wrapper = mount(LaunchBar, {
      props: { snapshot: repair, selected: repair.profiles.map((profile) => profile.id), busy: false },
    });
    expect(wrapper.get<HTMLButtonElement>(".launch").element.disabled).toBe(false);
    expect(wrapper.get(".launch").text()).toContain("Open Game Files");
  });
});
