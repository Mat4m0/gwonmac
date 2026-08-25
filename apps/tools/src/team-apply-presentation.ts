/** Renderer-owned copy for canonical Team Apply runtime facts. */
import { heroLabel } from "../../../src/shared/builds/heroes.js";
import type { SkillId } from "../../../src/shared/builds/library.js";
import type { TeamApplyRuntimeProblem } from "../../../src/shared/builds/team-apply.js";

export type TeamApplyRuntimePresentation = Readonly<{
  message: string;
  guidance: string | null;
}>;

export function teamApplyRuntimePresentation(
  problem: TeamApplyRuntimeProblem,
  skillName?: (skill: SkillId) => string,
): TeamApplyRuntimePresentation {
  const guidance = (() => {
    switch (problem.rule) {
      case "party-unavailable": return "Enter the game on a character and wait for party observation.";
      case "pvp": return "Leave the PvP match before applying. Your saved builds and teams remain available.";
      case "region-unknown": return "Wait for the region check, or travel to an outpost.";
      case "not-outpost": return "Travel to any outpost before applying.";
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
  })();
  let message = "";
  switch (problem.rule) {
    case "party-unavailable": message = "Waiting for a playable character and party observation."; break;
    case "pvp": message = "Apply team is unavailable during PvP play."; break;
    case "region-unknown": message = "Apply team is unavailable until GWonMac identifies the current region."; break;
    case "not-outpost": message = "Enter an outpost to apply this team."; break;
    case "outpost-unknown": message = "Waiting to confirm that this is an outpost."; break;
    case "partial-roster": message = "Waiting until the complete party roster is observed."; break;
    case "mode-unobserved": message = "Waiting for the current Normal or Hard Mode observation."; break;
    case "player-unobserved": message = "Your own character has not been observed yet."; break;
    case "professions-unobserved": message = problem.hero === null
      ? "Your professions have not been observed yet."
      : `${heroLabel(problem.hero)}'s professions have not been observed yet.`; break;
    case "primary-mismatch": message = `${problem.hero === null ? "Your" : `${heroLabel(problem.hero)}'s`} `
      + `assigned build is for ${problem.wanted}, but the observed primary is ${problem.observed}.`; break;
    case "hero-locked": message = `${heroLabel(problem.hero)} is not unlocked on this account.`; break;
    case "hero-availability-unknown": message = `${heroLabel(problem.hero)} could not be verified on this account. Add the hero manually first.`; break;
    case "skill-locked": {
      const owner = problem.hero === null
        ? "Your assigned build"
        : `${heroLabel(problem.hero)}'s assigned build`;
      const names = problem.skills.map((skill) => skillName?.(skill) ?? String(skill));
      const skills = skillName === undefined
        ? `${names.length === 1 ? "skill " : "skills "}${names.join(", ")}`
        : names.join(", ");
      message = `${owner} uses ${skills}, which ${names.length === 1 ? "is" : "are"} not unlocked.`;
      break;
    }
  }
  return Object.freeze({ message, guidance });
}

export function teamApplyRuntimeProblemMessage(
  problem: TeamApplyRuntimeProblem,
): string {
  return teamApplyRuntimePresentation(problem).message;
}
