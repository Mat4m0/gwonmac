/**
 * The one data model behind the hero-builds toolbox: what a build is, what a
 * team is, and what a stored library file holds. Several other modules read
 * these shapes, so this is deliberately the only place any of them exist.
 *
 * Two product decisions are load-bearing enough that the types enforce them
 * rather than trusting callers:
 *
 * 1. A team slot *references* a build by id; it never embeds one. Builds are
 * shared atoms, and every affordance the prototype designs around — the
 * permanent "used in N teams" banner, a fork that rebinds the teams you
 * choose, the "change all of them, or fork a variant" question asked at the
 * moment of divergence — exists only because two teams can point at the
 * same build. Flattening a build into its slots would delete the feature,
 * not simplify it. So `TeamSlot.build` is a `BuildId`, and because ids are
 * branded there is no shape in this file that lets a `Build` sit in a slot.
 *
 * 2. Lineage is exactly one level deep. `Build.parent` names the build this
 * one was forked from, and forking a variant keeps the same root rather
 * than growing a chain — `forkParentOf` is the single place that holds
 * that. A chain would buy tidier diagrams and cost orphan repair on every
 * delete, while two levels already answer both questions anyone asks:
 * "what is this based on?" and "what did I change?". Deleting a parent
 * promotes its variants to roots, so a dangling `parent` is a state the
 * library genuinely reaches — `parentOf` answers `null` for it instead of
 * assuming the link resolves.
 *
 * No I/O, no Electron, no filesystem, no IPC: main and the renderer both
 * import this file, and it must stay importable by both.
 *
 * Where this deliberately departs from the prototype, and why:
 * - `lastUsed` is an epoch-millisecond timestamp, not the prototype's
 * "days ago" integer. That integer is a fixture convenience; a stored
 * record cannot hold a value that silently rots between sessions.
 * - Skill and hero identifiers are the client's numeric ids, not the
 * prototype's `"livia"`-style slugs. The slugs were a mock's convenience;
 * the codecs and the client both speak numbers.
 * - Attribute ranks stop at 12, which is what the game's own cumulative cost
 * table admits (13 entries, ranks 0-12).
 * The prototype's 16-entry table extends past anything a stored build can
 * hold, and a rank of 15 in a saved record is not a value to round-trip,
 * it is a bug to make unrepresentable.
 */

// The brand is declared, never exported and never constructed, so the only way
// to produce a branded value is one of the minting functions below. That keeps
// "which kind of id is this" a compile-time question instead of the prototype's
// runtime `id.startsWith("t_")`.
declare const brand: unique symbol;
type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

/** A build's identity within one library. Never interchangeable with a `TeamId`. */
export type BuildId = Brand<string, "BuildId">;

/** A team's identity within one library. */
export type TeamId = Brand<string, "TeamId">;

/** A skill's numeric id as the client knows it. */
export type SkillId = Brand<number, "SkillId">;

/**
 * A hero's numeric `HeroID` as the client knows it. The reference-data module
 * that owns the hero table mints these; nothing else should. `0` is the
 * client's `NoHero` sentinel and must never be stored — an unassigned slot
 * carries `null`, so the sentinel has no second spelling here.
 */
export type HeroId = Brand<number, "HeroId">;

export const buildId = (value: string): BuildId => value as BuildId;
export const teamId = (value: string): TeamId => value as TeamId;
export const skillId = (value: number): SkillId => value as SkillId;
export const heroId = (value: number): HeroId => value as HeroId;

/**
 * The ten playable professions, by the acronym the UI shows. `Any` (the
 * prototype's `X`) is a property of PvE-only *skills*, not of a character, and
 * so is not one of these. These acronyms are display identity: the template
 * codecs carry the numeric profession id, never this string.
 */
export type Profession =
  | "W"
  | "R"
  | "Mo"
  | "N"
  | "Me"
  | "E"
  | "A"
  | "Rt"
  | "P"
  | "D";

/** Primary and secondary. `null` secondary is a monoclass character. */
export type ProfessionPair = readonly [
  primary: Profession,
  secondary: Profession | null,
];

/**
 * Every attribute the client defines, by its source name
 * (`GWCA/Constants/Constants.h:64-77`). The ids 26-28 in that enum are unnamed
 * and unexplained, and the `None = 255` sentinel is an in-memory marker rather
 * than a rank anyone invests in; neither has a name here, so neither can be
 * written into a stored build.
 */
export type Attribute =
  | "FastCasting"
  | "IllusionMagic"
  | "DominationMagic"
  | "InspirationMagic"
  | "BloodMagic"
  | "DeathMagic"
  | "SoulReaping"
  | "Curses"
  | "AirMagic"
  | "EarthMagic"
  | "FireMagic"
  | "WaterMagic"
  | "EnergyStorage"
  | "HealingPrayers"
  | "SmitingPrayers"
  | "ProtectionPrayers"
  | "DivineFavor"
  | "Strength"
  | "AxeMastery"
  | "HammerMastery"
  | "Swordsmanship"
  | "Tactics"
  | "BeastMastery"
  | "Expertise"
  | "WildernessSurvival"
  | "Marksmanship"
  | "DaggerMastery"
  | "DeadlyArts"
  | "ShadowArts"
  | "Communing"
  | "RestorationMagic"
  | "ChannelingMagic"
  | "CriticalStrikes"
  | "SpawningPower"
  | "SpearMastery"
  | "Command"
  | "Motivation"
  | "Leadership"
  | "ScytheMastery"
  | "WindPrayers"
  | "EarthPrayers"
  | "Mysticism";

/** Invested rank. Runes and bonuses raise the effective rank; a record holds this. */
export type AttributeRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Only the attributes actually invested in appear. An absent attribute is rank 0. */
export type AttributeRanks = Readonly<Partial<Record<Attribute, AttributeRank>>>;

/** The eight positions on a bar. */
export type SkillSlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** An empty slot is a real, saveable state — a half-written bar is not corrupt. */
export type SkillSlot = SkillId | null;

/**
 * Exactly eight slots. A tuple rather than `SkillSlot[]` because "eight" is the
 * whole shape of a Guild Wars bar: a seven- or nine-element bar is not a build
 * with a small mistake in it, it is not a build.
 */
export type SkillBar = readonly [
  SkillSlot,
  SkillSlot,
  SkillSlot,
  SkillSlot,
  SkillSlot,
  SkillSlot,
  SkillSlot,
  SkillSlot,
];

/**
 * One `SkillSlotIndex` per position of `Bar`. The type parameter is not
 * flexibility — it is the only spelling TypeScript treats as *homomorphic*.
 * Written against `SkillBar` directly, the mapped type maps every key an array
 * has, `length` among them, and stops constraining the length at all.
 */
type OnePerSlot<Bar extends readonly unknown[]> = {
  readonly [Slot in keyof Bar]: SkillSlotIndex;
};

/**
 * The eight positions as values, so every module that walks a bar walks the
 * same eight and indexes the tuple by a literal rather than by a `number`.
 *
 * The `satisfies` clause is shaped from `SkillBar`, not from
 * `readonly SkillSlotIndex[]`. Membership alone would accept a six-element
 * list — and a six-element list here is a validator that silently stops
 * checking the last two positions of every bar in the library, with `tsc` and
 * every test still green. Mapping over the tuple makes the length part of the
 * type, so the count and the bar cannot be changed apart.
 */
export const SKILL_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7] as const satisfies OnePerSlot<SkillBar>;

/**
 * A bar built from a per-position function.
 *
 * Written out rather than looped because `Array.from({ length: 8 }, ...)` types
 * as an array, not a tuple, and every construction site was closing that gap
 * with `as unknown as SkillBar`. A double cast keeps compiling after the thing
 * it asserts stops being true — it would survive `SkillBar` growing a ninth
 * slot, at every site, silently. Eight literal calls cannot: the compiler
 * checks the length here, so no call site has to assert it.
 */
export function skillBarOf(fill: (slot: SkillSlotIndex) => SkillSlot): SkillBar {
  return [
    fill(0), fill(1), fill(2), fill(3),
    fill(4), fill(5), fill(6), fill(7),
  ];
}

export interface Build {
  readonly id: BuildId;
  readonly name: string;
  readonly professions: ProfessionPair;
  readonly skills: SkillBar;
  readonly attributes: AttributeRanks;
  /** One tag vocabulary is shared with teams: "vanquish" means the same on both. */
  readonly tags: readonly string[];
  readonly notes: string;
  readonly favourite: boolean;
  /** Epoch milliseconds, or `null` for a build that has never been applied. */
  readonly lastUsed: number | null;
  /**
   * The build this one was forked from, or `null` for a root. One level only:
   * see `forkParentOf`. A parent that no longer exists is not an error — the
   * variant is simply a root again, and `parentOf` says so.
   */
  readonly parent: BuildId | null;
  /**
   * Where an imported build came from, for a build that has no parent to
   * explain it. `null` for anything the player made here.
   */
  readonly origin: string | null;
}

/** What a hero does when it is not following an explicit order. */
export type HeroBehaviour = "fight" | "guard" | "avoid";

/** The mode a team is meant for. `"none"` is "I never said", not "normal". */
export type TeamMode = "none" | "normal" | "hard";

/**
 * One party position. `build` is an id and only an id — see the header. Slot 0
 * is the player: it carries no hero and no behaviour, which is why both are
 * nullable rather than the slot being a second shape to iterate around.
 */
export interface TeamSlot {
  readonly build: BuildId | null;
  readonly hero: HeroId | null;
  readonly behaviour: HeroBehaviour | null;
}

/** Eight positions, index 0 being the player. Fixed length for the same reason a bar is. */
export type TeamSlots = readonly [
  TeamSlot,
  TeamSlot,
  TeamSlot,
  TeamSlot,
  TeamSlot,
  TeamSlot,
  TeamSlot,
  TeamSlot,
];

/**
 * How many positions a party has, anchored to `TeamSlots` rather than written
 * out. A bar also holds eight things, and the two eights are unrelated — a
 * validator that reached for `SKILL_SLOTS.length` here would keep working right
 * up until one of them changed.
 */
export const PARTY_SIZE: TeamSlots["length"] = 8;

/**
 * The eight party positions as a type, the counterpart of `SkillSlotIndex`.
 * Separate from it for the reason `PARTY_SIZE` is separate from
 * `SKILL_SLOTS.length`: the two eights are unrelated and must stay free to
 * change apart. Indexing `TeamSlots` with this reads a `TeamSlot` rather than a
 * `TeamSlot | undefined`, so walking a party needs no non-null assertion.
 */
export type TeamSlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * A party built from a per-position function. Index 0 is the player.
 *
 * The same reasoning as `skillBarOf`, and deliberately a second function rather
 * than one generic over both: a bar holds eight things and a party holds eight
 * things, and the two eights are unrelated. One shared helper is how they would
 * quietly become one number.
 */
export function teamSlotsOf(
  fill: (position: TeamSlotIndex) => TeamSlot,
): TeamSlots {
  return [
    fill(0), fill(1), fill(2), fill(3),
    fill(4), fill(5), fill(6), fill(7),
  ];
}

/**
 * The party with every position passed through `map`.
 *
 * `slots.map(...)` is the obvious spelling and it returns `TeamSlot[]`, losing
 * the length — which is why rebinding a build id across a library was written
 * five times as a `.map` followed by a cast back. Going through `teamSlotsOf`
 * keeps the eight in the type the whole way.
 */
export function mapTeamSlots(
  slots: TeamSlots,
  map: (slot: TeamSlot, position: TeamSlotIndex) => TeamSlot,
): TeamSlots {
  return teamSlotsOf((position) => map(slots[position], position));
}

const emptyHeroSlot = (): TeamSlot => ({
  build: null,
  hero: null,
  behaviour: "guard",
});

/** A hero position is occupied even when an imported build is missing its hero. */
export const teamSlotHasMember = (slot: TeamSlot): boolean =>
  slot.hero !== null || slot.build !== null;

/**
 * Keep the player fixed and pack every hero record toward the front. Hero,
 * build, and behaviour move as one record so editing order cannot separate
 * settings that belong together.
 */
export function compactTeamMembers(slots: TeamSlots): TeamSlots {
  const members = slots.slice(1).filter(teamSlotHasMember);
  return teamSlotsOf((position) => position === 0
    ? slots[0]
    : members[position - 1] ?? emptyHeroSlot());
}

/** Remove one hero record and close the gap it leaves. The player is immutable. */
export function removeTeamMember(
  slots: TeamSlots,
  position: TeamSlotIndex,
): TeamSlots {
  if (position === 0 || !teamSlotHasMember(slots[position])) return slots;
  return compactTeamMembers(mapTeamSlots(slots, (slot, current) =>
    current === position ? emptyHeroSlot() : slot));
}

/**
 * Move one hero record to a visible party position. Empty destinations mean
 * "move to the end"; no gap is ever stored.
 */
export function moveTeamMember(
  slots: TeamSlots,
  from: TeamSlotIndex,
  to: TeamSlotIndex,
): TeamSlots {
  if (from === 0 || to === 0 || from === to || !teamSlotHasMember(slots[from])) return slots;

  const members = slots.slice(1).filter(teamSlotHasMember);
  const source = members.indexOf(slots[from]);
  if (source < 0) return slots;

  const [member] = members.splice(source, 1);
  if (!member) return slots;
  members.splice(Math.min(to - 1, members.length), 0, member);
  return teamSlotsOf((position) => position === 0
    ? slots[0]
    : members[position - 1] ?? emptyHeroSlot());
}

export interface Team {
  readonly id: TeamId;
  readonly name: string;
  readonly tags: readonly string[];
  readonly mode: TeamMode;
  readonly favourite: boolean;
  /** Epoch milliseconds, or `null` for a team that has never been applied. */
  readonly lastUsed: number | null;
  readonly notes: string;
  readonly slots: TeamSlots;
}

/** The stored file's version. A literal, so an older file fails to type-check. */
export const LIBRARY_VERSION = 3;

export interface BuildLibrary {
  readonly version: typeof LIBRARY_VERSION;
  readonly builds: readonly Build[];
  readonly teams: readonly Team[];
  /**
   * The one tag vocabulary, in the order groups are shown. This is the file's
   * group ordering: grouping is a lens over these tags, so the vocabulary and
   * its order are stored once here rather than derived from, and disagreeing
   * with, the tags scattered across builds and teams.
   */
  readonly tags: readonly string[];
}

/** The build with this id, or `null`. The lookup the reference model runs on. */
export function buildById(
  library: BuildLibrary,
  id: BuildId,
): Build | null {
  return library.builds.find((candidate) => candidate.id === id) ?? null;
}

export function teamById(library: BuildLibrary, id: TeamId): Team | null {
  return library.teams.find((candidate) => candidate.id === id) ?? null;
}

/** Direct children of `id`. One level deep, so these never have children of their own. */
export function variantsOf(
  library: BuildLibrary,
  id: BuildId,
): readonly Build[] {
  return library.builds.filter((candidate) => candidate.parent === id);
}

/**
 * The build `build` was forked from, or `null` — both for a root and for a
 * variant whose parent has been deleted. Deleting a parent promotes its
 * variants rather than cascading, so an unresolvable link is an ordinary state
 * and not something to throw over.
 */
export function parentOf(library: BuildLibrary, build: Build): Build | null {
  return build.parent === null ? null : buildById(library, build.parent);
}

/** Every team with at least one slot pointing at `id`, each listed once. */
export function usedBy(library: BuildLibrary, id: BuildId): readonly Team[] {
  return library.teams.filter((team) =>
    team.slots.some((slot) => slot.build === id),
  );
}

/**
 * The `parent` a fork of `build` must carry. This is the whole one-level rule:
 * forking a root makes a variant of it, and forking a variant makes a sibling
 * of that variant rather than a grandchild. Every fork path must go through
 * here — assigning `parent: source.id` directly is how a chain gets in.
 */
export function forkParentOf(build: Build): BuildId {
  return build.parent ?? build.id;
}

export function forkBuild(
  library: BuildLibrary,
  sourceId: BuildId,
  nextId: BuildId,
): BuildLibrary {
  const source = buildById(library, sourceId);
  if (!source) throw new Error("Build not found");
  return {
    ...library,
    builds: [{
      ...structuredClone(source),
      id: nextId,
      name: `${source.name} — variant`,
      parent: forkParentOf(source),
      favourite: false,
      lastUsed: null,
    }, ...library.builds],
  };
}

export function removeBuild(library: BuildLibrary, removedId: BuildId): BuildLibrary {
  return {
    ...library,
    builds: library.builds
      .filter((build) => build.id !== removedId)
      .map((build) => build.parent === removedId ? { ...build, parent: null } : build),
    teams: library.teams.map((team) => ({
      ...team,
      slots: mapTeamSlots(team.slots, (slot) =>
        slot.build === removedId ? { ...slot, build: null } : slot),
    })),
  };
}

export function exclusiveTeamBuildIds(
  library: BuildLibrary,
  selectedTeamId: TeamId,
): readonly BuildId[] {
  const team = teamById(library, selectedTeamId);
  if (!team) return [];
  const referenced = new Set(team.slots.flatMap((slot) =>
    slot.build === null ? [] : [slot.build]));
  for (const other of library.teams) {
    if (other.id === team.id) continue;
    for (const slot of other.slots) if (slot.build !== null) referenced.delete(slot.build);
  }
  return [...referenced];
}

export function removeTeam(
  library: BuildLibrary,
  removedId: TeamId,
  removeExclusiveBuilds = false,
): BuildLibrary {
  const exclusive = removeExclusiveBuilds
    ? exclusiveTeamBuildIds(library, removedId)
    : [];
  const withoutTeam = {
    ...library,
    teams: library.teams.filter((team) => team.id !== removedId),
  };
  return exclusive.reduce(removeBuild, withoutTeam);
}
