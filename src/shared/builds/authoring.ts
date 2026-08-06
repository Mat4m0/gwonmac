import type {
  Attribute,
  AttributeRank,
  AttributeRanks,
  Profession,
} from "./library.js";
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
