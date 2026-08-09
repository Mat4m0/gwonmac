import type { SkillPlacementResolution } from "../../../src/shared/builds/authoring";
import type { SkillId } from "./model";
import type { SkillCatalogue } from "./skill-catalog";

export type SkillDropPreview = Readonly<{
  skill: SkillId;
  target: number | null;
  outcome: "pending" | "move" | SkillPlacementResolution["outcome"];
  affectedSlots: readonly number[];
  label: string;
}>;

export type SkillPlacementPresentation = Readonly<{
  preview: SkillDropPreview;
  actionLabel: string;
  explanation: string | null;
  blocked: boolean;
  completion: Readonly<{
    text: string;
    tone: "success" | "warning" | "error";
  }>;
}>;

/** The only UI projection of the canonical placement decision. */
export function presentSkillPlacement(
  skill: SkillId,
  resolution: SkillPlacementResolution,
  catalogue: SkillCatalogue,
): SkillPlacementPresentation {
  const name = catalogue.has(skill) ? catalogue.get(skill).name : "This skill";
  switch (resolution.outcome) {
    case "place":
      return {
        preview: {
          skill,
          target: resolution.target,
          outcome: resolution.outcome,
          affectedSlots: [],
          label: `Place in ${resolution.target + 1}`,
        },
        actionLabel: `Use in slot ${resolution.target + 1}`,
        explanation: null,
        blocked: false,
        completion: {
          text: `${name} placed in slot ${resolution.target + 1}.`,
          tone: "success",
        },
      };
    case "replace-elite": {
      const replaced = resolution.replaced
        .map(({ skill: replacedSkill, slot }) =>
          `${catalogue.get(replacedSkill).name} in slot ${slot + 1}`)
        .join(" and ");
      return {
        preview: {
          skill,
          target: resolution.target,
          outcome: resolution.outcome,
          affectedSlots: resolution.replaced.map(({ slot }) => slot),
          label: `Replace elite in ${resolution.target + 1}`,
        },
        actionLabel: `Replace elite in slot ${resolution.target + 1}`,
        explanation: `This replaces ${replaced}.`,
        blocked: false,
        completion: {
          text: `${name} placed in slot ${resolution.target + 1}, replacing ${replaced}.`,
          tone: "success",
        },
      };
    }
    case "already-used":
      return {
        preview: {
          skill,
          target: resolution.target,
          outcome: resolution.outcome,
          affectedSlots: [resolution.existingSlot],
          label: `Already used in ${resolution.existingSlot + 1}`,
        },
        actionLabel: `Already used in slot ${resolution.existingSlot + 1}`,
        explanation: `Already used in slot ${resolution.existingSlot + 1}.`,
        blocked: true,
        completion: {
          text: `${name} is already used in slot ${resolution.existingSlot + 1}.`,
          tone: "warning",
        },
      };
    case "unavailable":
      return {
        preview: {
          skill,
          target: resolution.target,
          outcome: resolution.outcome,
          affectedSlots: [],
          label: "Skill data unavailable",
        },
        actionLabel: "Skill data unavailable",
        explanation: `${name} cannot be placed because its skill data is unavailable.`,
        blocked: true,
        completion: {
          text: `${name} cannot be placed because its skill data is unavailable.`,
          tone: "error",
        },
      };
  }
}
