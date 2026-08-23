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
    expect(wrapper.text()).toContain("Changes in");
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
