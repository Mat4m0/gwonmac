import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolsApp from "./ToolsApp.vue";
import { createDemoHost } from "./host";

async function workbench() {
  const wrapper = mount(ToolsApp, {
    attachTo: document.body,
    props: {
      host: createDemoHost(),
      mode: "standalone",
      visible: true,
    },
  });
  await flushPromises();
  return wrapper;
}

describe("ToolsApp", () => {
  it("loads the team library and exposes the complete team composition", async () => {
    const wrapper = await workbench();
    expect(wrapper.text()).toContain("Balanced vanquish");
    expect(wrapper.text()).toContain("Team composition");
    expect(wrapper.findAll(".team-slots > li")).toHaveLength(8);
    wrapper.unmount();
  });

  it("switches to builds and searches by skill name", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.get('input[type="search"]').setValue("Barrage");
    expect(wrapper.findAll(".library-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Splinter Barrage");
    wrapper.unmount();
  });

  it("forks a selected build and keeps the operation undoable", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.get(".detail-actions .ui-button").trigger("click");
    expect(wrapper.text()).toContain("Fork a linked variant");
    await wrapper
      .findAll(".inline-action .ui-button")
      .find((button) => button.text().includes("Create variant"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Word of Healing — variant");
    expect(wrapper.get(".library-summary .ui-link").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("publishes through the host capability and explains the player-owned next step", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.get("[data-variant=primary]").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(wrapper.text()).toContain("Load it from Guild Wars");
    wrapper.unmount();
  });
});
