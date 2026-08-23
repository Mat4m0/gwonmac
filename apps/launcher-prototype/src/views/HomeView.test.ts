import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../model";
import HomeView from "./HomeView.vue";

const mountHome = (
  defaultPanel: "news" | "dailies" = "news",
  configure?: (settings: ReturnType<typeof createDefaultSettings>) => void,
) => {
  const settings = createDefaultSettings();
  settings.defaultHomePanel = defaultPanel;
  configure?.(settings);
  return mount(HomeView, {
    props: {
      scenario: "ready",
      fundingPlacement: "bar",
      fundingRaised: 42,
      fundingGoal: 125,
      settings,
    },
  });
};

describe("Home content", () => {
  it("switches from News to Dailies", async () => {
    const wrapper = mountHome();
    await wrapper.get("button[aria-pressed='false']").trigger("click");
    expect(wrapper.text()).toContain("Gate of Pain");
    expect(wrapper.text()).toContain("Next reset");
  });

  it("shows two dated daily sections before expanding to the full week", async () => {
    const wrapper = mountHome("dailies");

    expect(wrapper.findAll(".daily-day")).toHaveLength(2);
    expect(wrapper.text()).toContain("Today");
    expect(wrapper.text()).toContain("Tomorrow");

    await wrapper.get(".show-week-button").trigger("click");

    expect(wrapper.findAll(".daily-day")).toHaveLength(7);
    expect(wrapper.find(".show-week-button").exists()).toBe(false);
  });

  it("puts Dailies first and opens it when selected in settings", () => {
    const wrapper = mountHome("dailies");
    const buttons = wrapper.findAll(".home-tab-control button");
    expect(buttons[0]!.text()).toContain("Dailies");
    expect(buttons[0]!.attributes("aria-pressed")).toBe("true");
  });

  it("removes Dailies when it is disabled", () => {
    const wrapper = mountHome("dailies", (settings) => {
      settings.showDailies = false;
    });
    const buttons = wrapper.findAll(".home-tab-control button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toContain("News");
  });

  it("does not repeat the launch status in the Home side panel", () => {
    const wrapper = mountHome();
    expect(wrapper.find(".readiness-card").exists()).toBe(false);
  });
});
