import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  heroId,
  mapTeamSlots,
} from "../../../src/shared/builds/library";
import {
  liveParty,
  unavailableParty,
} from "../../../src/shared/builds/live-party";
import type { TeamApplyResult } from "../../../src/shared/builds/team-apply";
import ToolsApp from "./ToolsApp.vue";
import { createDemoHost, type ToolsHost } from "./host";

async function workbench(host: ToolsHost = createDemoHost()) {
  const wrapper = mount(ToolsApp, {
    attachTo: document.body,
    props: {
      host,
      mode: "standalone",
      visible: true,
    },
  });
  await flushPromises();
  return wrapper;
}

function applicableHost(
  applyTeam: ToolsHost["applyTeam"],
  mode: "normal" | "hard" = "hard",
): ToolsHost {
  const demo = createDemoHost();
  demo.party.value = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 1,
    firstHeroId: 21,
    firstHeroAgentId: 11,
    party: {
      status: "ready",
      rosterObserved: true,
      playRegion: "pve",
      hardMode: false,
      inOutpost: true,
      slotCount: 1,
      slots: [
        {
          index: 0, occupied: true, hero: null, agentId: 10, level: 20,
          professions: [1, 0], behaviour: null,
          skills: [0, 0, 0, 0, 0, 0, 0, 0], disabled: 0,
          attributes: [],
        },
        {
          index: 1, occupied: true, hero: 21, agentId: 11, level: 20,
          professions: [4, 8], behaviour: 1,
          skills: [208, 209, 210, 211, 212, 213, 214, 215], disabled: 0,
          attributes: [[5, 12], [6, 10]],
        },
      ],
    },
  });
  return {
    ...demo,
    async loadLibrary() {
      const loaded = await demo.loadLibrary();
      return {
        ...loaded,
        library: {
          ...loaded.library,
          teams: loaded.library.teams.map((team, teamIndex) => teamIndex === 0
            ? {
                ...team,
                mode,
                slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 0
                  ? { ...slot, build: null }
                  : slotIndex === 1
                    ? slot
                  : {
                      ...slot,
                      hero: null,
                      build: null,
                      behaviour: null,
                    }),
              }
            : team),
        },
      };
    },
    applyTeam,
  };
}

describe("ToolsApp", () => {
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

  it("assigns heroes and persists their selected build", async () => {
    const wrapper = await workbench();
    const hero = wrapper.findAll<HTMLSelectElement>(".hero-picker select")[0]!;
    await hero.setValue("6");
    await flushPromises();
    expect(wrapper.findAll<HTMLSelectElement>(".hero-picker select")[0]!.element.value).toBe("6");
    expect(wrapper.text()).toContain("Koss");

    const build = wrapper.findAll<HTMLSelectElement>(".build-picker select")[1]!;
    const alternative = build.findAll("option").find(
      (option) => option.attributes("value") && option.attributes("value") !== build.element.value,
    );
    await build.setValue(alternative!.attributes("value"));
    await flushPromises();
    expect(build.element.value).toBe(alternative!.attributes("value"));
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

  it("blocks Apply when a hero has a player-only skill", async () => {
    const wrapper = await workbench();
    await wrapper.findAll<HTMLSelectElement>(".build-picker select")[0]!
      .setValue("");
    await wrapper
      .findAll(".team-controls .ui-segment button")
      .find((button) => button.text() === "Normal")!
      .trigger("click");
    await flushPromises();
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    expect(apply.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("skills this member cannot equip");
    expect(wrapper.find(".handoff-sheet").exists()).toBe(false);
    wrapper.unmount();
  });

  it("explains reciprocal profession mistakes and repairs them in one action", async () => {
    const host = applicableHost(
      async () => ({ commandId: 1, completedChanges: 2, skippedSkills: [] }),
    );
    host.party.value = liveParty({
      status: "ready",
      partyObserved: true,
      heroAvailable: true,
      heroCount: 1,
      firstHeroId: 39,
      firstHeroAgentId: 11,
      party: {
        status: "ready",
        rosterObserved: true,
        playRegion: "pve",
        hardMode: false,
        inOutpost: true,
        slotCount: 1,
        slots: [
          {
            index: 0, occupied: true, hero: null, agentId: 10, level: 20,
            professions: [5, 3], behaviour: null,
            skills: [0, 0, 0, 0, 0, 0, 0, 0], disabled: 0,
            attributes: [],
          },
          {
            index: 1, occupied: true, hero: 39, agentId: 11, level: 20,
            professions: [3, 5], behaviour: 1,
            skills: [0, 0, 0, 0, 0, 0, 0, 0], disabled: 0,
            attributes: [],
          },
        ],
      },
    });
    const baseLoad = host.loadLibrary;
    host.loadLibrary = async () => {
      const loaded = await baseLoad();
      return {
        ...loaded,
        library: {
          ...loaded.library,
          teams: loaded.library.teams.map((team, teamIndex) => teamIndex === 0
            ? {
                ...team,
                mode: "normal" as const,
                slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 0
                  ? { ...slot, build: "b-woh" as typeof slot.build }
                  : slotIndex === 1
                    ? {
                        ...slot,
                        hero: 39 as typeof slot.hero,
                        build: "b-dom" as typeof slot.build,
                        behaviour: "guard" as const,
                      }
                    : { ...slot, hero: null, build: null, behaviour: null }),
              }
            : team),
        },
      };
    };

    const wrapper = await workbench(host);
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;
    expect(apply.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".apply-readiness").text()).toContain(
      "Your assigned build is for Mo, but the observed primary is Me.",
    );
    expect(wrapper.get(".apply-readiness").text()).toContain(
      "Ghost Of Althea's assigned build is for Me, but the observed primary is Mo.",
    );
    expect(wrapper.findAll(".team-slots > li[data-invalid]")).toHaveLength(2);

    await wrapper
      .findAll(".apply-issue-list .ui-link")
      .find((button) => button.text().includes("Review You"))!
      .trigger("click");
    expect(document.activeElement?.id).toBe("team-build-0");

    await wrapper
      .findAll(".apply-readiness .ui-button")
      .find((button) => button.text().includes("Swap the mismatched builds"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.find(".apply-readiness").exists()).toBe(false);
    expect(wrapper.get<HTMLSelectElement>("#team-build-0").element.value).toBe("b-dom");
    expect(wrapper.get<HTMLSelectElement>("#team-build-1").element.value).toBe("b-woh");
    expect(apply.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("names the exact capture gap immediately and keeps it in team notes", async () => {
    const host = createDemoHost();
    host.party.value = liveParty({
      status: "ready",
      partyObserved: true,
      heroAvailable: true,
      heroCount: 1,
      firstHeroId: 39,
      firstHeroAgentId: 11,
      party: {
        status: "ready",
        rosterObserved: true,
        playRegion: "pve",
        hardMode: false,
        inOutpost: true,
        slotCount: 1,
        slots: [
          {
            index: 0, occupied: true, hero: null, agentId: 10, level: 20,
            professions: null, behaviour: null,
            skills: [281, 288, 299, 258, 296, 247, 301, 314], disabled: 0,
            attributes: [[13, 12]],
          },
          {
            index: 1, occupied: true, hero: 39, agentId: 11, level: 20,
            professions: [5, 3], behaviour: 1,
            skills: [216, 217, 218, 219, 220, 221, 222, 223], disabled: 0,
            attributes: [[0, 12]],
          },
        ],
      },
    });
    const load = host.loadLibrary;
    host.loadLibrary = async () => {
      const loaded = await load();
      return {
        ...loaded,
        library: {
          ...loaded.library,
          teams: loaded.library.teams.map((team, index) =>
            index === 0 ? { ...team, name: "Saved party" } : team
          ),
        },
      };
    };
    const wrapper = await workbench(host);
    await wrapper
      .findAll(".live-party .ui-button")
      .find((button) => button.text().includes("Save as new team"))!
      .trigger("click");
    await flushPromises();

    const gap = "Your own build was not saved: the player's professions were not observed.";
    expect(wrapper.get(".notice").text()).toContain(gap);
    expect(wrapper.get<HTMLTextAreaElement>("#team-notes").element.value).toContain(gap);
    const name = wrapper.get<HTMLInputElement>("#team-name");
    expect(name.element.value).toBe("Saved party (2)");
    expect(document.activeElement).toBe(name.element);
    expect(name.element.selectionStart).toBe(0);
    expect(name.element.selectionEnd).toBe(name.element.value.length);
    wrapper.unmount();
  });

  it("saves an observed solo player as a team", async () => {
    const host = applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    );
    host.party.value = {
      ...host.party.value,
      heroCount: 0,
      heroes: [],
      partial: false,
    };
    const wrapper = await workbench(host);
    expect(wrapper.get(".live-party [data-variant=primary]").text()).toBe(
      "Save as new team",
    );
    await wrapper.get(".live-party [data-variant=primary]").trigger("click");
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>("#team-name").element.value).toBe("Saved party");
    expect(wrapper.get(".title-editor p").text()).toContain("1 of 8 slots configured");
    wrapper.unmount();
  });

  it("groups player choices and disables deterministic hero mismatches", async () => {
    const wrapper = await workbench(applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    ));
    const player = wrapper.get<HTMLSelectElement>("#team-build-0");
    const hero = wrapper.get<HTMLSelectElement>("#team-build-1");

    expect(player.findAll("optgroup").map((group) => group.attributes("label"))).toContain(
      "Other player professions",
    );
    const otherPlayerOption = player.findAll("option").find((option) =>
      option.text().includes("Word of Healing")
    )!;
    expect(otherPlayerOption.attributes("disabled")).toBeUndefined();

    const compatible = hero.findAll("optgroup").find(
      (group) => group.attributes("label") === "Compatible builds",
    )!;
    expect(compatible.text()).toContain("Discord Necro");
    const mismatch = hero.findAll("option").find((option) =>
      option.text().includes("Word of Healing")
    )!;
    expect(mismatch.attributes("disabled")).toBeDefined();
    expect(mismatch.text()).toContain("requires Necromancer primary");
    wrapper.unmount();
  });

  it("keeps unknown builds selectable and hides locked heroes until requested", async () => {
    const host = applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    );
    host.party.value = {
      ...host.party.value,
      accountHeroes: new Map([
        [heroId(24), { availability: "locked" as const, professions: ["Me", "Rt"] as const }],
      ]),
    };
    const load = host.loadLibrary;
    host.loadLibrary = async () => {
      const loaded = await load();
      return {
        ...loaded,
        library: {
          ...loaded.library,
          teams: loaded.library.teams.map((team, teamIndex) => teamIndex === 0
            ? {
                ...team,
                slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 2
                  ? { ...slot, hero: heroId(24), build: null, behaviour: "guard" as const }
                  : slot),
              }
            : team),
        },
      };
    };
    const wrapper = await workbench(host);
    const assigned = wrapper.get<HTMLSelectElement>("#team-hero-2");
    const assignedGwen = assigned.findAll("option").find(
      (option) => option.text().includes("Gwen"),
    )!;
    expect(assigned.element.value).toBe("24");
    expect(assignedGwen.text()).toContain("unavailable");
    expect(assignedGwen.attributes("disabled")).toBeDefined();

    const heroSelect = wrapper.get<HTMLSelectElement>("#team-hero-3");
    expect(heroSelect.text()).not.toContain("Gwen");

    await wrapper.get(".show-locked-heroes input").setValue(true);
    const locked = heroSelect.findAll("option").find((option) => option.text().includes("Gwen"))!;
    expect(locked.text()).toContain("unavailable");
    expect(locked.attributes("disabled")).toBeDefined();

    await heroSelect.setValue("4");
    const unknownHeroBuilds = wrapper.get<HTMLSelectElement>("#team-build-3");
    expect(unknownHeroBuilds.findAll("optgroup").map(
      (group) => group.attributes("label"),
    )).toContain("Available builds");
    const unknownChoice = unknownHeroBuilds.findAll("option").find(
      (option) => option.text().includes("Word of Healing"),
    )!;
    expect(unknownChoice.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("keeps eight positions while compacting and expanding unused hero slots", async () => {
    const wrapper = await workbench(applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    ));
    expect(wrapper.findAll(".team-slots > li")).toHaveLength(8);
    expect(wrapper.findAll(".team-slot--compact")).toHaveLength(6);
    expect(wrapper.findAll(".available-slot")).toHaveLength(6);

    await wrapper.get<HTMLSelectElement>("#team-hero-2").setValue("24");
    await flushPromises();
    expect(wrapper.findAll(".team-slot--compact")).toHaveLength(5);
    expect(wrapper.get<HTMLSelectElement>("#team-build-2").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("shows shared-build guidance only when another team uses an assignment", async () => {
    const shared = await workbench();
    expect(shared.get(".detail-view .ui-banner").text()).toContain(
      "shared with another team",
    );
    shared.unmount();

    const host = applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    );
    const load = host.loadLibrary;
    host.loadLibrary = async () => {
      const loaded = await load();
      return {
        ...loaded,
        library: {
          ...loaded.library,
          teams: loaded.library.teams.map((team, teamIndex) => teamIndex === 0
            ? {
                ...team,
                slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 1
                  ? { ...slot, build: "b-discord-rot" as typeof slot.build }
                  : slot),
              }
            : team),
        },
      };
    };
    const unshared = await workbench(host);
    expect(unshared.find(".detail-view .ui-banner").exists()).toBe(false);
    unshared.unmount();
  });

  it("restores a changed assignment when persistence fails", async () => {
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      saveLibrary: async () => { throw new Error("disk busy"); },
    });
    const select = wrapper.get<HTMLSelectElement>("#team-build-0");
    const before = select.element.value;
    const alternative = select.findAll("option").find(
      (option) => option.attributes("value") && option.attributes("value") !== before,
    )!;
    await select.setValue(alternative.attributes("value"));
    await flushPromises();

    expect(select.element.value).toBe(before);
    expect(wrapper.get(".notice").text()).toContain("Nothing changed");
    wrapper.unmount();
  });

  it("runs the production Apply path once and reports actual changes", async () => {
    let finish!: (result: TeamApplyResult) => void;
    const pending = new Promise<TeamApplyResult>((resolve) => {
      finish = resolve;
    });
    const plans: unknown[] = [];
    const wrapper = await workbench(applicableHost(async (plan) => {
      plans.push(plan);
      return pending;
    }));
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    await apply.trigger("click");
    await flushPromises();
    expect(plans).toHaveLength(1);
    expect(apply.text()).toBe("Applying…");
    expect(apply.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".team-editor").attributes("disabled")).toBeDefined();
    await apply.trigger("click");
    expect(plans).toHaveLength(1);

    finish({ commandId: 7, completedChanges: 3, skippedSkills: [] });
    await flushPromises();
    expect(wrapper.text()).toContain("Team applied · 3 confirmed changes.");
    wrapper.unmount();
  });

  it("explains when Guild Wars omitted unavailable skills", async () => {
    const wrapper = await workbench(applicableHost(async () => ({
      commandId: 8,
      completedChanges: 1,
      skippedSkills: [354],
    })));
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get(".apply-status").attributes("data-tone")).toBe("warning");
    expect(wrapper.text()).toContain("Team applied with skipped skills · 1 confirmed change.");
    expect(wrapper.text()).toContain("Guild Wars did not equip #354");
    wrapper.unmount();
  });

  it("names the affected member when Apply skips a requested skill", async () => {
    const wrapper = await workbench(applicableHost(async () => ({
      commandId: 9,
      completedChanges: 1,
      skippedSkills: [208],
    })));
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get(".apply-status").attributes("data-tone")).toBe("warning");
    expect(wrapper.get(".apply-details").text()).toContain("Livia");
    expect(wrapper.get(".apply-details").text()).toContain("Discord");
    wrapper.unmount();
  });

  it("keeps errors until dismissal while successful notices expire", async () => {
    vi.useFakeTimers();
    try {
      const demo = createDemoHost();
      const wrapper = await workbench({
        ...demo,
        saveLibrary: async () => { throw new Error("disk busy"); },
      });
      await wrapper
        .findAll(".team-controls .ui-segment button")
        .find((button) => button.text() === "Normal")!
        .trigger("click");
      await flushPromises();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(wrapper.get(".notice").text()).toContain("Nothing changed");
      await wrapper.get(".notice-dismiss").trigger("click");
      expect(wrapper.find(".notice").exists()).toBe(false);
      wrapper.unmount();

      const successful = await workbench();
      await successful
        .findAll(".team-controls .ui-segment button")
        .find((button) => button.text() === "Normal")!
        .trigger("click");
      await flushPromises();
      expect(successful.find(".notice").exists()).toBe(true);
      await vi.advanceTimersByTimeAsync(4_500);
      expect(successful.find(".notice").exists()).toBe(false);
      successful.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an authoritative Apply failure without changing the library", async () => {
    const wrapper = await workbench(applicableHost(async () => {
      throw new Error("Team management is available only in a PvE outpost.");
    }));
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Team management is available only in a PvE outpost.",
    );
    expect(wrapper.text()).not.toContain("Team applied ·");
    wrapper.unmount();
  });

  it("deletes only the team composition and can undo the deletion", async () => {
    const wrapper = await workbench();
    const before = wrapper.findAll(".library-row").length;
    await wrapper.get('.detail-actions .ui-link[data-variant="danger"]').trigger("click");
    expect(wrapper.get(".detail-actions.delete-confirmation").text()).toContain(
      "Shared builds are always kept",
    );
    await wrapper
      .findAll(".detail-actions.delete-confirmation .ui-button")
      .find((button) => button.text().includes("Team only"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".library-row")).toHaveLength(before - 1);

    await wrapper.get(".library-summary .ui-link").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".library-row")).toHaveLength(before);
    wrapper.unmount();
  });

  it("keeps a destructive confirmation and selection unchanged when persistence fails", async () => {
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      saveLibrary: async () => { throw new Error("disk busy"); },
    });
    const selectedName = wrapper.get<HTMLInputElement>("#team-name").element.value;
    await wrapper.get('.detail-actions .ui-link[data-variant="danger"]').trigger("click");
    await wrapper
      .findAll(".detail-actions.delete-confirmation .ui-button")
      .find((button) => button.text().includes("Team only"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>("#team-name").element.value).toBe(selectedName);
    expect(wrapper.find(".detail-actions.delete-confirmation").exists()).toBe(true);
    expect(wrapper.get(".notice").text()).toContain("Nothing changed");
    expect(wrapper.get(".library-summary .ui-link").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("keeps an import dialog open when its transaction cannot be stored", async () => {
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      saveLibrary: async () => { throw new Error("disk busy"); },
    });
    await wrapper.get("#builds-library-tab").trigger("click");
    await wrapper.get(".create-actions [data-variant=primary]").trigger("click");
    await wrapper.get(".template-code").setValue("OwAU0Kn8Q4FgMjrUgtEA3TnA");
    await wrapper.get(".composer-dialog form, .composer-dialog").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".composer-dialog").exists()).toBe(true);
    expect(wrapper.get<HTMLTextAreaElement>(".template-code").element.value)
      .toBe("OwAU0Kn8Q4FgMjrUgtEA3TnA");
    expect(wrapper.get(".notice").text()).toContain("Nothing changed");
    wrapper.unmount();
  });

  it("keeps manual team-code import available when clipboard access is refused", async () => {
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      readClipboard: async () => { throw new Error("clipboard denied"); },
    });
    await wrapper
      .findAll(".create-actions .ui-button")
      .find((button) => button.text() === "Import team")!
      .trigger("click");
    await wrapper
      .findAll(".composer-dialog .ui-button")
      .find((button) => button.text().includes("Paste from Clipboard"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get("[role=alert]").text()).toContain("Paste the code");
    expect(wrapper.get<HTMLTextAreaElement>(".template-code").element.disabled).toBe(false);
    expect(wrapper.find(".composer-dialog").exists()).toBe(true);
    wrapper.unmount();
  });

  it("confirms a copied team code and keeps the manual fallback visible", async () => {
    let copied = "";
    const demo = createDemoHost();
    const wrapper = await workbench({
      ...demo,
      writeClipboard: async (text) => { copied = text; },
    });
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Export team"))!
      .trigger("click");
    await flushPromises();
    const code = wrapper.get<HTMLTextAreaElement>(".share-team textarea").element.value;
    expect(code).toMatch(/^gwonmac-team:/u);
    expect(document.activeElement).toBe(wrapper.get(".share-team textarea").element);
    await wrapper
      .findAll(".share-team .ui-button")
      .find((button) => button.text().includes("Copy code"))!
      .trigger("click");
    await flushPromises();

    expect(copied).toBe(code);
    expect(wrapper.get(".share-success").text()).toBe("Team code copied.");
    expect(wrapper.get<HTMLTextAreaElement>(".share-team textarea").element.value).toBe(code);
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
  it("refuses Apply before the click when no gateway exists", async () => {
    const refused = "No command gateway is certified for this client.";
    const wrapper = await workbench({
      ...applicableHost(async () => {
        throw new Error("apply must not be reachable");
      }),
      applyUnavailable: refused,
    });
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    expect(apply.attributes("disabled")).toBeDefined();
    // The reason is on screen, not in a toast the player has to earn.
    expect(wrapper.get(".apply-unavailable").text()).toBe(refused);
    // And it replaces the description that made the button look ready.
    expect(wrapper.text()).not.toContain("Applies the roster, difficulty");
    wrapper.unmount();
  });

  it("enables Apply when the host can reach the game and changes remain", async () => {
    const wrapper = await workbench(applicableHost(
      async () => ({ commandId: 1, completedChanges: 8, skippedSkills: [] }),
    ));
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    expect(apply.attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".apply-unavailable").exists()).toBe(false);
    wrapper.unmount();
  });

  it("disables Apply as Already applied when the team matches the party", async () => {
    const applyTeam = vi.fn<ToolsHost["applyTeam"]>();
    const wrapper = await workbench(applicableHost(applyTeam, "normal"));
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Already applied"))!;

    expect(apply.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".apply-status").text()).toContain(
      "Team already matches the party in Guild Wars.",
    );
    await apply.trigger("click");
    expect(applyTeam).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("disables Apply before a click when the region is not PvE", async () => {
    const host = applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    );
    host.party.value = { ...host.party.value, playRegion: "pvp" };
    const wrapper = await workbench(host);
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    expect(apply.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Core only in PvP");
    wrapper.unmount();
  });

  // The companion counts every hero the player owns and can currently name only
  // some of them. What the panel must never do is present the named ones as the
  // party — the difference between "your party is Koss" and "Koss, and two more
  // we cannot name yet" is the difference between a wrong answer and a partial
  // one, and only the second is safe to build capture on.
  it("names the heroes it can and says how many it cannot", async () => {
    const wrapper = await workbench();
    const section = wrapper.get(".live-party");

    expect(section.text()).toContain("3 heroes");
    expect(section.findAll(".live-party-row")).toHaveLength(1);
    expect(section.text()).toContain("Koss");
    expect(section.text()).toContain("2 more heroes are in your party");
    wrapper.unmount();
  });

  it("says no party is observed rather than showing an empty one", async () => {
    const host = createDemoHost();
    host.party.value = unavailableParty();
    const wrapper = await workbench(host);
    const section = wrapper.get(".live-party");

    expect(section.text()).toContain("No party observed");
    expect(section.findAll(".live-party-row")).toHaveLength(0);
    // Nothing that would read as a count of zero heroes, which is a claim about
    // the party rather than about whether one was seen at all.
    expect(section.find(".ui-chip").exists()).toBe(false);
    expect(
      wrapper.findAll(".detail-actions .ui-button")
        .find((button) => button.text().includes("Apply team"))!
        .attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });

  it("follows the companion as the party changes under it", async () => {
    const host = createDemoHost();
    const wrapper = await workbench(host);

    host.party.value = liveParty({
      status: "ready",
      partyObserved: true,
      heroAvailable: true,
      heroCount: 1,
      firstHeroId: 24,
      firstHeroAgentId: 7,
    });
    await flushPromises();

    const section = wrapper.get(".live-party");
    expect(section.text()).toContain("Gwen");
    expect(section.text()).not.toContain("Koss");
    expect(section.text()).not.toContain("more heroes are in your party");
    wrapper.unmount();
  });
});
