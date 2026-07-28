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
  readonly panel: boolean;
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
        panel: false,
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
      panel: slot.panel,
      disabled: slot.disabled,
    });
  }

  const [first, ...rest] = problems;
  return first === undefined
    ? { valid: true, plan: { mode: team.mode, members } }
    : { valid: false, problems: [first, ...rest] };
}
