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
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Fork variant"))!
      .trigger("click");
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
    await wrapper.get(".bar-section [data-variant=primary]").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(wrapper.text()).toContain("Load it from Guild Wars");
    wrapper.unmount();
  });

  it("imports a real client template and creates a team from an empty action", async () => {
    const wrapper = await workbench();
    await wrapper.get(".create-actions [data-variant=primary]").trigger("click");
    await wrapper.get(".template-code").setValue("OwAU0Kn8Q4FgMjrUgtEA3TnA");
    await wrapper.get(".composer-dialog form, .composer-dialog").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Build imported");

    await wrapper.get(".create-actions .ui-button:nth-child(2)").trigger("click");
    await wrapper.get(".composer-dialog input").setValue("Fresh account team");
    await wrapper.get(".composer-dialog form, .composer-dialog").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Fresh account team");
    expect(wrapper.findAll(".team-slots > li")).toHaveLength(8);
    wrapper.unmount();
  });

  it("authors a blank dual-profession build within the 200-point budget", async () => {
    const wrapper = await workbench();
    await wrapper.get(".create-actions [data-variant=primary]").trigger("click");
    await wrapper
      .findAll(".composer-dialog .ui-button")
      .find((button) => button.text().includes("Start blank"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>("#build-name").element.value).toBe("New build");
    const professions = wrapper.findAll<HTMLSelectElement>(".profession-editor select");
    await professions[1]!.setValue("R");
    await flushPromises();
    expect(wrapper.text()).toContain("Marksmanship");
    expect(wrapper.text()).not.toContain("Expertise");

    const rank = (name: string) =>
      wrapper.get<HTMLSelectElement>(`.rank-select[aria-label="${name} rank"]`);
    await rank("Swordsmanship").setValue("12");
    await flushPromises();
    await rank("Marksmanship").setValue("12");
    await flushPromises();
    expect(wrapper.get(".attribute-budget strong").text()).toBe("6");
    await rank("Strength").setValue("3");
    await flushPromises();
    expect(wrapper.get(".attribute-budget strong").text()).toBe("0");

    await wrapper.findAll(".bar-section .skill--editable")[0]!.trigger("click");
    await wrapper.get('.skill-picker input[type="search"]').setValue("Barrage");
    await wrapper.get(".skill-choice").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".skill-list strong")[0]!.text()).toBe("Barrage");
    wrapper.unmount();
  });

  it("asks before changing a shared bar and keeps an edited fork related", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".bar-section .skill--editable")[0]!.trigger("click");
    await wrapper.get('.skill-picker input[type="search"]').setValue("Aegis");
    await wrapper.get(".skill-choice").trigger("click");
    expect(wrapper.text()).toContain("This build is shared");

    await wrapper
      .findAll(".shared-edit-dialog .ui-button")
      .find((button) => button.text().includes("Fork selected"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Variant of");
    expect(wrapper.text()).toContain("Aegis");
    wrapper.unmount();
  });

  it("assigns heroes and persists the controls that belong to a team slot", async () => {
    const wrapper = await workbench();
    const hero = wrapper.findAll<HTMLSelectElement>(".hero-picker select")[0]!;
    await hero.setValue("6");
    await flushPromises();
    expect(hero.element.value).toBe("6");
    expect(wrapper.text()).toContain("Koss");

    await wrapper.findAll(".slot-settings")[0]!.trigger("click");
    const panel = wrapper.get<HTMLInputElement>(".slot-options .ui-check input");
    expect(panel.element.checked).toBe(true);
    await panel.setValue(false);
    await flushPromises();

    const firstSkill = wrapper.findAll(".disabled-skills button")[0]!;
    expect(firstSkill.attributes("aria-pressed")).toBe("true");
    await firstSkill.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".disabled-skills button")[0]!.attributes("aria-pressed")).toBe("false");
    wrapper.unmount();
  });

  it("adapts a shared build as a linked variant and moves only the chosen team", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Adapt from code"))!
      .trigger("click");
    await wrapper.get(".inline-action .template-code").setValue("OwAU0Kn8Q4FgMjrUgtEA3TnA");
    await wrapper
      .findAll(".inline-action .ui-button")
      .find((button) => button.text().includes("Create adapted variant"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Word of Healing — variant");
    expect(wrapper.text()).toContain("Variant of");
    expect(wrapper.text()).toContain("Skill 288");
    wrapper.unmount();
  });

  it("prepares every configured team slot and reports the player-owned load step", async () => {
    const wrapper = await workbench();
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Prepare team handoff"))!
      .trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await flushPromises();

    expect(wrapper.findAll(".handoff-sheet li")).toHaveLength(8);
    expect(wrapper.findAll('.handoff-sheet li[data-status="saved"]')).toHaveLength(8);
    expect(wrapper.text()).toContain("Load");
    expect(wrapper.text()).toContain("Nothing was applied automatically");
    wrapper.unmount();
  });

  it("deletes only the team composition and can undo the deletion", async () => {
    const wrapper = await workbench();
    const before = wrapper.findAll(".library-row").length;
    await wrapper.get('.detail-actions .ui-link[data-variant="danger"]').trigger("click");
    await wrapper
      .findAll(".inline-action--danger .ui-button")
      .find((button) => button.text().includes("Delete team"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".library-row")).toHaveLength(before - 1);

    await wrapper.get(".library-summary .ui-link").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".library-row")).toHaveLength(before);
    wrapper.unmount();
  });

  it("edits the shared tag vocabulary from either detail view", async () => {
    const wrapper = await workbench();
    const input = wrapper.get<HTMLInputElement>('.tag-editor input[placeholder="+ tag"]');
    await input.setValue("farm");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.text()).toContain("farm");
    expect(
      wrapper.findAll(".tag-filters .ui-chip").some((chip) => chip.text().includes("farm")),
    ).toBe(true);

    await wrapper.get('[aria-label="Remove farm tag"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[aria-label="Remove farm tag"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("merges a winning variant back into its original and keeps undo", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    const before = wrapper.findAll(".library-row").length;
    await wrapper.findAll(".library-row")[1]!.trigger("click");
    await wrapper.get(".lineage-actions .ui-link").trigger("click");
    await wrapper
      .findAll(".inline-action .ui-button")
      .find((button) => button.text().includes("Merge variant"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>("#build-name").element.value).toBe("Word of Healing");
    expect(wrapper.findAll(".library-row")).toHaveLength(before - 1);

    await wrapper.get(".library-summary .ui-link").trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>("#build-name").element.value).toContain("Aegis");
    expect(wrapper.findAll(".library-row")).toHaveLength(before);
    wrapper.unmount();
  });
});
