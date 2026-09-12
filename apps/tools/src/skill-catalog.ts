/** Owns the shared skill presentation and installed-client catalogue loader. */
import { skillId, type SkillId } from "../../../src/shared/builds/library";
import { SKILL_CATALOGUE_ROUTE, SKILL_ICON_ROUTE } from "../../../src/shared/contracts";
import { parseSkillCatalogue, type SkillCatalogueRecord } from "../../../src/shared/skill-catalogue";

export interface SkillPresentation
  extends Omit<SkillCatalogueRecord, "id" | "hasIcon"> {
  readonly id: SkillId;
  readonly iconUrl: string | null;
}

export interface SkillCatalogue {
  get(id: SkillId): SkillPresentation;
  has(id: SkillId): boolean;
  all(): readonly SkillPresentation[];
}

export function createSkillCatalogue(
  skills: readonly SkillPresentation[],
): SkillCatalogue & { replace(skills: readonly SkillPresentation[]): void } {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return {
    has(id) {
      return byId.has(id);
    },
    all() {
      return [...byId.values()];
    },
    get(id) {
      return byId.get(id) ?? {
        id,
        name: `Skill ${id}`,
        profession: null,
        attribute: null,
        elite: false,
        availability: "not-equippable",
        energyCost: 0,
        adrenalineCost: 0,
        healthCost: 0,
        overcast: 0,
        activationSeconds: 0,
        aftercastSeconds: 0,
        rechargeSeconds: 0,
        description: null,
        iconUrl: null,
      };
    },
    replace(next) {
      byId.clear();
      for (const skill of next) byId.set(skill.id, skill);
    },
  };
}

/** Both map planning and Builds read the same installed-client catalogue route. */
export async function loadInstalledSkills(): Promise<readonly SkillPresentation[]> {
  const response = await fetch(`gw://app/${SKILL_CATALOGUE_ROUTE}`);
  if (!response.ok) throw new Error("The installed skill catalogue is unavailable. Try again after Guild Wars finishes loading.");
  return parseSkillCatalogue(await response.json()).map(({ hasIcon, ...record }) => ({
    ...record, id: skillId(record.id), iconUrl: hasIcon ? `gw://app/${SKILL_ICON_ROUTE(record.id)}` : null,
  }));
}
