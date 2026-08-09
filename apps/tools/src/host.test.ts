import { afterEach, describe, expect, it, vi } from "vitest";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type { TeamApplyPlan } from "../../../src/shared/builds/team-apply";
import type { TeamApplyCommands } from "../../../src/shared/builds/team-apply-runner";
import { demoParty } from "./fixtures";
import { createNativeHost } from "./host";

describe("native Tools host diagnostics", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "gwTeamApplyProbe");
    vi.restoreAllMocks();
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
      true,
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

  it("emits bounded Apply lifecycle evidence only in development", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
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
    const plan: TeamApplyPlan = {
      mode: "none",
      members: Array.from({ length: 8 }, () => ({
        hero: null,
        build: null,
        behaviour: null,
      })),
    };
    const development = createNativeHost(
      {} as GwNativeApi,
      vi.fn(),
      commands,
      null,
      true,
    );
    development.party.value = demoParty;

    await expect(development.applyTeam(plan)).rejects.toThrow();
    expect(debug.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("[tools:dev] apply.start"),
      expect.stringContaining("[tools:dev] apply.failed"),
    ]);
    expect(debug.mock.calls.join(" ")).not.toContain("wantedSkills");

    debug.mockClear();
    const production = createNativeHost(
      {} as GwNativeApi,
      vi.fn(),
      commands,
      null,
      false,
    );
    production.party.value = demoParty;
    await expect(production.applyTeam(plan)).rejects.toThrow();
    expect(debug).not.toHaveBeenCalled();
  });
});
