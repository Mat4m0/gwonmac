import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { unavailableParty } from "../../../src/shared/builds/live-party";
import { createDemoHost } from "./host";
import { workbench } from "./ToolsApp.test-fixture";

describe("ToolsApp shell and library", () => {
  it("loads the team library and exposes the complete team composition", async () => {
    const wrapper = await workbench();
    expect(wrapper.text()).toContain("Balanced vanquish");
    expect(wrapper.text()).toContain("Team composition");
    expect(wrapper.findAll(".team-slots > li")).toHaveLength(8);
    expect(
      wrapper.findAll(".team-controls .ui-segment button").map((button) =>
        button.text()
      ),
    ).toEqual(["Don’t change", "Normal", "Hard"]);
    expect(
      wrapper.findAll<HTMLSelectElement>(".behavior-picker select")[1]!
        .findAll("option")
        .map((option) => option.text()),
    ).toEqual(["Fight", "Guard", "Avoid"]);
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

  it("makes build lineage, usage, favourites, and catalogue labels explicit", async () => {
    const wrapper = await workbench();
    await wrapper.get("#builds-library-tab").trigger("click");
    expect(wrapper.findAll(".library-row")[0]!.text()).toContain("Mo/Me");
    expect(wrapper.findAll(".library-row")[0]!.text()).toContain("Used by 2 teams");
    expect(wrapper.findAll(".library-row")[1]!.text()).toContain(
      "Based on Word of Healing · 8 changes",
    );
    await wrapper.findAll(".library-row")[1]!.trigger("click");
    expect(wrapper.text()).toContain("1 linked team");
    expect(wrapper.findAll(".workspace-switcher [role=tab]")[1]!.text()).toBe("Skill catalogue");
    expect(wrapper.get(".favourite").text()).toBe("☆");
    wrapper.unmount();
  });

  it("implements the complete keyboard contract for library tabs", async () => {
    const wrapper = await workbench();
    const teams = wrapper.get("#teams-library-tab");
    await teams.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.get("#builds-library-tab").attributes("aria-selected")).toBe("true");
    expect(wrapper.get("#builds-library-tab").attributes("tabindex")).toBe("0");
    expect(document.activeElement?.id).toBe("builds-library-tab");
    await wrapper.get("#builds-library-tab").trigger("keydown", { key: "Home" });
    expect(wrapper.get("#teams-library-tab").attributes("aria-selected")).toBe("true");
    wrapper.unmount();
  });

  it("uses navigation rows without nested interactive skill controls", async () => {
    const wrapper = await workbench();
    await wrapper.get("#builds-library-tab").trigger("click");
    const row = wrapper.findAll(".library-row")[0]!;
    expect(row.element.tagName).toBe("BUTTON");
    expect(row.findAll("button")).toHaveLength(0);
    expect(row.findAll('.skill[role="img"]')).toHaveLength(8);
    wrapper.unmount();
  });

  it("moves focus through library navigation without changing selection", async () => {
    const wrapper = await workbench();
    const rows = wrapper.findAll<HTMLButtonElement>(".library-row");
    rows[0]!.element.focus();
    await rows[0]!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]!.element);
    expect(rows[0]!.attributes("aria-current")).toBe("page");
    expect(rows[1]!.attributes("aria-current")).toBeUndefined();
    await rows[1]!.trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(rows.at(-1)!.element);
    await rows.at(-1)!.trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(rows[0]!.element);
    wrapper.unmount();
  });

  it("distinguishes an empty active collection from filtered results", async () => {
    const host = createDemoHost();
    const load = host.loadLibrary;
    host.loadLibrary = async () => {
      const loaded = await load();
      return { ...loaded, library: { ...loaded.library, teams: [] } };
    };
    const wrapper = await workbench(host);

    expect(wrapper.text()).toContain("No saved teams yet");
    expect(wrapper.text()).not.toContain("No matches");
    expect(wrapper.text()).not.toContain("Clear filters");
    expect(wrapper.get(".library-summary").text()).toContain("0 teams");

    await wrapper.get("#builds-library-tab").trigger("click");
    await wrapper.get('input[type="search"]').setValue("not in this library");
    expect(wrapper.text()).toContain("No matches");
    expect(wrapper.text()).toContain("0 of 8 builds");
    expect(wrapper.text()).toContain("Clear filters");
    wrapper.unmount();
  });

  it("leads with capture when a party is visible and creation when it is not", async () => {
    const observed = await workbench();
    expect(observed.get(".live-party [data-variant=primary]").text()).toContain(
      "Save as new team",
    );
    expect(observed.find(".create-actions [data-variant=primary]").exists()).toBe(false);
    observed.unmount();

    const host = createDemoHost();
    host.party.value = unavailableParty();
    const unavailable = await workbench(host);
    expect(unavailable.find(".live-party [data-variant=primary]").exists()).toBe(false);
    expect(unavailable.get(".create-actions [data-variant=primary]").text()).toContain("New team");
    unavailable.unmount();
  });

  it("focuses modal work, traps it, and restores the invoking control", async () => {
    const wrapper = await workbench();
    const trigger = wrapper
      .findAll(".create-actions .ui-button")
      .find((button) => button.text().includes("New team"))!;
    (trigger.element as HTMLElement).focus();
    await trigger.trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get(".composer-dialog .ui-input").element);

    const buttons = wrapper.findAll<HTMLButtonElement>(".composer-dialog button");
    buttons.at(-1)!.element.focus();
    await buttons.at(-1)!.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]!.element);
    await wrapper
      .findAll(".composer-dialog .ui-button")
      .find((button) => button.text() === "Cancel")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find(".composer-dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("protects an unsaved build when the host requests that Tools close", async () => {
    const wrapper = await workbench();
    await wrapper.get("#builds-library-tab").trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.get("#build-name").setValue("Unsaved keyboard draft");

    (wrapper.vm as unknown as { requestClose(): void }).requestClose();
    await flushPromises();
    expect(wrapper.text()).toContain("Save this draft?");
    expect(wrapper.emitted("close")).toBeUndefined();

    await wrapper
      .findAll(".leave-dialog .ui-button")
      .find((button) => button.text() === "Discard changes")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("forks a selected build and keeps the operation undoable", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".authoring-tabs button")[1]!.trigger("click");
    await wrapper
      .findAll(".details-danger-zone .ui-button")
      .find((button) => button.text().includes("Fork independent"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Word of Healing — variant");
    expect(wrapper.get(".library-summary .ui-link").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("keeps build deletion confirmation in the visible action footer", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    const before = wrapper.findAll(".library-row").length;
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper.findAll(".authoring-tabs button")[1]!.trigger("click");
    await wrapper.get('.details-danger-zone .ui-link[data-variant="danger"]')
      .trigger("click");
    expect(wrapper.get(".detail-actions.delete-confirmation").text()).toContain(
      "variants are kept",
    );
    await wrapper.get('.detail-actions.delete-confirmation .ui-button[data-variant="danger"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".library-row")).toHaveLength(before - 1);
    wrapper.unmount();
  });

  it("exports a build code and writes it through the host capability", async () => {
    let copied = "";
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      writeClipboard: async (text) => { copied = text; },
    });
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper
      .findAll(".authoring-actions .ui-button")
      .find((button) => button.text().includes("Export build"))!
      .trigger("click");
    await flushPromises();
    const code = wrapper.get<HTMLTextAreaElement>(".build-export textarea").element.value;
    expect(code).toMatch(/^O/u);
    expect(document.activeElement).toBe(wrapper.get(".build-export textarea").element);
    await wrapper
      .findAll(".build-export .ui-button")
      .find((button) => button.text().includes("Copy code"))!
      .trigger("click");
    await flushPromises();
    expect(copied).toBe(code);
    expect(wrapper.text()).toContain("Build code copied.");
    await wrapper
      .findAll(".build-export .ui-button")
      .find((button) => button.text().includes("Save to Guild Wars"))!
      .trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(wrapper.text()).toContain("Template written:");
    expect(wrapper.text()).toContain("Load Template");
    wrapper.unmount();
  });

  it("keeps export available while explaining unavailable in-game publication", async () => {
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      publishUnavailable:
        "GWonMac can’t add this build to Guild Wars after this game update.",
      publishBuild: async () => {
        throw new Error("unreachable publication");
      },
    });
    await wrapper.get("#builds-library-tab").trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper
      .findAll(".authoring-actions .ui-button")
      .find((button) => button.text().includes("Export build"))!
      .trigger("click");
    await flushPromises();

    const save = wrapper
      .findAll(".build-export .ui-button")
      .find((button) => button.text().includes("Save to Guild Wars"))!;
    expect(save.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(
      "GWonMac can’t add this build to Guild Wars after this game update.",
    );
    expect(wrapper.find(".build-export textarea").exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps build export selectable when clipboard access is refused", async () => {
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      writeClipboard: async () => { throw new Error("clipboard denied"); },
    });
    await wrapper.get("#builds-library-tab").trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper
      .findAll(".authoring-actions .ui-button")
      .find((button) => button.text() === "Export build")!
      .trigger("click");
    await flushPromises();
    const textarea = wrapper.get<HTMLTextAreaElement>(".build-export textarea");
    const code = textarea.element.value;
    await wrapper
      .findAll(".build-export .ui-button")
      .find((button) => button.text() === "Copy code")!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get(".build-export [role=alert]").text()).toContain("Select and copy");
    expect(textarea.element.value).toBe(code);
    expect(document.activeElement).toBe(textarea.element);
    wrapper.unmount();
  });

  it("imports a real client template and creates a team from an empty action", async () => {
    const wrapper = await workbench();
    await wrapper.get("#builds-library-tab").trigger("click");
    await wrapper.get(".create-actions [data-variant=primary]").trigger("click");
    await wrapper.get(".template-code").setValue("OwAU0Kn8Q4FgMjrUgtEA3TnA");
    await wrapper.get(".composer-dialog form, .composer-dialog").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Build imported");

    await wrapper.get("#teams-library-tab").trigger("click");
    await wrapper
      .findAll(".create-actions .ui-button")
      .find((button) => button.text().includes("New team"))!
      .trigger("click");
    await wrapper.get(".composer-dialog input").setValue("Fresh account team");
    await wrapper.get(".composer-dialog form, .composer-dialog").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Fresh account team");
    expect(wrapper.findAll(".team-slots > li")).toHaveLength(8);
    expect(
      wrapper
        .findAll(".team-controls .ui-segment button")
        .find((button) => button.text() === "Normal")!
        .attributes("aria-pressed"),
    ).toBe("true");
    wrapper.unmount();
  });
});
