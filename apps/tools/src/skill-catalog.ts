import type {
  Attribute,
  Profession,
  SkillId,
} from "../../../src/shared/builds/library";

export interface SkillPresentation {
  readonly id: SkillId;
  readonly name: string;
  readonly profession: Profession | null;
  readonly attribute: Attribute | null;
  readonly elite: boolean;
  readonly availability: "pve" | "player-only-pve" | "pvp" | "not-equippable";
  readonly energyCost: number;
  readonly adrenalineCost: number;
  readonly healthCost: number;
  readonly overcast: number;
  readonly activationSeconds: number;
  readonly aftercastSeconds: number;
  readonly rechargeSeconds: number;
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
        iconUrl: null,
      };
    },
    replace(next) {
      byId.clear();
      for (const skill of next) byId.set(skill.id, skill);
    },
  };
}
