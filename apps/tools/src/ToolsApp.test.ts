import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { mapTeamSlots } from "../../../src/shared/builds/library";
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

function applicableHost(applyTeam: ToolsHost["applyTeam"]): ToolsHost {
  const demo = createDemoHost();
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
                mode: "normal" as const,
                slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 0
                  ? slot
                  : {
                      ...slot,
                      hero: null,
                      build: null,
                      behaviour: null,
                      panel: false,
                      disabled: [],
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
    ).toEqual(["Keep current", "Normal"]);
    expect(wrapper.text()).toContain("Hard-mode Apply is not available yet");
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

  it("publishes through the host capability and explains the player-owned next step", async () => {
    const wrapper = await workbench();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    await wrapper.findAll(".library-row")[0]!.trigger("click");
    await wrapper
      .findAll(".authoring-actions .ui-button")
      .find((button) => button.text().includes("Write skill template"))!
      .trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(wrapper.text()).toContain("Template written:");
    expect(wrapper.text()).toContain("Load Template");
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

  it("assigns heroes and persists the controls that belong to a team slot", async () => {
    const wrapper = await workbench();
    const hero = wrapper.findAll<HTMLSelectElement>(".hero-picker select")[0]!;
    await hero.setValue("6");
    await flushPromises();
    expect(hero.element.value).toBe("6");
    expect(wrapper.text()).toContain("Koss");

    await wrapper.findAll(".slot-settings")[0]!.trigger("click");
    const firstSkill = wrapper.findAll(".disabled-skills button")[0]!;
    expect(firstSkill.attributes("aria-pressed")).toBe("true");
    await firstSkill.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".disabled-skills button")[0]!.attributes("aria-pressed")).toBe("false");

    const build = wrapper.findAll<HTMLSelectElement>(".build-picker select")[1]!;
    const alternative = build.findAll("option").find(
      (option) => option.attributes("value") && option.attributes("value") !== build.element.value,
    );
    await build.setValue(alternative!.attributes("value"));
    await flushPromises();
    expect(
      wrapper.findAll(".disabled-skills button").every(
        (button) => button.attributes("aria-pressed") === "true",
      ),
    ).toBe(true);
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
    await wrapper
      .findAll(".team-controls .ui-segment button")
      .find((button) => button.text() === "Normal")!
      .trigger("click");
    await flushPromises();
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("needs attention before Apply");
    expect(wrapper.text()).toContain("skills this member cannot equip");
    expect(wrapper.find(".handoff-sheet").exists()).toBe(false);
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

    finish({ commandId: 7, completedChanges: 3, skillsSkipped: false });
    await flushPromises();
    expect(wrapper.text()).toContain("Team applied · 3 confirmed changes.");
    wrapper.unmount();
  });

  it("explains when Guild Wars omitted unavailable skills", async () => {
    const wrapper = await workbench(applicableHost(async () => ({
      commandId: 8,
      completedChanges: 1,
      skillsSkipped: true,
    })));
    await wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!
      .trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Team applied · 1 confirmed change.");
    expect(wrapper.text()).toContain(
      "Guild Wars skipped one or more unavailable skills.",
    );
    wrapper.unmount();
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

  it("leaves Apply alone when the host can reach the game", async () => {
    const wrapper = await workbench(applicableHost(
      async () => ({ commandId: 1, completedChanges: 8, skillsSkipped: false }),
    ));
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    expect(apply.attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".apply-unavailable").exists()).toBe(false);
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
    wrapper.unmount();
  });

  it("follows the companion as the party changes under it", async () => {
    const host = createDemoHost();
    const wrapper = await workbench(host);

    host.party.value = liveParty({
      status: "ready",
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
