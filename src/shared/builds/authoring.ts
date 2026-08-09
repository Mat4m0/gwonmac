/**
 * The attribute-spending rules, as the questions an editor actually asks: which
 * attributes may this build spend on, how many points has it spent, how many
 * remain, and may this one rank be set right now.
 *
 * `validate.ts` owns whether a finished build is legal; this owns whether one
 * edit is available. The two are deliberately separate, because an editor has
 * to grey a control out *before* the invalid state exists, and a validator that
 * only speaks about finished builds cannot answer that.
 *
 * The point cost of a rank is the game's own table, so the budget arithmetic
 * lives here rather than in any component: a rank set through `withAttributeRank`
 * either fits the level-20 budget or the call returns the build unchanged.
 */
import type {
  Attribute,
  AttributeRank,
  AttributeRanks,
  Profession,
  SkillBar,
  SkillId,
  SkillSlotIndex,
} from "./library.js";
import { skillBarOf } from "./library.js";
import { ATTRIBUTE_POINT_COST, ATTRIBUTES } from "./heroes.js";
import {
  LEVEL_20_ATTRIBUTE_BUDGET,
  PRIMARY_ATTRIBUTE,
} from "./validate.js";

const ATTRIBUTE_NAMES = Object.keys(ATTRIBUTES) as readonly Attribute[];

/** Attributes a character with this profession pair may invest in. */
export function availableAttributes(
  professions: readonly [Profession, Profession | null],
): readonly Attribute[] {
  const [primary, secondary] = professions;
  return ATTRIBUTE_NAMES.filter((attribute) => {
    const owner = ATTRIBUTES[attribute].profession;
    if (owner === primary) return true;
    return owner === secondary && PRIMARY_ATTRIBUTE[owner] !== attribute;
  });
}

/** The game's nonlinear cumulative cost for an attribute spread. */
export function attributePointsSpent(attributes: AttributeRanks): number {
  return Object.values(attributes).reduce<number>(
    (total, rank) => total + (rank === undefined ? 0 : ATTRIBUTE_POINT_COST[rank]),
    0,
  );
}

export function attributePointsRemaining(attributes: AttributeRanks): number {
  return LEVEL_20_ATTRIBUTE_BUDGET - attributePointsSpent(attributes);
}

/**
 * Whether changing one invested rank keeps the complete spread within the
 * level-20 budget. Decreases are always affordable.
 */
export function canSetAttributeRank(
  attributes: AttributeRanks,
  attribute: Attribute,
  rank: AttributeRank,
): boolean {
  const current = attributes[attribute] ?? 0;
  return (
    attributePointsSpent(attributes)
    - ATTRIBUTE_POINT_COST[current]
    + ATTRIBUTE_POINT_COST[rank]
    <= LEVEL_20_ATTRIBUTE_BUDGET
  );
}

/** A copy with rank zero represented canonically as absence. */
export function withAttributeRank(
  attributes: AttributeRanks,
  attribute: Attribute,
  rank: AttributeRank,
): AttributeRanks {
  const next = { ...attributes };
  if (rank === 0) delete next[attribute];
  else next[attribute] = rank;
  return next;
}

/** The one catalogue fact needed while placing a skill in an editable bar. */
export type SkillEliteLookup = (
  skill: SkillId,
) => { readonly elite: boolean } | null;

/**
 * Replace one bar slot while preventing the invalid states the picker can
 * resolve before save: unknown skills, duplicates, and two elites. A new elite
 * replaces the previous one because that is the same behavior the Guild Wars
 * template UI teaches players to expect.
 */
export function withPlacedSkill(
  skills: SkillBar,
  target: SkillSlotIndex,
  skill: SkillId,
  catalogue: SkillEliteLookup,
): SkillBar | null {
  const incoming = catalogue(skill);
  if (incoming === null) return null;
  const duplicate = skills.findIndex((id, index) => id === skill && index !== target);
  if (duplicate >= 0) return null;
  return skillBarOf((slot) => {
    if (slot === target) return skill;
    const equipped = skills[slot];
    if (incoming.elite && equipped !== null && catalogue(equipped)?.elite === true) {
      return null;
    }
    return equipped;
  });
}
