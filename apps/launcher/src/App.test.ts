import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import App from "./App.vue";

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
});
