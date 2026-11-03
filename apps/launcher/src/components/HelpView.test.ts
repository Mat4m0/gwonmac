import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import HelpView from "./HelpView.vue";

describe("help", () => {
  it("lists only open ArenaNet client issues, each with what players can do now", () => {
    const wrapper = mount(HelpView, { props: { send: async () => undefined } });

    expect(wrapper.findAll(".issue-card")).toHaveLength(5);
    expect(wrapper.findAll(".workaround")).toHaveLength(5);
    expect(wrapper.findAll(".issue-status").map((status) => status.text())).toEqual([
      "Reload helps",
      "Reload helps",
      "Display only",
      "Display only",
      "Minor",
    ]);
    expect(wrapper.text()).not.toContain("Resolved");
    expect(wrapper.text()).toContain("Press ⌘Q in that game window and choose Reload Guild Wars");
    expect(wrapper.text()).toContain("may not include a newly reported issue yet");
  });

  it("opens every report channel", async () => {
    const wrapper = mount(HelpView, { props: { send: async () => undefined } });

    for (const button of wrapper.findAll(".issue-help-actions button")) await button.trigger("click");

    expect(wrapper.emitted("external")).toEqual([
      ["discord"],
      ["bugReport"],
      ["arenaNetSupport"],
    ]);
    expect(wrapper.text()).toContain("If it also happens on your phone, report it to ArenaNet");
    expect(wrapper.text()).toContain("Export Recent Diagnostics");
  });

  it("confirms a report only after it was sent, and keeps the text when sending fails", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const wrapper = mount(HelpView, { props: { send } });
    const submit = () => wrapper.get<HTMLButtonElement>('.feedback-form button[type="submit"]');

    expect(submit().element.disabled).toBe(true);
    await wrapper.get("textarea").setValue("The launcher opened behind my game.");
    await wrapper.get('input[type="email"]').setValue("not-an-email");
    expect(submit().element.disabled).toBe(true);
    await wrapper.get('input[type="email"]').setValue("");

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("could not be sent");
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe("The launcher opened behind my game.");

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith({ kind: "problem", message: "The launcher opened behind my game." });
    expect(wrapper.get('[role="status"]').text()).toContain("Thanks, we got your message.");
  });
});
