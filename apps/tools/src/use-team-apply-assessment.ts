/**
 * Projects canonical Team Apply decisions into the issues, previews, and choices the UI renders.
 * Planning and preflight authority remain in the shared Team Apply domain module.
 */
import { computed } from "vue";
import { PROFESSIONS, heroLabel } from "../../../src/shared/builds/heroes";
import { buildById, type TeamSlot } from "../../../src/shared/builds/library";
import {
  preflightTeamApply,
  resolveTeamApplyPlan,
  teamApplyProblemMessage,
  type TeamApplyProblem,
  type TeamApplyRuntimeProblem,
} from "../../../src/shared/builds/team-apply";
import type { LibraryController } from "./use-library";
import type { Team } from "./model";

export interface TeamApplyIssue {
  readonly id: string;
  readonly message: string;
  readonly guidance: string | null;
  readonly slots: readonly number[];
  readonly control: "build" | "hero" | "behaviour" | null;
}

export interface TeamBuildOption {
  readonly build: NonNullable<ReturnType<typeof buildById>>;
  readonly disabled: boolean;
  readonly reason: string | null;
}

export interface TeamBuildOptionGroup {
  readonly label: string;
  readonly options: readonly TeamBuildOption[];
}

const issueSummary = (issues: readonly TeamApplyIssue[]) => issues.length === 1
  ? issues[0]!.message
  : `${issues.length} issues need attention before applying.`;

const storedProblemMessage = (problem: TeamApplyProblem): string => {
  switch (problem.rule) {
    case "player-slot": return "The player slot contains hero-only settings.";
    case "missing-hero": return `Choose a hero for slot ${problem.slot + 1}.`;
    case "missing-behaviour": return `Choose a behavior for slot ${problem.slot + 1}.`;
    case "unknown-hero": return `Slot ${problem.slot + 1} names an unknown hero.`;
    case "duplicate-hero": return "The same hero is assigned more than once.";
    case "party-gap": return "Move configured heroes above empty party slots.";
    case "invalid-build": return `Slot ${problem.slot + 1} has an invalid build.`;
  }
};

const storedProblemGuidance = (problem: TeamApplyProblem): string | null => {
  switch (problem.rule) {
    case "player-slot": return "Clear the hero-only settings from the player slot.";
    case "missing-hero": return "Choose a hero or clear the build from this slot.";
    case "missing-behaviour": return "Choose Fight, Guard, or Avoid.";
    case "unknown-hero": return "Replace the unknown hero in this slot.";
    case "duplicate-hero": return "Choose a different hero for one of these slots.";
    case "party-gap": return "Move this hero above the first empty hero slot.";
    case "invalid-build": return "Open the build to repair it, or choose another build.";
  }
};

const storedProblemControl = (problem: TeamApplyProblem): TeamApplyIssue["control"] => {
  switch (problem.rule) {
    case "missing-hero":
    case "unknown-hero":
    case "duplicate-hero":
    case "party-gap": return "hero";
    case "missing-behaviour": return "behaviour";
    case "player-slot":
    case "invalid-build": return "build";
  }
};

const runtimeProblemGuidance = (problem: TeamApplyRuntimeProblem): string | null => {
  switch (problem.rule) {
    case "party-unavailable": return "Enter the game on a character and wait for party observation.";
    case "pvp": return "Travel to a PvE outpost. Your saved builds and teams remain available.";
    case "region-unknown": return "Wait for the region check, or travel to a PvE outpost.";
    case "not-outpost": return "Travel to any PvE outpost before applying.";
    case "outpost-unknown": return "Wait for the outpost check to finish.";
    case "partial-roster": return "Wait until every party member is visible to GWonMac.";
    case "mode-unobserved": return "Wait for Normal or Hard Mode to be observed.";
    case "player-unobserved": return "Wait for your character to finish loading.";
    case "professions-unobserved": return "Wait for profession observation, then try again.";
    case "primary-mismatch": return "Choose a build with the observed primary profession.";
    case "hero-locked": return "Choose an unlocked hero or unlock this hero in Guild Wars.";
    case "hero-availability-unknown": return "Add this hero in the Guild Wars party window first.";
    case "skill-locked": return "Choose an unlocked skill, or unlock it in Guild Wars before applying.";
  }
};

const runtimeProblemControl = (
  problem: TeamApplyRuntimeProblem,
): TeamApplyIssue["control"] => {
  switch (problem.rule) {
    case "primary-mismatch":
    case "professions-unobserved": return "build";
    case "hero-locked":
    case "hero-availability-unknown": return "hero";
    default: return null;
  }
};

export function useTeamApplyAssessment(
  team: () => Team,
  controller: LibraryController,
) {
  const configured = computed(() => team().slots.filter(
    (slot, index) => slot.build !== null || (index > 0 && slot.hero !== null),
  ).length);

  const storedProblemSlots = (problem: TeamApplyProblem): readonly number[] => {
    if (problem.rule === "player-slot") return [0];
    if ("slot" in problem) {
      if (problem.rule !== "duplicate-hero") return [problem.slot];
      const hero = team().slots[problem.slot]?.hero;
      const first = team().slots.findIndex((slot) => slot.hero === hero);
      return first >= 0 && first !== problem.slot ? [first, problem.slot] : [problem.slot];
    }
    return [];
  };

  const runtimeProblemSlots = (problem: TeamApplyRuntimeProblem): readonly number[] => {
    if (!("hero" in problem)) return [];
    if (problem.hero === null) return [0];
    const slot = team().slots.findIndex((candidate) => candidate.hero === problem.hero);
    return slot < 0 ? [] : [slot];
  };

  const runtimeProblemMessage = (problem: TeamApplyRuntimeProblem): string => {
    if (problem.rule !== "skill-locked") return teamApplyProblemMessage(problem);
    const owner = problem.hero === null
      ? "Your assigned build"
      : `${heroLabel(problem.hero)}'s assigned build`;
    const names = problem.skills.map((skill) => controller.skills.get(skill).name);
    return `${owner} uses ${names.join(", ")}, which ${names.length === 1 ? "is" : "are"} not unlocked.`;
  };

  const assessment = computed(() => {
    const issues: TeamApplyIssue[] = [];
    if (controller.applyUnavailable) {
      issues.push({
        id: "command-gateway",
        message: controller.applyUnavailable,
        guidance: null,
        slots: [],
        control: null,
      });
    }
    const library = controller.library.value;
    if (!library) {
      issues.push({
        id: "library-loading",
        message: "The build library is still loading.",
        guidance: "Wait for loading to finish before applying.",
        slots: [],
        control: null,
      });
      return { blocked: true, issues, message: "Waiting for the build library.", changes: [] };
    }
    const resolution = resolveTeamApplyPlan(team(), library, controller.validate);
    if (!resolution.valid) {
      resolution.problems.forEach((problem, index) => issues.push({
        id: `stored-${problem.rule}-${"slot" in problem ? problem.slot : index}`,
        message: storedProblemMessage(problem),
        guidance: storedProblemGuidance(problem),
        slots: storedProblemSlots(problem),
        control: storedProblemControl(problem),
      }));
      return { blocked: true, issues, message: issueSummary(issues), changes: [] };
    }
    const result = preflightTeamApply(resolution.plan, controller.party.value);
    if (!result.ready) {
      result.blockers.forEach((problem, index) => issues.push({
        id: `runtime-${problem.rule}-${"hero" in problem ? problem.hero ?? "player" : index}`,
        message: runtimeProblemMessage(problem),
        guidance: runtimeProblemGuidance(problem),
        slots: runtimeProblemSlots(problem),
        control: runtimeProblemControl(problem),
      }));
    }
    if (configured.value === 0) {
      issues.push({
        id: "empty-team",
        message: "This team has no configured builds or heroes.",
        guidance: "Add a player build or at least one hero before applying.",
        slots: [],
        control: null,
      });
    }
    if (issues.length > 0) {
      return { blocked: true, issues, message: issueSummary(issues), changes: [] };
    }
    if (!result.ready) throw new Error("Apply assessment lost its blockers.");
    const preview: string[] = [];
    const count = (kind: typeof result.changes[number]["kind"]) =>
      result.changes.filter((change) => change.kind === kind).length;
    if (count("mode")) preview.push(`set ${team().mode === "hard" ? "Hard" : "Normal"} Mode`);
    const removing = count("remove-hero");
    const adding = count("add-hero");
    const rebuilding = count("rebuild-roster");
    const builds = count("player-build") + count("hero-build");
    const behaviours = count("behaviour");
    if (removing) preview.push(`remove ${removing} ${removing === 1 ? "hero" : "heroes"}`);
    if (adding) preview.push(`add ${adding} ${adding === 1 ? "hero" : "heroes"}`);
    if (rebuilding) preview.push("rebuild heroes in this order");
    if (builds) preview.push(`update ${builds} ${builds === 1 ? "build" : "builds"}`);
    if (behaviours) preview.push(`update ${behaviours} ${behaviours === 1 ? "behavior" : "behaviors"}`);
    return {
      blocked: false,
      issues,
      changes: result.changes,
      message: preview.length
        ? `Preview: ${preview.join(" · ")}.`
        : "Team already matches the party in Guild Wars.",
    };
  });

  const issuesForSlot = (index: number) =>
    assessment.value.issues.filter((issue) => issue.slots.includes(index));

  const reciprocalSwap = computed(() => {
    const library = controller.library.value;
    if (!library) return null;
    const mismatches = assessment.value.issues.flatMap((issue) => {
      if (!issue.id.startsWith("runtime-primary-mismatch-") || issue.slots.length !== 1) return [];
      const slot = issue.slots[0]!;
      const buildReference = team().slots[slot]?.build;
      const build = buildReference === null || buildReference === undefined
        ? null
        : buildById(library, buildReference);
      return build ? [{ slot, build }] : [];
    });
    for (const left of mismatches) {
      for (const right of mismatches) {
        if (left.slot >= right.slot) continue;
        const leftObserved = observedPrimary(left.slot);
        const rightObserved = observedPrimary(right.slot);
        if (
          leftObserved === right.build.professions[0]
          && rightObserved === left.build.professions[0]
        ) return { left: left.slot, right: right.slot };
      }
    }
    return null;
  });

  function observedPrimary(index: number) {
    if (index === 0) return controller.party.value.player?.professions?.[0] ?? null;
    const hero = team().slots[index]?.hero;
    if (hero === null || hero === undefined) return null;
    return controller.party.value.heroes.find((candidate) => candidate.hero === hero)
      ?.professions?.[0]
      ?? controller.party.value.accountHeroes?.get(hero)?.professions?.[0]
      ?? null;
  }

  const buildOptionGroups = (index: number): TeamBuildOptionGroup[] => {
    const builds = controller.library.value?.builds ?? [];
    const primary = observedPrimary(index);
    const context = index === 0 ? "player" : "hero";
    const options = builds.map((build): TeamBuildOption & { category: string } => {
      const valid = controller.validate(build, context).valid;
      const primaryMismatch = primary !== null && build.professions[0] !== primary;
      if (!valid) {
        return {
          build,
          category: "unavailable",
          disabled: true,
          reason: index === 0 ? "build needs repair" : "not valid for heroes",
        };
      }
      if (primaryMismatch && index > 0) {
        return {
          build,
          category: "unavailable",
          disabled: true,
          reason: `requires ${PROFESSIONS[primary].name} primary`,
        };
      }
      if (primaryMismatch) {
        return { build, category: "other-player", disabled: false, reason: null };
      }
      return { build, category: "compatible", disabled: false, reason: null };
    });
    const groups = [
      { label: primary === null ? "Available builds" : "Compatible builds", category: "compatible" },
      { label: "Other player professions", category: "other-player" },
      { label: "Cannot be used here", category: "unavailable" },
    ];
    return groups.flatMap(({ label, category }) => {
      const matching = options.filter((option) => option.category === category);
      return matching.length > 0 ? [{ label, options: matching }] : [];
    });
  };

  const assignmentValid = (slot: TeamSlot, index: number): boolean => {
    if (slot.build === null || !controller.library.value) return true;
    const build = buildById(controller.library.value, slot.build);
    return build ? controller.validate(build, index === 0 ? "player" : "hero").valid : false;
  };

  const hasPartyGap = computed(() =>
    assessment.value.issues.some((issue) => issue.id.startsWith("stored-party-gap-")),
  );
  const noChanges = computed(() => !assessment.value.blocked && assessment.value.changes.length === 0);

  return {
    assessment,
    assignmentValid,
    buildOptionGroups,
    hasPartyGap,
    issuesForSlot,
    noChanges,
    reciprocalSwap,
  };
}
