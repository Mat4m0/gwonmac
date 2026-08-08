/**
 * Parses and repairs the durable build-library domain without performing I/O.
 * Disk and transport callers receive the same canonical value from this boundary.
 */
import { AppError } from "../errors.js";
import { ATTRIBUTES, PROFESSIONS } from "./heroes.js";
import {
  LIBRARY_VERSION,
  PARTY_SIZE,
  SKILL_SLOTS,
  buildId,
  heroId,
  skillBarOf,
  skillId,
  teamId,
  teamSlotsOf,
  type Attribute,
  type AttributeRank,
  type AttributeRanks,
  type Build,
  type BuildLibrary,
  type HeroBehaviour,
  type Profession,
  type ProfessionPair,
  type SkillBar,
  type SkillSlot,
  type Team,
  type TeamMode,
  type TeamSlot,
} from "./library.js";

const BEHAVIOURS = new Set<HeroBehaviour>(["fight", "guard", "avoid"]);
const MODES = new Set<TeamMode>(["none", "normal", "hard"]);
const PROFESSION_NAMES = new Set<string>(Object.keys(PROFESSIONS));
const ATTRIBUTE_NAMES = new Set<string>(Object.keys(ATTRIBUTES));

export const EMPTY_LIBRARY: BuildLibrary = Object.freeze({
  version: LIBRARY_VERSION,
  builds: Object.freeze([]),
  teams: Object.freeze([]),
  tags: Object.freeze([]),
});

const fail = (field: string, why: string): never => {
  throw new AppError("bad_build_library", `buildLibrary.${field} ${why}`);
};

const object = (value: unknown, field: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail(field, "must be an object");
const array = (value: unknown, field: string): readonly unknown[] =>
  Array.isArray(value) ? value : fail(field, "must be an array");
const string = (value: unknown, field: string): string =>
  typeof value === "string" ? value : fail(field, "must be a string");
const boolean = (value: unknown, field: string): boolean =>
  typeof value === "boolean" ? value : fail(field, "must be a boolean");
const id = (value: unknown, field: string): string => {
  const parsed = string(value, field);
  return parsed.length > 0 ? parsed : fail(field, "must not be empty");
};
const strings = (value: unknown, field: string): readonly string[] =>
  array(value, field).map((entry, index) => string(entry, `${field}[${index}]`));
const timestamp = (value: unknown, field: string): number | null => {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(field, "must be epoch milliseconds or null");
};
const profession = (value: unknown, field: string): Profession =>
  PROFESSION_NAMES.has(string(value, field))
    ? value as Profession
    : fail(field, "names no profession");
const professions = (value: unknown, field: string): ProfessionPair => {
  const parsed = array(value, field);
  if (parsed.length !== 2) fail(field, "must be a primary and a secondary");
  return [
    profession(parsed[0], `${field}[0]`),
    parsed[1] === null ? null : profession(parsed[1], `${field}[1]`),
  ];
};
const skill = (value: unknown, field: string): SkillSlot => {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? skillId(value)
    : fail(field, "must be a skill id or null");
};
const skills = (value: unknown, field: string): SkillBar => {
  const parsed = array(value, field);
  if (parsed.length !== SKILL_SLOTS.length) {
    fail(field, `must hold ${SKILL_SLOTS.length} slots`);
  }
  return skillBarOf((slot) => skill(parsed[slot], `${field}[${slot}]`));
};
const attributes = (value: unknown, field: string): AttributeRanks => {
  const parsed = object(value, field);
  const result: Partial<Record<Attribute, AttributeRank>> = {};
  for (const [name, rank] of Object.entries(parsed)) {
    if (!ATTRIBUTE_NAMES.has(name)) fail(`${field}.${name}`, "names no attribute");
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 0 || rank > 12) {
      fail(`${field}.${name}`, "must be a rank from 0 to 12");
    }
    result[name as Attribute] = rank as AttributeRank;
  }
  return result;
};

function parseBuild(value: unknown, field: string): Build {
  const raw = object(value, field);
  return {
    id: buildId(id(raw.id, `${field}.id`)),
    name: string(raw.name, `${field}.name`),
    professions: professions(raw.professions, `${field}.professions`),
    skills: skills(raw.skills, `${field}.skills`),
    attributes: attributes(raw.attributes, `${field}.attributes`),
    tags: strings(raw.tags, `${field}.tags`),
    notes: string(raw.notes, `${field}.notes`),
    favourite: boolean(raw.favourite, `${field}.favourite`),
    lastUsed: timestamp(raw.lastUsed, `${field}.lastUsed`),
    parent: raw.parent === null ? null : buildId(id(raw.parent, `${field}.parent`)),
    origin: raw.origin === null ? null : string(raw.origin, `${field}.origin`),
  };
}

function parseSlot(value: unknown, field: string, known: ReadonlySet<string>): TeamSlot {
  const raw = object(value, field);
  const named = raw.build === null ? null : id(raw.build, `${field}.build`);
  return {
    build: named !== null && known.has(named) ? buildId(named) : null,
    hero: raw.hero === null
      ? null
      : typeof raw.hero === "number" && Number.isSafeInteger(raw.hero) && raw.hero > 0
        ? heroId(raw.hero)
        : fail(`${field}.hero`, "must be a hero id or null"),
    behaviour: raw.behaviour === null
      ? null
      : BEHAVIOURS.has(raw.behaviour as HeroBehaviour)
        ? raw.behaviour as HeroBehaviour
        : fail(`${field}.behaviour`, "names no hero behaviour"),
  };
}

function parseTeam(value: unknown, field: string, known: ReadonlySet<string>): Team {
  const raw = object(value, field);
  const slots = array(raw.slots, `${field}.slots`);
  if (slots.length !== PARTY_SIZE) fail(`${field}.slots`, `must hold ${PARTY_SIZE} positions`);
  return {
    id: teamId(id(raw.id, `${field}.id`)),
    name: string(raw.name, `${field}.name`),
    tags: strings(raw.tags, `${field}.tags`),
    mode: MODES.has(raw.mode as TeamMode)
      ? raw.mode as TeamMode
      : fail(`${field}.mode`, "names no team mode"),
    favourite: boolean(raw.favourite, `${field}.favourite`),
    lastUsed: timestamp(raw.lastUsed, `${field}.lastUsed`),
    notes: string(raw.notes, `${field}.notes`),
    slots: teamSlotsOf((position) =>
      parseSlot(slots[position], `${field}.slots[${position}]`, known)),
  };
}

function unique(records: readonly { id: string }[], field: string): Set<string> {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) fail(field, `holds duplicate id ${JSON.stringify(record.id)}`);
    seen.add(record.id);
  }
  return seen;
}

export function parseBuildLibrary(raw: unknown): BuildLibrary {
  const source = object(raw, "");
  if (source.version !== LIBRARY_VERSION) {
    fail("version", `${JSON.stringify(source.version)} is not readable`);
  }
  const builds = array(source.builds, "builds").map((build, index) =>
    parseBuild(build, `builds[${index}]`));
  const known = unique(builds, "builds");
  const teams = array(source.teams, "teams").map((team, index) =>
    parseTeam(team, `teams[${index}]`, known));
  unique(teams, "teams");
  return {
    version: LIBRARY_VERSION,
    builds,
    teams,
    tags: strings(source.tags, "tags"),
  };
}
