import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { workbench } from "./ToolsApp.test-fixture";

describe("ToolsApp build authoring", () => {
  it("authors a blank dual-profession build within the 200-point budget", async () => {
    const wrapper = await workbench();
    await wrapper.get("#builds-library-tab").trigger("click");
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

    const increase = async (name: string, times: number) => {
      const button = () => wrapper.get(`[aria-label="Increase ${name}"]`);
      for (let index = 0; index < times; index++) await button().trigger("click");
    };
    await increase("Swordsmanship", 12);
    await increase("Marksmanship", 12);
    expect(wrapper.get(".attribute-budget").text()).toContain("6 remaining");
    await increase("Strength", 3);
    expect(wrapper.get(".attribute-budget").text()).toContain("0 remaining");

    await wrapper.findAll(".authoring-bar .skill--editable")[0]!.trigger("click");
    await wrapper.get('.catalogue-workspace input[type="search"]').setValue("Barrage");
    await wrapper.get(".skill-result").trigger("click");
    await flushPromises();
    await wrapper
      .findAll(".skill-inspector .ui-button")
      .find((button) => button.text().includes("Use in slot"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".authoring-bar .skill")[0]!.attributes("title")).toBe("Barrage");
    wrapper.unmount();
  });

  it("shows the canonical catalogue description in the inline inspector", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".authoring-bar .skill--editable")[1]!.trigger("click");
    await wrapper.get('.catalogue-workspace input[type="search"]').setValue("Infuse Health");
    await wrapper.get(".skill-result").trigger("click");
    expect(wrapper.get(".skill-description").text()).toContain(
      "Infuse Health demonstrates the client-owned skill description",
    );
    expect(wrapper.find(".description-unavailable").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps an already-used catalogue skill focusable and explains the blocked action", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".authoring-bar .skill--editable")[0]!.trigger("click");
    await wrapper.get('.catalogue-workspace input[type="search"]').setValue("Aegis");
    await flushPromises();
    const result = wrapper.get<HTMLButtonElement>(".skill-result");
    expect(result.attributes("aria-disabled")).toBe("true");
    expect(result.element.disabled).toBe(false);
    await result.trigger("focus");
    expect(wrapper.get(".inspector-warning").text()).toContain("Already used in slot 3");
    await result.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.get(".bar-drag-status").text()).toContain("already used in slot 3");
    expect(wrapper.findAll(".authoring-bar .skill")[2]!.attributes("title")).toBe("Aegis");
    wrapper.unmount();
  });

  it("asks before changing a shared bar and keeps an edited fork related", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".authoring-bar .skill--editable")[0]!.trigger("click");
    await wrapper.get('.catalogue-workspace input[type="search"]').setValue("Infuse Health");
    await wrapper.get(".skill-result").trigger("click");
    await wrapper
      .findAll(".skill-inspector .ui-button")
      .find((button) => button.text().includes("Use in slot"))!
      .trigger("click");
    await wrapper
      .findAll(".authoring-actions .ui-button")
      .find((button) => button.text().includes("Save changes"))!
      .trigger("click");
    expect(wrapper.text()).toContain("This build is shared");
    await wrapper
      .findAll(".shared-commit-sheet .ui-button")
      .find((button) => button.text().includes("Fork selected"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>("#build-name").element.value).toContain("variant");
    expect(wrapper.findAll(".authoring-bar .skill")[0]!.attributes("title")).toBe("Infuse Health");
    wrapper.unmount();
  });

  it("loads a template into a draft without mutating the saved build", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".authoring-tabs button")[1]!.trigger("click");
    await wrapper.get(".adapt-section .template-code").setValue("OwAU0Kn8Q4FgMjrUgtEA3TnA");
    await wrapper
      .findAll(".adapt-section .ui-button")
      .find((button) => button.text().includes("Load into draft"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Unsaved draft");
    await wrapper
      .findAll(".authoring-actions .ui-button")
      .find((button) => button.text().includes("Discard"))!
      .trigger("click");
    expect(wrapper.text()).not.toContain("Unsaved draft");
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
    await wrapper.findAll(".authoring-tabs button")[1]!.trigger("click");
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

  // The shipped build has no certified command gateway, so Apply cannot reach
  // the game. It used to say so only *after* the click, which spends the
  // player's decision to press a primary button and reads as a broken panel
  // rather than as a capability that does not exist yet — this is the one
  // failure mode a real session actually hit.
});

