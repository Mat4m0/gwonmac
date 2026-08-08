/**
 * The durable half of the hero-builds toolbox: read and write `build-library.json`.
 *
 * The shape lives in `src/shared/builds/library.ts` because the renderer needs
 * it too. What lives here is everything that touches a disk, and one decision
 * that shapes the whole feature:
 *
 * **The library is the source of truth. The game's template folder is a
 * projection of it, written on demand.**
 *
 * The alternative — treating `app:/Templates/Skills` as the library and reading
 * it back — gives two writers to one directory, and the other writer is the
 * game, which this project does not control. `AGENTS.md` asks for one owner per
 * concept before anything else; this is that answer for builds.
 *
 * ## Why this is stricter than `settings.ts` in one place and softer in another
 *
 * Stricter: duplicate ids throw. `buildById` returns the first match, so a file
 * with two builds sharing an id silently loses one of them and rebinds every
 * team that pointed at it. That is data loss disguised as a successful load.
 *
 * Softer: a team slot naming a build that is not in the file is repaired to
 * `null` rather than refused. `TeamSlot.build` is already nullable — an empty
 * slot is an ordinary state — and deleting a build does exactly this repair to
 * every slot that held it. Refusing instead would mean one dangling reference
 * costs a player their entire collection, which is a far worse answer than one
 * empty slot in one team.
 *
 * ## Why a corrupt library is louder than corrupt settings
 *
 * `loadSettings` recovers by returning defaults, and defaults are a perfectly
 * good place to be. There is no such thing as a good default library: an empty
 * one is a player's whole collection gone. So the file is moved aside intact
 * and `onRecovered` fires — the caller is expected to tell somebody, not to
 * treat the empty result as normal.
 */
import { readdir, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
  type BuildId,
  type BuildLibrary,
  type HeroBehaviour,
  type Profession,
  type ProfessionPair,
  type SkillBar,
  type SkillSlot,
  type SkillSlotIndex,
  type Team,
  type TeamMode,
  type TeamSlot,
} from "../../shared/builds/library.js";
import { ATTRIBUTES, PROFESSIONS } from "../../shared/builds/heroes.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "./atomic-file.js";

/** Owner-only: a build library is a player's own work, not shared state. */
const LIBRARY_MODE = 0o600;
const CORRUPT_BACKUPS_KEPT = 3;

const BEHAVIOURS = new Set<HeroBehaviour>(["fight", "guard", "avoid"]);
const MODES = new Set<TeamMode>(["none", "normal", "hard"]);
const PROFESSION_NAMES = new Set<string>(Object.keys(PROFESSIONS));
const ATTRIBUTE_NAMES = new Set<string>(Object.keys(ATTRIBUTES));

/** A new profile's library. Not a default to fall back to — see the header. */
export const EMPTY_LIBRARY: BuildLibrary = {
  version: LIBRARY_VERSION,
  builds: [],
  teams: [],
  tags: [],
};

const fail = (field: string, why: string): never => {
  throw new AppError("bad_build_library", `buildLibrary.${field} ${why}`);
};

const asObject = (value: unknown, field: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(field, "must be an object");

const asArray = (value: unknown, field: string): readonly unknown[] =>
  Array.isArray(value) ? value : fail(field, "must be an array");

const asString = (value: unknown, field: string): string =>
  typeof value === "string" ? value : fail(field, "must be a string");

const asBoolean = (value: unknown, field: string): boolean =>
  typeof value === "boolean" ? value : fail(field, "must be a boolean");

/** A non-empty identifier. Empty ids compare equal to each other and to nothing. */
const asId = (value: unknown, field: string): string => {
  const text = asString(value, field);
  return text.length > 0 ? text : fail(field, "must not be empty");
};

const asStringArray = (value: unknown, field: string): readonly string[] =>
  asArray(value, field).map((entry, index) => asString(entry, `${field}[${index}]`));

/** Epoch milliseconds or `null`. A non-finite or negative stamp is not a time. */
const asTimestamp = (value: unknown, field: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(field, "must be epoch milliseconds or null");
  }
  return value;
};

const asProfession = (value: unknown, field: string): Profession =>
  PROFESSION_NAMES.has(asString(value, field))
    ? (value as Profession)
    : fail(field, `names no profession: ${JSON.stringify(value)}`);

const asProfessionPair = (value: unknown, field: string): ProfessionPair => {
  const pair = asArray(value, field);
  if (pair.length !== 2) return fail(field, "must be a primary and a secondary");
  const secondary = pair[1] === null ? null : asProfession(pair[1], `${field}[1]`);
  return [asProfession(pair[0], `${field}[0]`), secondary];
};

const asSkillSlot = (value: unknown, field: string): SkillSlot => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(field, "must be a skill id or null");
  }
  return skillId(value);
};

/**
 * Exactly eight. The tuple type says so and a stored file cannot be made to
 * respect a type, so this is where the claim is actually enforced — every
 * module downstream indexes `SKILL_SLOTS` into this and would read `undefined`
 * off a short bar.
 */
const asSkillBar = (value: unknown, field: string): SkillBar => {
  const slots = asArray(value, field);
  if (slots.length !== SKILL_SLOTS.length) {
    return fail(field, `must hold ${SKILL_SLOTS.length} slots, not ${slots.length}`);
  }
  return skillBarOf((slot) => asSkillSlot(slots[slot], `${field}[${slot}]`));
};

const asAttributeRanks = (value: unknown, field: string): AttributeRanks => {
  const raw = asObject(value, field);
  const ranks: Partial<Record<Attribute, AttributeRank>> = {};
  for (const [name, rank] of Object.entries(raw)) {
    if (!ATTRIBUTE_NAMES.has(name)) {
      return fail(`${field}.${name}`, "names no attribute");
    }
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 0 || rank > 12) {
      return fail(`${field}.${name}`, "must be a rank from 0 to 12");
    }
    ranks[name as Attribute] = rank as AttributeRank;
  }
  return ranks;
};

function parseBuild(value: unknown, field: string): Build {
  const raw = asObject(value, field);
  return {
    id: buildId(asId(raw.id, `${field}.id`)),
    name: asString(raw.name, `${field}.name`),
    professions: asProfessionPair(raw.professions, `${field}.professions`),
    skills: asSkillBar(raw.skills, `${field}.skills`),
    attributes: asAttributeRanks(raw.attributes, `${field}.attributes`),
    tags: asStringArray(raw.tags, `${field}.tags`),
    notes: asString(raw.notes, `${field}.notes`),
    favourite: asBoolean(raw.favourite, `${field}.favourite`),
    lastUsed: asTimestamp(raw.lastUsed, `${field}.lastUsed`),
    // A `parent` naming a build that is gone is an ordinary state: deleting a
    // parent promotes its variants rather than cascading. `parentOf` answers
    // `null` for it, so nothing here has to resolve it.
    parent: raw.parent === null ? null : buildId(asId(raw.parent, `${field}.parent`)),
    origin: raw.origin === null ? null : asString(raw.origin, `${field}.origin`),
  };
}

/**
 * The positions on this slot's bar the hero may not use of its own accord.
 * Deduplicated, because the set is what is meant and a repeated index would
 * render as a second identical toggle.
 */
const asDisabled = (value: unknown, field: string): readonly SkillSlotIndex[] => {
  const seen = new Set<SkillSlotIndex>();
  for (const [index, entry] of asArray(value, field).entries()) {
    const slot = SKILL_SLOTS.find((candidate) => candidate === entry);
    if (slot === undefined) return fail(`${field}[${index}]`, "is not a bar position");
    seen.add(slot);
  }
  return [...seen];
};

function parseSlot(value: unknown, field: string, known: ReadonlySet<string>): TeamSlot {
  const raw = asObject(value, field);
  const named = raw.build === null ? null : asId(raw.build, `${field}.build`);
  return {
    // The one repair this parser makes, and the header says why: a reference to
    // a build that is not in the file becomes the empty slot it already means.
    build: named !== null && known.has(named) ? buildId(named) : null,
    hero:
      raw.hero === null
        ? null
        : typeof raw.hero === "number" && Number.isSafeInteger(raw.hero) && raw.hero > 0
          ? heroId(raw.hero)
          : fail(`${field}.hero`, "must be a hero id or null"),
    behaviour:
      raw.behaviour === null
        ? null
        : BEHAVIOURS.has(raw.behaviour as HeroBehaviour)
          ? (raw.behaviour as HeroBehaviour)
          : fail(`${field}.behaviour`, "names no hero behaviour"),
    disabled: asDisabled(raw.disabled, `${field}.disabled`),
  };
}

function parseTeam(value: unknown, field: string, known: ReadonlySet<string>): Team {
  const raw = asObject(value, field);
  const slots = asArray(raw.slots, `${field}.slots`);
  if (slots.length !== PARTY_SIZE) {
    return fail(`${field}.slots`, `must hold ${PARTY_SIZE} party positions`);
  }
  const parsed = teamSlotsOf((position) =>
    parseSlot(slots[position], `${field}.slots[${position}]`, known),
  );
  return {
    id: teamId(asId(raw.id, `${field}.id`)),
    name: asString(raw.name, `${field}.name`),
    tags: asStringArray(raw.tags, `${field}.tags`),
    mode: MODES.has(raw.mode as TeamMode)
      ? (raw.mode as TeamMode)
      : fail(`${field}.mode`, "names no team mode"),
    favourite: asBoolean(raw.favourite, `${field}.favourite`),
    lastUsed: asTimestamp(raw.lastUsed, `${field}.lastUsed`),
    notes: asString(raw.notes, `${field}.notes`),
    slots: parsed,
  };
}

/** Ids have to be unique before anything can be looked up by one. */
function uniqueIds(records: readonly { id: string }[], field: string): Set<string> {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      fail(field, `holds two records with id ${JSON.stringify(record.id)}`);
    }
    seen.add(record.id);
  }
  return seen;
}

/**
 * Read a stored library, or throw `bad_build_library`. A version this build
 * does not know is refused rather than reinterpreted — the caller moves the
 * file aside intact, which is the only way a future format survives being
 * opened by an older app.
 */
export function parseBuildLibrary(raw: unknown): BuildLibrary {
  const src = asObject(raw, "");
  if (src.version !== LIBRARY_VERSION) {
    return fail("version", `${JSON.stringify(src.version)} is not readable`);
  }
  const builds = asArray(src.builds, "builds").map((build, index) =>
    parseBuild(build, `builds[${index}]`),
  );
  const known = uniqueIds(builds, "builds");
  const teams = asArray(src.teams, "teams").map((team, index) =>
    parseTeam(team, `teams[${index}]`, known),
  );
  uniqueIds(teams, "teams");
  return {
    version: LIBRARY_VERSION,
    builds,
    teams,
    tags: asStringArray(src.tags, "tags"),
  };
}

export async function loadBuildLibrary(
  path: string,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<BuildLibrary> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return EMPTY_LIBRARY;
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return recoverCorruptLibrary(path, onRecovered);
  }
  try {
    return parseBuildLibrary(raw);
  } catch {
    return recoverCorruptLibrary(path, onRecovered);
  }
}

/**
 * Move the unreadable file aside and start empty. The rename is what makes this
 * survivable: an empty library is not a default, it is the player's collection
 * missing, and the backup is the only copy left.
 */
async function recoverCorruptLibrary(
  path: string,
  onRecovered: ((backupPath: string) => void | Promise<void>) | undefined,
): Promise<BuildLibrary> {
  const backupPath = `${path}.corrupt-${Date.now()}`;
  try {
    await rename(path, backupPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
    return EMPTY_LIBRARY;
  }
  await pruneCorruptBackups(path);
  await onRecovered?.(backupPath);
  return EMPTY_LIBRARY;
}

/** Keep the three newest backups, as `settings.ts` does, and for the same reason. */
async function pruneCorruptBackups(libraryPath: string): Promise<void> {
  const directory = dirname(libraryPath);
  const prefix = `${basename(libraryPath)}.corrupt-`;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  const stale = names
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, at: Number(name.slice(prefix.length)) }))
    .filter(({ at }) => Number.isSafeInteger(at))
    .sort((left, right) => right.at - left.at)
    .slice(CORRUPT_BACKUPS_KEPT);
  await Promise.all(
    stale.map(({ name }) => unlink(join(directory, name)).catch(() => undefined)),
  );
}

/**
 * Write the library and return what was actually stored. The parse on the way
 * in is not ceremony: it is what stops a renderer bug from persisting a shape
 * the next launch would have to quarantine, and it applies the same dangling
 * reference repair, so what the caller gets back is what a reload would give.
 */
export async function saveBuildLibrary(
  path: string,
  value: BuildLibrary,
): Promise<BuildLibrary> {
  const cleaned = parseBuildLibrary(value);
  await writeAtomicJson(path, cleaned, LIBRARY_MODE);
  return cleaned;
}

/** Every build id a slot points at. The renderer's "used in N teams" runs on this. */
export function referencedBuildIds(library: BuildLibrary): ReadonlySet<BuildId> {
  const used = new Set<BuildId>();
  for (const team of library.teams) {
    for (const slot of team.slots) if (slot.build !== null) used.add(slot.build);
  }
  return used;
}
