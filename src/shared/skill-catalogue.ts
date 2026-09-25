/**
 * The complete skill-catalogue document Main serves and Tools accepts.
 * Production owns extraction; this module owns only the cross-process shape.
 */
import { ATTRIBUTES, PROFESSIONS } from "./builds/heroes.js";
import type { Attribute, Profession } from "./builds/library.js";

export const SKILL_AVAILABILITIES = [
  "pve",
  "player-only-pve",
  "pvp",
  "not-equippable",
] as const;

export type SkillAvailability = (typeof SKILL_AVAILABILITIES)[number];

/** The complete JSON record served by Main and accepted by Tools. */
/**
 * The game's own skill-type labels, as its skill descriptions begin
 * ("Elite Axe Attack."). The elite prefix stays with the `elite` flag.
 */
export const SKILL_TYPES = [
  "Skill", "Stance", "Hex Spell", "Spell", "Enchantment Spell", "Flash Enchantment Spell", "Signet", "Well Spell",
  "Ward Spell", "Glyph", "Axe Attack", "Bow Attack", "Dagger Attack", "Lead Attack", "Off-Hand Attack", "Dual Attack",
  "Hammer Attack", "Scythe Attack", "Spear Attack", "Ranged Attack", "Sword Attack", "Melee Attack", "Shout",
  "Preparation", "Pet Attack", "Trap", "Nature Ritual", "Binding Ritual", "Ebon Vanguard Ritual", "Item Spell",
  "Weapon Spell", "Form", "Chant", "Echo", "Disguise",
] as const;
export type SkillType = typeof SKILL_TYPES[number];

export interface SkillCatalogueRecord {
  readonly id: number;
  readonly name: string;
  readonly profession: Profession | null;
  readonly attribute: Attribute | null;
  readonly elite: boolean;
  readonly type: SkillType;
  readonly availability: SkillAvailability;
  readonly energyCost: number;
  /** Strikes, as the game shows them; the client stores 25 units per strike. */
  readonly adrenalineCost: number;
  readonly healthCost: number;
  readonly overcast: number;
  readonly activationSeconds: number;
  readonly aftercastSeconds: number;
  readonly rechargeSeconds: number;
  readonly description: string | null;
  readonly hasIcon: boolean;
}

const AVAILABILITIES: ReadonlySet<string> = new Set(SKILL_AVAILABILITIES);
const TYPES: ReadonlySet<string> = new Set(SKILL_TYPES);
const PROFESSION_NAMES: ReadonlySet<string> = new Set(Object.keys(PROFESSIONS));
const ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(Object.keys(ATTRIBUTES));
const fail = (field: string, why: string): never => {
  throw new Error(`skillCatalogue.${field} ${why}`);
};

const object = (value: unknown, field: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail(field, "must be an object");

const finite = (value: unknown, field: string): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(field, "must be a finite number");

const string = (value: unknown, field: string): string =>
  typeof value === "string" ? value : fail(field, "must be a string");

const boolean = (value: unknown, field: string): boolean =>
  typeof value === "boolean" ? value : fail(field, "must be a boolean");

const description = (value: unknown, field: string): string | null =>
  value === null || typeof value === "string"
    ? value
    : fail(field, "must be a string or null");

const availability = (value: unknown, field: string): SkillAvailability =>
  typeof value === "string" && AVAILABILITIES.has(value)
    ? value as SkillAvailability
    : fail(field, "names no supported availability");

function nullableName<T extends string>(
  value: unknown,
  field: string,
  names: ReadonlySet<string>,
): T | null {
  if (value === null) return null;
  return typeof value === "string" && names.has(value)
    ? value as T
    : fail(field, "names no known value");
}

function parseRecord(value: unknown, index: number): SkillCatalogueRecord {
  const field = `[${index}]`;
  const raw = object(value, field);
  if (!Number.isSafeInteger(raw.id) || (raw.id as number) < 0) {
    fail(`${field}.id`, "must be a non-negative safe integer");
  }

  return {
    id: raw.id as number,
    name: string(raw.name, `${field}.name`),
    profession: nullableName<Profession>(
      raw.profession,
      `${field}.profession`,
      PROFESSION_NAMES,
    ),
    attribute: nullableName<Attribute>(
      raw.attribute,
      `${field}.attribute`,
      ATTRIBUTE_NAMES,
    ),
    elite: boolean(raw.elite, `${field}.elite`),
    type: TYPES.has(raw.type as string) ? raw.type as SkillType : fail(`${field}.type`, "must be a known skill type"),
    availability: availability(raw.availability, `${field}.availability`),
    energyCost: finite(raw.energyCost, `${field}.energyCost`),
    adrenalineCost: finite(raw.adrenalineCost, `${field}.adrenalineCost`),
    healthCost: finite(raw.healthCost, `${field}.healthCost`),
    overcast: finite(raw.overcast, `${field}.overcast`),
    activationSeconds: finite(raw.activationSeconds, `${field}.activationSeconds`),
    aftercastSeconds: finite(raw.aftercastSeconds, `${field}.aftercastSeconds`),
    rechargeSeconds: finite(raw.rechargeSeconds, `${field}.rechargeSeconds`),
    description: description(raw.description, `${field}.description`),
    hasIcon: boolean(raw.hasIcon, `${field}.hasIcon`),
  };
}

/** Rejects the whole response when any record is malformed. */
export function parseSkillCatalogue(value: unknown): readonly SkillCatalogueRecord[] {
  const records = Array.isArray(value) ? value : fail("", "must be an array");
  if (records.length === 0) fail("", "must not be empty");
  const parsed = records.map(parseRecord);
  const ids = new Set<number>();
  for (const [index, record] of parsed.entries()) {
    if (ids.has(record.id)) {
      fail(`[${index}].id`, `duplicates skill ${record.id}`);
    }
    ids.add(record.id);
  }
  return parsed;
}
