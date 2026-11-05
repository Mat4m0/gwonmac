import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import HelpView from "./HelpView.vue";

describe("help", () => {
  it("lists the open ArenaNet client issues from the bundled page, each with what players can do now", () => {
    const wrapper = mount(HelpView, { props: { send: async () => undefined } });

    expect(wrapper.findAll(".issue-card").length).toBeGreaterThanOrEqual(5);
    expect(wrapper.findAll(".workaround")).toHaveLength(wrapper.findAll(".issue-card").length);
    expect(wrapper.text()).not.toContain("What you can do:");
    expect(wrapper.text()).toContain("in that game window and choose Reload Guild Wars");
    expect(wrapper.text()).toContain("may not include a newly reported issue yet");
  });

  it("follows Guide links to Settings, the browser, and other Guide pages", async () => {
    const wrapper = mount(HelpView, { props: { send: async () => undefined } });
    const link = (text: string) => wrapper.findAll(".markdown-link").find((candidate) => candidate.text() === text)!;

    await link("render scale").trigger("click");
    await link("Discord").trigger("click");
    expect(wrapper.emitted("settings")).toEqual([[{ section: "game", control: "renderScale" }]]);
    expect(wrapper.emitted("url")).toEqual([["https://discord.gg/Z9ft52RBD3"]]);

    await wrapper.findAll(".help-nav button").find((button) => button.text() === "Hub and Switch Character")!.trigger("click");
    await link("Travel and maps").trigger("click");
    expect(wrapper.get("h1").text()).toBe("Travel and maps");
  });

  it("opens every report channel", async () => {
    const wrapper = mount(HelpView, { props: { send: async () => undefined, page: "report" } });

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
    const wrapper = mount(HelpView, { props: { send, page: "report" } });
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
