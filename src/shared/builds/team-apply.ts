/**
 * A team, reduced to the one checked value that may be handed to the game.
 *
 * `resolveTeamApplyPlan` is the only door: it either returns a `TeamApplyPlan`
 * whose every member has been checked, or the complete list of reasons it
 * refused. There is no partially-valid plan, and nothing downstream re-derives
 * the rules — a caller that holds a plan holds proof the rules passed.
 *
 * The plan is deliberately scalar and closed: hero ids, profession ids,
 * attribute ranks, eight skill ids, a behaviour, and which slots are disabled.
 * No pointers, no packets, no free text. That is what lets it cross into the
 * companion as a fixed-size record rather than as a command surface, and it is
 * why the refusals (`hard-mode`, `player-slot`, `party-gap`, ...) are values
 * here rather than sentences: the renderer writes the sentence, this decides
 * the fact.
 */
import { HERO_BY_ID } from "./heroes.js";
import {
  buildById,
  type Build,
  type BuildLibrary,
  type HeroBehaviour,
  type HeroId,
  type SkillSlotIndex,
  type Team,
  type TeamMode,
} from "./library.js";
import type { BuildValidation } from "./validate.js";

export type ApplicableBuild = Pick<
  Build,
  "professions" | "attributes" | "skills"
>;

export interface TeamApplyMember {
  readonly hero: HeroId | null;
  readonly build: ApplicableBuild | null;
  readonly behaviour: HeroBehaviour | null;
  readonly disabled: readonly SkillSlotIndex[];
}

export interface TeamApplyPlan {
  readonly mode: TeamMode;
  readonly members: readonly TeamApplyMember[];
}

export interface TeamApplyResult {
  readonly commandId: number;
  readonly completedChanges: number;
  readonly skillsSkipped: boolean;
}

export type TeamApplyProblem =
  | { readonly rule: "hard-mode" }
  | { readonly rule: "player-slot" }
  | { readonly rule: "missing-hero"; readonly slot: number }
  | { readonly rule: "missing-behaviour"; readonly slot: number }
  | { readonly rule: "unknown-hero"; readonly slot: number }
  | { readonly rule: "duplicate-hero"; readonly slot: number }
  | { readonly rule: "party-gap"; readonly slot: number }
  | { readonly rule: "disabled-without-build"; readonly slot: number }
  | { readonly rule: "invalid-build"; readonly slot: number };

export type TeamApplyResolution =
  | { readonly valid: true; readonly plan: TeamApplyPlan }
  | {
      readonly valid: false;
      readonly problems: readonly [TeamApplyProblem, ...TeamApplyProblem[]];
    };

function snapshotMember(member: TeamApplyMember): TeamApplyMember {
  return Object.freeze({
    ...member,
    build: member.build === null
      ? null
      : Object.freeze({
          professions: Object.freeze([...member.build.professions]) as Build["professions"],
          attributes: Object.freeze({ ...member.build.attributes }),
          skills: Object.freeze([...member.build.skills]) as Build["skills"],
        }),
    disabled: Object.freeze([...member.disabled]),
  });
}

/**
 * Resolves stored ids into the one immutable value copied to the game kernel.
 * The result is derived and never persisted: Team and BuildLibrary remain the
 * only sources of truth.
 */
export function resolveTeamApplyPlan(
  team: Team,
  library: BuildLibrary,
  validate: (
    build: Build,
    context: "player" | "hero",
  ) => BuildValidation,
): TeamApplyResolution {
  const problems: TeamApplyProblem[] = [];
  const members: TeamApplyMember[] = [];
  const seen = new Set<HeroId>();
  let emptyHeroSlotSeen = false;
  if (team.mode === "hard") {
    problems.push({ rule: "hard-mode" });
  }

  for (const [index, slot] of team.slots.entries()) {
    const build = slot.build === null ? null : buildById(library, slot.build);
    if (index === 0) {
      if (
        slot.hero !== null ||
        slot.behaviour !== null ||
        slot.disabled.length !== 0
      ) {
        problems.push({ rule: "player-slot" });
      }
      if (slot.build !== null && build === null) {
        problems.push({ rule: "invalid-build", slot: index });
      }
      if (
        build !== null &&
        !validate(build, "player").valid
      ) {
        problems.push({ rule: "invalid-build", slot: index });
      }
      members.push({
        hero: null,
        build,
        behaviour: null,
        disabled: [],
      });
      continue;
    }

    if (slot.hero === null) {
      if (slot.build !== null) {
        problems.push({ rule: "missing-hero", slot: index });
      }
      emptyHeroSlotSeen = true;
      continue;
    }
    if (emptyHeroSlotSeen) {
      problems.push({ rule: "party-gap", slot: index });
    }
    if (!HERO_BY_ID.has(slot.hero)) {
      problems.push({ rule: "unknown-hero", slot: index });
    }
    if (seen.has(slot.hero)) {
      problems.push({ rule: "duplicate-hero", slot: index });
    }
    seen.add(slot.hero);
    if (slot.behaviour === null) {
      problems.push({ rule: "missing-behaviour", slot: index });
    }
    if (build === null && slot.disabled.length !== 0) {
      problems.push({ rule: "disabled-without-build", slot: index });
    }
    if (slot.build !== null && build === null) {
      problems.push({ rule: "invalid-build", slot: index });
    }
    if (build !== null && !validate(build, "hero").valid) {
      problems.push({ rule: "invalid-build", slot: index });
    }
    members.push({
      hero: slot.hero,
      build,
      behaviour: slot.behaviour,
      disabled: slot.disabled,
    });
  }

  const [first, ...rest] = problems;
  return first === undefined
    ? {
        valid: true,
        plan: Object.freeze({
          mode: team.mode,
          members: Object.freeze(members.map(snapshotMember)),
        }),
      }
    : { valid: false, problems: [first, ...rest] };
}
