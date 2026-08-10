/**
 * Deterministic Guild Wars party fixture for Team Apply confirmation tests.
 */
import type {
  TeamApplyCommands,
  TeamApplyEnvironment,
} from "../../src/shared/builds/team-apply-runner.ts";
import { liveParty, type LiveParty } from "../../src/shared/builds/live-party.ts";
import { skillId } from "../../src/shared/builds/library.ts";
import type {
  TeamApplyMember,
  TeamApplyPlan,
} from "../../src/shared/builds/team-apply.ts";

export type ApplySlot = {
  hero: number;
  agentId: number;
  professions?: readonly number[] | null;
  behaviour: number | null;
  skills: readonly number[] | null;
  attributes?: readonly (readonly number[])[] | null;
};
type Player = Omit<ApplySlot, "hero" | "behaviour">;

/** A published party, built the way the decoder publishes one. */
export function applyParty(
  slots: readonly ApplySlot[],
  inOutpost: boolean | null = true,
  hardMode = false,
  player: Player | null = {
    agentId: 1,
    professions: [1, 2],
    skills: [0, 0, 0, 0, 0, 0, 0, 0],
    attributes: [],
  },
): LiveParty {
  return liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: slots.length > 0,
    heroCount: slots.length,
    firstHeroId: slots[0]?.hero ?? 0,
    party: {
      status: "ready",
      rosterObserved: true,
      unlockObserved: true,
      unlocked: Array.from({ length: 39 }, (_, index) => index + 1),
      playRegion: "pve",
      hardMode,
      inOutpost,
      slotCount: slots.length,
      slots: [
        {
          index: 0, occupied: player !== null, hero: null,
          agentId: player?.agentId ?? null, level: player === null ? null : 20,
          professions: player?.professions ?? null, behaviour: null,
          skills: player?.skills ?? null, disabled: player === null ? null : 0,
          attributes: player?.attributes ?? null,
        },
        ...slots.map((slot, index) => ({
          index: index + 1,
          occupied: true,
          hero: slot.hero,
          agentId: slot.agentId,
          level: 20,
          professions: slot.professions === undefined
            ? [1, 2] as readonly number[]
            : slot.professions,
          behaviour: slot.behaviour,
          skills: slot.skills,
          disabled: 0,
          attributes: slot.attributes ?? [],
        })),
      ],
    },
  });
}

/** A game where sent packets change nothing unless the test explicitly reacts. */
export function applyHarness(
  initial: readonly ApplySlot[],
  inOutpost: boolean | null = true,
) {
  const sent: string[] = [];
  let world = [...initial];
  let outpost = inOutpost;
  let hardMode = false;
  let confirmationNow = 0;
  let player: Player | null = {
    agentId: 1,
    professions: [1, 2],
    skills: [0, 0, 0, 0, 0, 0, 0, 0],
    attributes: [],
  };
  const agentFor = (hero: number) => world.find((slot) => slot.hero === hero)?.agentId ?? 0;
  const commands: TeamApplyCommands = {
    cancelPending: () => {},
    setHardMode: (enabled) => { sent.push(`hard:${enabled}`); },
    setPlayerSecondary: (profession) => {
      sent.push(`player-secondary:${player?.agentId ?? 0}:${profession}`);
    },
    setPlayerSkills: (skills) => {
      sent.push(`player-skills:${player?.agentId ?? 0}:${skills.join(",")}`);
    },
    setPlayerAttributes: (ranks) => {
      sent.push(`player-attributes:${player?.agentId ?? 0}:${ranks.map(([a, r]) => `${a}=${r}`).join(",")}`);
    },
    addHero: (hero) => { sent.push(`add:${hero}`); },
    kickAllHeroes: () => { sent.push("kick-all"); },
    kickHero: (hero) => { sent.push(`kick:${hero}`); },
    setHeroBehaviour: (hero, behaviour) => {
      sent.push(`behaviour:${agentFor(hero)}:${behaviour}`);
    },
    setHeroSecondary: (hero, profession) => {
      sent.push(`secondary:${agentFor(hero)}:${profession}`);
    },
    setHeroSkills: (hero, skills) => {
      sent.push(`skills:${agentFor(hero)}:${skills.join(",")}`);
    },
    setHeroAttributes: (hero, ranks) => {
      sent.push(`attributes:${agentFor(hero)}:${ranks.map(([a, r]) => `${a}=${r}`).join(",")}`);
    },
  };
  const environment: TeamApplyEnvironment = {
    commands,
    party: () => applyParty(world, outpost, hardMode, player),
    confirmationTime: {
      now: () => confirmationNow,
      sleep: (milliseconds) => {
        confirmationNow += milliseconds;
        return Promise.resolve();
      },
    },
  };
  return {
    sent,
    environment,
    set(next: readonly ApplySlot[]) { world = [...next]; },
    setHard(next: boolean) { hardMode = next; },
    setPlayer(next: Player | null) { player = next; },
    leave() { outpost = false; },
    react(when: string, next: readonly ApplySlot[]) {
      const mutable = commands as unknown as Record<string, (...args: never[]) => void>;
      for (const key of Object.keys(commands)) {
        const inner = mutable[key]!;
        mutable[key] = (...args: never[]) => {
          inner(...args);
          if (sent.at(-1) === when) world = [...next];
        };
      }
    },
  };
}

export function applyMember(over: Partial<TeamApplyMember> = {}): TeamApplyMember {
  return { hero: null, build: null, behaviour: null, ...over };
}

export function applyPlan(members: readonly TeamApplyMember[]): TeamApplyPlan {
  return { mode: "none", members: [applyMember(), ...members] };
}

export function applyBuild() {
  return {
    professions: ["W", "R"] as const,
    attributes: { Strength: 7, HammerMastery: 12 },
    skills: [
      skillId(1), skillId(2), skillId(3), skillId(4),
      skillId(5), skillId(6), skillId(7), skillId(8),
    ],
  } as unknown as NonNullable<TeamApplyMember["build"]>;
}
