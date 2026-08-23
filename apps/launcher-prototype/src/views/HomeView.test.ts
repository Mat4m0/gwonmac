import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../model";
import HomeView from "./HomeView.vue";

const mountHome = (defaultPanel: "news" | "dailies" = "news") => {
  const settings = createDefaultSettings();
  settings.defaultHomePanel = defaultPanel;
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
});
