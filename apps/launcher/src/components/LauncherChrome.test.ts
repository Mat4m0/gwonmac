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
    expect(wrapper.get(".profile-picker").attributes("role")).toBe("dialog");
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(2);
    await wrapper.get(".profile-picker").trigger("keydown", { key: "Escape" });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(wrapper.find(".profile-picker").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("labels mixed selections by the number of closed accounts", () => {
    const wrapper = mount(LaunchBar, {
      props: { snapshot: fixtureSnapshot, selected: fixtureSnapshot.profiles.map((profile) => profile.id), busy: false },
    });
    expect(wrapper.get(".launch").text()).toContain("Play");
    expect(wrapper.get(".launch").text()).not.toContain("Open 2");
  });
});
