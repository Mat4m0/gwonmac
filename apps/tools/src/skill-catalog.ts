import type {
  Profession,
  SkillId,
} from "../../../src/shared/builds/library";

export interface SkillPresentation {
  readonly id: SkillId;
  readonly name: string;
  readonly profession: Profession | null;
  readonly elite: boolean;
  readonly iconUrl: string | null;
}

export interface SkillCatalogue {
  get(id: SkillId): SkillPresentation;
}

export function createSkillCatalogue(
  skills: readonly SkillPresentation[],
): SkillCatalogue & { replace(skills: readonly SkillPresentation[]): void } {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return {
    get(id) {
      return byId.get(id) ?? {
        id,
        name: `Skill ${id}`,
        profession: null,
        elite: false,
        iconUrl: null,
      };
    },
    replace(next) {
      byId.clear();
      for (const skill of next) byId.set(skill.id, skill);
    },
  };
}
