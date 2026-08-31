import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import KnownIssuesView from "./KnownIssuesView.vue";

describe("known issues", () => {
  it("lists each issue with its status and current workaround", () => {
    const wrapper = mount(KnownIssuesView, { props: { availability: "fixture" } });

    expect(wrapper.findAll(".issue-card")).toHaveLength(3);
    expect(wrapper.text()).toContain("Some textures appear black or missing");
    expect(wrapper.text()).toContain("Memory use can grow during long sessions");
    expect(wrapper.findAll(".workaround")).toHaveLength(2);
    expect(wrapper.findAll(".issue-status").map((status) => status.text())).toEqual([
      "Workaround available",
      "Workaround available",
      "Resolved",
    ]);
  });

  it("separates official-client reports from macOS-only reports", async () => {
    const wrapper = mount(KnownIssuesView, { props: { availability: "placeholder" } });
    const buttons = wrapper.findAll(".issue-help-actions button");

    await buttons[0]!.trigger("click");
    await buttons[1]!.trigger("click");
    await buttons[2]!.trigger("click");

    expect(wrapper.emitted("external")).toEqual([
      ["arenaNetSupport"],
      ["discord"],
      ["bugReport"],
    ]);
    expect(wrapper.text()).toContain("If it also happens on your phone, report it to ArenaNet");
    expect(wrapper.text()).toContain("may not include a newly reported issue yet");
  });
});
