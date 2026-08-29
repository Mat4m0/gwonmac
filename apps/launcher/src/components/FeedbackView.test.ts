import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import FeedbackView from "./FeedbackView.vue";

describe("feedback placeholder", () => {
  it("builds a truthful local preview without claiming a submission", async () => {
    const wrapper = mount(FeedbackView, { props: { availability: "fixture" } });
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
    await wrapper.get("textarea").setValue("The launcher opened behind my game.");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Feedback preview is ready. Nothing was sent.");
    expect(wrapper.text()).not.toContain("submitted");
  });

  it("uses support channels when the backend is unavailable", async () => {
    const wrapper = mount(FeedbackView, { props: { availability: "placeholder" } });
    await wrapper.get("button.primary").trigger("click");
    expect(wrapper.emitted("external")).toEqual([["bugReport"]]);
  });
});
