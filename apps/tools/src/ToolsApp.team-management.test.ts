import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { heroId, mapTeamSlots } from "../../../src/shared/builds/library";
import { liveParty, unavailableParty } from "../../../src/shared/builds/live-party";
import type { TeamApplyResult } from "../../../src/shared/builds/team-apply";
import { createDemoHost, type ToolsHost } from "./host";
import { applicableHost, workbench } from "./ToolsApp.test-fixture";

describe("ToolsApp team management", () => {
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

  it("removes a hero as one record, compacts the roster, and can undo", async () => {
    const wrapper = await workbench();
    const originalHero = wrapper.get<HTMLSelectElement>("#team-hero-1").element.value;
    await wrapper.get<HTMLSelectElement>("#team-hero-2").setValue("6");
    await wrapper.get<HTMLSelectElement>("#team-behaviour-2").setValue("guard");
    await flushPromises();
    const followingHero = wrapper.get<HTMLSelectElement>("#team-hero-3").element.value;

    await wrapper.findAll(".team-remove-member")[0]!.trigger("click");
    await flushPromises();

    expect(wrapper.get<HTMLSelectElement>("#team-hero-1").element.value).toBe("6");
    expect(wrapper.get<HTMLSelectElement>("#team-behaviour-1").element.value).toBe("guard");
    expect(wrapper.get<HTMLSelectElement>("#team-hero-2").element.value).toBe(followingHero);

    await wrapper.get(".library-summary .ui-link").trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>("#team-hero-1").element.value).toBe(originalHero);
    expect(wrapper.get<HTMLSelectElement>("#team-hero-2").element.value).toBe("6");
    wrapper.unmount();
  });

  it("moves whole hero records with the keyboard and restores focus", async () => {
    const wrapper = await workbench();
    await wrapper.get<HTMLSelectElement>("#team-hero-2").setValue("6");
    await wrapper.get<HTMLSelectElement>("#team-behaviour-2").setValue("avoid");
    await flushPromises();

    await wrapper.get("#team-move-2").trigger("keydown", { key: "ArrowUp" });
    await flushPromises();

    expect(wrapper.get<HTMLSelectElement>("#team-hero-1").element.value).toBe("6");
    expect(wrapper.get<HTMLSelectElement>("#team-behaviour-1").element.value).toBe("avoid");
    expect(document.activeElement?.id).toBe("team-move-1");
    expect(wrapper.text()).toContain("Koss moved to slot 2.");
    wrapper.unmount();
  });

  it("moves a hero onto an empty destination by dragging its handle", async () => {
    const wrapper = await workbench(applicableHost(
      async () => ({ commandId: 1, completedChanges: 0, skippedSkills: [] }),
    ));
    await wrapper.get<HTMLSelectElement>("#team-hero-2").setValue("6");
    await flushPromises();
    const before = wrapper.findAll<HTMLSelectElement>(".hero-picker select")
      .map((select) => select.element.value)
      .filter(Boolean);
    const transfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    };

    await wrapper.get("#team-move-1").trigger("dragstart", { dataTransfer: transfer });
    const emptyRows = wrapper.findAll(".team-slot--compact");
    const destination = emptyRows[emptyRows.length - 1]!;
    expect(destination.text()).toContain("Move here");
    await destination.trigger("dragover", {
      dataTransfer: transfer,
    });
    await destination.trigger("drop", {
      dataTransfer: transfer,
    });
    await flushPromises();

    const after = wrapper.findAll<HTMLSelectElement>(".hero-picker select")
      .map((select) => select.element.value)
      .filter(Boolean);
    expect(after).toEqual([...before.slice(1), before[0]]);
    wrapper.unmount();
  });

  it("repairs an imported roster gap in one action", async () => {
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
          teams: loaded.library.teams.map((team, teamIndex) => {
            if (teamIndex !== 0) return team;
            const member = team.slots[1]!;
            return {
              ...team,
              slots: mapTeamSlots(team.slots, (slot, slotIndex) => slotIndex === 1
                ? { hero: null, build: null, behaviour: null }
                : slotIndex === 2 ? member : slot),
            };
          }),
        },
      };
    };
    const wrapper = await workbench(host);
    const hero = wrapper.get<HTMLSelectElement>("#team-hero-2").element.value;

    expect(wrapper.get(".apply-readiness").text()).toContain("Move configured heroes");
    await wrapper
      .findAll(".apply-readiness .ui-button")
      .find((button) => button.text() === "Fix team order")!
      .trigger("click");
    await flushPromises();

    expect(wrapper.get<HTMLSelectElement>("#team-hero-1").element.value).toBe(hero);
    expect(wrapper.find(".apply-readiness").exists()).toBe(false);
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
    const host = applicableHost(async (plan, onEvent) => {
      plans.push(plan);
      onEvent?.({
        state: "waiting",
        message: "Waiting for Devona's secondary profession…",
        elapsedMs: 50,
      });
      return pending;
    });
    const cancel = vi.spyOn(host, "cancelApply");
    const wrapper = await workbench(host);
    const apply = wrapper
      .findAll(".detail-actions .ui-button")
      .find((button) => button.text().includes("Apply team"))!;

    await apply.trigger("click");
    await flushPromises();
    expect(plans).toHaveLength(1);
    expect(apply.text()).toBe("Cancel Apply");
    expect(apply.attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".team-editor").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Waiting for Devona's secondary profession…");
    await apply.trigger("click");
    expect(plans).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();

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

    expect(section.element.tagName).toBe("DETAILS");
    expect(section.attributes("open")).toBeDefined();
    expect(section.text()).toContain("3 heroes");
    expect(section.findAll(".live-party-row")).toHaveLength(1);
    expect(section.text()).toContain("Koss");
    expect(section.text()).toContain("2 more heroes are in your party");

    await section.get("summary").trigger("click");
    expect(section.attributes("open")).toBeUndefined();
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
