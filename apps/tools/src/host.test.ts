import { afterEach, describe, expect, it, vi } from "vitest";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type { TeamApplyPlan } from "../../../src/shared/builds/team-apply";
import type { TeamApplyCommands } from "../../../src/shared/builds/team-apply-runner";
import { demoParty } from "./fixtures";
import { createNativeHost } from "./host";

describe("native Tools host diagnostics", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "gwTeamApplyProbe");
  });

  it("publishes bounded evidence when Team Apply refuses", async () => {
    const command = vi.fn();
    const commands: TeamApplyCommands = {
      setHardMode: command,
      setPlayerSecondary: command,
      setPlayerSkills: command,
      setPlayerAttributes: command,
      addHero: command,
      kickHero: command,
      setHeroBehaviour: command,
      setHeroSecondary: command,
      setHeroSkills: command,
      setHeroAttributes: command,
    };
    const host = createNativeHost(
      {} as GwNativeApi,
      vi.fn(),
      commands,
      null,
    );
    host.party.value = demoParty;
    const plan: TeamApplyPlan = {
      mode: "none",
      members: Array.from({ length: 8 }, () => ({
        hero: null,
        build: null,
        behaviour: null,
      })),
    };

    await expect(host.applyTeam(plan)).rejects.toThrow();
    expect(window.gwTeamApplyProbe).toMatchObject({
      schema: 1,
      commandId: 1,
      party: {
        status: "ready",
        accountSkillsObserved: true,
        characterSkillsObserved: true,
      },
      members: expect.arrayContaining([
        expect.objectContaining({ slot: 1 }),
      ]),
    });
  });
});
