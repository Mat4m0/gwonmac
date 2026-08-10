/**
 * A team, reduced to the one checked value that may be handed to the game.
 *
 * `resolveTeamApplyPlan` is the only door: it either returns a `TeamApplyPlan`
 * whose every member has been checked, or the complete list of reasons it
 * refused. There is no partially-valid plan, and nothing downstream re-derives
 * the rules — a caller that holds a plan holds proof the rules passed.
 *
 * The plan is deliberately scalar and closed: hero ids, profession ids,
 * attribute ranks, eight skill ids, and a behaviour.
 * No pointers, no packets, no free text. That is what lets it cross into the
 * companion as a fixed-size record rather than as a command surface, and it is
 * why the refusals (`hard-mode`, `player-slot`, `party-gap`, ...) are values
 * here rather than sentences: the renderer writes the sentence, this decides
 * the fact.
 */
import { HERO_BY_ID, heroLabel } from "./heroes.js";
import {
  buildById,
  type Build,
  type BuildLibrary,
  type HeroBehaviour,
  type HeroId,
  type SkillId,
  type Team,
  type TeamMode,
} from "./library.js";
import type { LiveParty } from "./live-party.js";
import type { BuildValidation } from "./validate.js";

export type ApplicableBuild = Pick<
  Build,
  "professions" | "attributes" | "skills"
>;

export interface TeamApplyMember {
  readonly hero: HeroId | null;
  readonly build: ApplicableBuild | null;
  readonly behaviour: HeroBehaviour | null;
}

export interface TeamApplyPlan {
  readonly mode: TeamMode;
  readonly members: readonly TeamApplyMember[];
}

export interface TeamApplyResult {
  readonly commandId: number;
  readonly completedChanges: number;
  /**
   * The skill ids the game would not put on a bar, named rather than counted.
   *
   * "Guild Wars skipped a skill" tells a player nothing they can act on. The
   * skill it skipped tells them it is one their account has not unlocked, or
   * one the hero's professions do not reach — which is a thing they can fix.
   */
  readonly skippedSkills: readonly number[];
}

export type TeamApplyRuntimeProblem =
  | { readonly rule: "party-unavailable" }
  | { readonly rule: "pvp" }
  | { readonly rule: "region-unknown" }
  | { readonly rule: "not-outpost" }
  | { readonly rule: "outpost-unknown" }
  | { readonly rule: "partial-roster" }
  | { readonly rule: "mode-unobserved" }
  | { readonly rule: "player-unobserved" }
  | { readonly rule: "professions-unobserved"; readonly hero: HeroId | null }
  | {
      readonly rule: "primary-mismatch";
      readonly hero: HeroId | null;
      readonly observed: string;
      readonly wanted: string;
    }
  | { readonly rule: "hero-locked"; readonly hero: HeroId }
  | { readonly rule: "hero-availability-unknown"; readonly hero: HeroId }
  | {
      readonly rule: "skill-locked";
      readonly hero: HeroId | null;
      readonly skills: readonly [SkillId, ...SkillId[]];
    };

export type TeamApplyChange = Readonly<{
  kind: "mode" | "player-build" | "add-hero" | "remove-hero"
    | "rebuild-roster" | "hero-build" | "behaviour";
  hero?: HeroId;
}>;

export type TeamApplyPreflight =
  | { readonly ready: true; readonly changes: readonly TeamApplyChange[] }
  | {
      readonly ready: false;
      readonly blockers: readonly [TeamApplyRuntimeProblem, ...TeamApplyRuntimeProblem[]];
    };

export type TeamApplyProblem =
  | { readonly rule: "player-slot" }
  | { readonly rule: "missing-hero"; readonly slot: number }
  | { readonly rule: "missing-behaviour"; readonly slot: number }
  | { readonly rule: "unknown-hero"; readonly slot: number }
  | { readonly rule: "duplicate-hero"; readonly slot: number }
  | { readonly rule: "party-gap"; readonly slot: number }
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
  for (const [index, slot] of team.slots.entries()) {
    const build = slot.build === null ? null : buildById(library, slot.build);
    if (index === 0) {
      if (
        slot.hero !== null ||
        slot.behaviour !== null
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

function sameAttributes(
  left: Readonly<Record<string, number>> | null,
  right: Readonly<Record<string, number>>,
): boolean {
  if (left === null) return false;
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].every((name) => (left[name] ?? 0) === (right[name] ?? 0));
}

function memberBuildDiffers(
  member: TeamApplyMember,
  live: {
    professions: Build["professions"] | null;
    skills: Build["skills"] | null;
    attributes: Build["attributes"] | null;
  },
): boolean {
  if (member.build === null) return false;
  return live.professions === null
    || live.professions[1] !== member.build.professions[1]
    || live.skills === null
    || live.skills.some((skill, index) => skill !== member.build?.skills[index])
    || !sameAttributes(live.attributes, member.build.attributes);
}

function lockedSkills(
  member: TeamApplyMember,
  unlocks: LiveParty["accountSkills"],
): readonly SkillId[] {
  if (member.build === null || unlocks === null) return [];
  return member.build.skills.filter((skill): skill is SkillId =>
    skill !== null
    && skill < unlocks.knownThrough
    && !unlocks.unlocked.has(skill)
  );
}

/**
 * Whether removals followed by append-only additions can produce `wanted`
 * without disturbing heroes whose relative order is already correct.
 */
export function canReconcileTeamRoster(
  current: readonly HeroId[],
  wanted: readonly HeroId[],
): boolean {
  const wantedSet = new Set(wanted);
  const retained = current.filter((hero) => wantedSet.has(hero));
  return retained.every((hero, index) => hero === wanted[index]);
}

export function teamRosterOrderMatches(
  current: readonly HeroId[],
  wanted: readonly HeroId[],
): boolean {
  return current.length === wanted.length
    && current.every((hero, index) => hero === wanted[index]);
}

export function preflightTeamApply(
  plan: TeamApplyPlan,
  party: LiveParty,
): TeamApplyPreflight {
  const blockers: TeamApplyRuntimeProblem[] = [];
  const changes: TeamApplyChange[] = [];
  if (party.status !== "ready") blockers.push({ rule: "party-unavailable" });
  if (party.playRegion === "pvp") blockers.push({ rule: "pvp" });
  if (party.playRegion === "unknown") blockers.push({ rule: "region-unknown" });
  if (party.inOutpost === false) blockers.push({ rule: "not-outpost" });
  if (party.inOutpost === null) blockers.push({ rule: "outpost-unknown" });
  if (party.partial) blockers.push({ rule: "partial-roster" });
  if (!party.player || party.player.agentId === 0) {
    blockers.push({ rule: "player-unobserved" });
  }
  if (plan.mode !== "none") {
    if (party.hardMode === null) blockers.push({ rule: "mode-unobserved" });
    else if (party.hardMode !== (plan.mode === "hard")) changes.push({ kind: "mode" });
  }

  const player = plan.members[0];
  if (player?.build) {
    const skills = lockedSkills(player, party.characterSkills);
    if (skills[0] !== undefined) {
      blockers.push({ rule: "skill-locked", hero: null, skills: [skills[0], ...skills.slice(1)] });
    }
    const observedPlayer = party.player;
    if (!observedPlayer || observedPlayer.agentId === 0) {
      // The unconditional blocker above owns the message; do not add a second.
    } else if (observedPlayer.professions === null) {
      blockers.push({ rule: "professions-unobserved", hero: null });
    } else if (observedPlayer.professions[0] !== player.build.professions[0]) {
      blockers.push({
        rule: "primary-mismatch",
        hero: null,
        observed: observedPlayer.professions[0],
        wanted: player.build.professions[0],
      });
    } else if (memberBuildDiffers(player, observedPlayer)) {
      changes.push({ kind: "player-build" });
    }
  }

  const wanted = plan.members.filter(
    (member): member is TeamApplyMember & { hero: HeroId } => member.hero !== null,
  );
  const wantedIds = new Set(wanted.map(({ hero }) => hero));
  const currentOrder = party.heroes.map(({ hero }) => hero);
  const wantedOrder = wanted.map(({ hero }) => hero);
  const rebuildRoster = !canReconcileTeamRoster(currentOrder, wantedOrder);
  if (rebuildRoster) {
    changes.push({ kind: "rebuild-roster" });
  } else {
    for (const live of party.heroes) {
      if (wantedIds.has(live.hero)) continue;
      changes.push({ kind: "remove-hero", hero: live.hero });
    }
  }
  for (const member of wanted) {
    const live = party.heroes.find(({ hero }) => hero === member.hero);
    const facts = party.accountHeroes?.get(member.hero);
    if (!live) {
      if (!facts || facts.availability === "unknown") {
        blockers.push({ rule: "hero-availability-unknown", hero: member.hero });
      } else if (facts.availability === "locked") {
        blockers.push({ rule: "hero-locked", hero: member.hero });
      } else if (!rebuildRoster) {
        changes.push({ kind: "add-hero", hero: member.hero });
      }
    }
    const professions = live?.professions ?? facts?.professions ?? null;
    if (member.build) {
      const skills = lockedSkills(member, party.accountSkills);
      if (skills[0] !== undefined) {
        blockers.push({
          rule: "skill-locked",
          hero: member.hero,
          skills: [skills[0], ...skills.slice(1)],
        });
      }
      if (professions === null) {
        blockers.push({ rule: "professions-unobserved", hero: member.hero });
      } else if (professions[0] !== member.build.professions[0]) {
        blockers.push({
          rule: "primary-mismatch",
          hero: member.hero,
          observed: professions[0],
          wanted: member.build.professions[0],
        });
      } else if (!live || memberBuildDiffers(member, live)) {
        changes.push({ kind: "hero-build", hero: member.hero });
      }
    }
    if (member.behaviour !== null && (!live || live.behaviour !== member.behaviour)) {
      changes.push({ kind: "behaviour", hero: member.hero });
    }
  }
  const [first, ...rest] = blockers;
  return first
    ? { ready: false, blockers: [first, ...rest] }
    : { ready: true, changes: Object.freeze(changes) };
}

export function teamApplyProblemMessage(problem: TeamApplyRuntimeProblem): string {
  switch (problem.rule) {
    case "party-unavailable": return "Waiting for a playable character and party observation.";
    case "pvp": return "Core only in PvP and guild halls — Team Apply is unavailable.";
    case "region-unknown": return "Core only until the current region is safely identified.";
    case "not-outpost": return "Enter a PvE outpost to apply this team.";
    case "outpost-unknown": return "Waiting to confirm that this is a PvE outpost.";
    case "partial-roster": return "Waiting until the complete party roster is observed.";
    case "mode-unobserved": return "Waiting for the current Normal or Hard Mode observation.";
    case "player-unobserved": return "Your own character has not been observed yet.";
    case "professions-unobserved": return problem.hero === null
      ? "Your professions have not been observed yet."
      : `${heroLabel(problem.hero)}'s professions have not been observed yet.`;
    case "primary-mismatch": return `${problem.hero === null ? "Your" : `${heroLabel(problem.hero)}'s`} `
      + `assigned build is for ${problem.wanted}, but the observed primary is ${problem.observed}.`;
    case "hero-locked": return `${heroLabel(problem.hero)} is not unlocked on this account.`;
    case "hero-availability-unknown": return `${heroLabel(problem.hero)} could not be verified on this account. Add the hero manually first.`;
    case "skill-locked": {
      const owner = problem.hero === null
        ? "Your assigned build"
        : `${heroLabel(problem.hero)}'s assigned build`;
      const skills = problem.skills.length === 1
        ? `skill ${problem.skills[0]}`
        : `skills ${problem.skills.join(", ")}`;
      return `${owner} uses ${skills}, which ${problem.skills.length === 1 ? "is" : "are"} not unlocked.`;
    }
  }
}
