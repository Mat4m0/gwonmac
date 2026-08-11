/**
 * The client's own numeric reference tables: which hero is id 7, which
 * profession is id 3, which attribute is id 35. Values are transcribed from
 * reviewed upstream client/GWToolbox constants; source names and exceptional
 * assumptions stay beside the affected tables. These are protocol values,
 * not presentation: getting one wrong does not produce a visibly broken build,
 * it produces a build that loads the wrong skill on the wrong hero. So this file
 * transcribes and does nothing else — no fallbacks, no derived guesses, no
 * "sensible default" for a value the source did not state.
 *
 * `library.ts` owns the model (`Profession`, `Attribute`, `AttributeRank`,
 * `HeroId`); this file owns the numbers behind it. That split is why the two
 * lookups below are shaped differently:
 *
 * - `PROFESSIONS` and `ATTRIBUTES` are keyed by the union `library.ts`
 * already defines, so a name this file spells differently, omits, or
 * invents is a compile error rather than something a test has to notice.
 * - `HEROES` is an array, because there is no hero union to key by: the names
 * here *are* the definition, and `HeroName` is derived from them.
 *
 * Three deliberate absences are **not present in the reviewed sources**. They
 * are absent rather than defaulted, because a plausible
 * wrong number is worse here than a missing one:
 *
 * 1. **Hero display names.** Read from the client at runtime and localised
 * (`Resources.cpp:1213-1221`); there is no English list to copy. The
 * internal name is the stable identifier and the honest degraded label, so
 * a hero with no catalogue entry shows `Norgu`, never `Hero 1`.
 * 2. **Hero professions.** Live in `GW::HeroInfo` (`Hero.h:40-41`) and are
 * never mirrored into a Toolbox table. Every hero needs a live read; what
 * differs between heroes is whether the answer is a *fact about the hero*
 * at all, which is what `Hero.kind` records.
 * 3. **Every profession's primary attribute.** The source asserts two of the
 * ten, in the trailing comment on `Constants.h:73`; `kProfessionAttributes`
 * in `TeamBuildEncoder.cpp:275-298` looks like the missing table and is
 * not — it is ordered by frequency of use and pads to five with `None`, so
 * Mesmer's entry begins with `DominationMagic`, and reading primaries out
 * of it would be a guess wearing a citation. A profession's primary is a
 * *rule*, not a wire value, and `validate.ts`'s `PRIMARY_ATTRIBUTE` is the
 * one table that states it, marking per line which two were read and which
 * eight are assumed. This file held those same two a second time with no
 * production reader, which made the pair a thing that could disagree
 * rather than a thing that could be corrected.
 *
 * The level-20 attribute point budget is likewise absent: it is a rule that
 * `validate.ts` owns and the evidence document states outright that the number
 * is in neither source tree, so there is nothing here to transcribe.
 */

import type { Attribute, AttributeRank, HeroId, Profession } from "./library.js";
import { heroId } from "./library.js";

/** The campaign under which the client files a hero's unlock achievement. */
export type Campaign =
  | "Prophecies"
  | "Factions"
  | "Nightfall"
  | "EyeOfTheNorth";

/**
 * What kind of thing a hero is, which is the one question this table can answer
 * about professions. A `"campaign"` hero has a fixed pair that simply has to be
 * read from the client once; the other two never have a stable answer to cache.
 *
 *  - `"razah"` — Razah alone. His professions are player-chosen exactly as a
 *    mercenary's are, which is why the panel-order comment has to explain where
 *    he sorts. Nothing in either source states a default, so validation must
 *    treat him as "unknown until observed" rather than pinning him to mesmer.
 *  - `"mercenary"` — `Merc1`-`Merc8`, clones of the account's own characters.
 *    Name, professions and appearance all come from the account, so a team
 *    record naming `Merc3` means something only on the account that wrote it,
 *    and "hero not unlocked" is not a claim we can make about one.
 */
export type HeroKind = "campaign" | "razah" | "mercenary";

/** The shape each row satisfies. `HEROES` below is the exported type's source. */
interface HeroFacts {
  readonly id: HeroId;
  /**
   * The `HeroID` enum identifier. Not the display name, which is localised and
   * read from the client — see the header.
   */
  readonly name: string;
  /**
   * Index into Toolbox's `HeroIndexToID`, which renders the dropdown in the
   * client's own hero-panel order. Slot 0 is `NoHero`, the player's own, so the
   * heroes below occupy 1-39.
   */
  readonly panelOrder: number;
  /** `null` for a mercenary: no campaign unlocks one, so this is empty, not missing. */
  readonly campaign: Campaign | null;
  readonly kind: HeroKind;
}

/**
 * The 39 real heroes, in `HeroID` order. `NoHero = 0` is not here — an
 * unassigned slot carries `null`, and the sentinel has no second spelling —
 * and neither is the `Count = 40` end marker.
 *
 * Every id fits in six bits, which the `EncodedTeamBuild` layout
 * (`TeamBuildEncoder.h:53`) assumes. A 41st hero would break that format
 * silently, so the ceiling is asserted in this table's test rather than left as
 * a remark.
 */
export const HEROES = [
  { id: heroId(1), name: "Norgu", panelOrder: 13, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(2), name: "Goren", panelOrder: 1, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(3), name: "Tahlkora", panelOrder: 7, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(4), name: "MasterOfWhispers", panelOrder: 10, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(5), name: "AcolyteJin", panelOrder: 4, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(6), name: "Koss", panelOrder: 2, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(7), name: "Dunkoro", panelOrder: 8, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(8), name: "AcolyteSousuke", panelOrder: 16, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(9), name: "Melonni", panelOrder: 27, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(10), name: "ZhedShadowhoof", panelOrder: 17, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(11), name: "GeneralMorgahn", panelOrder: 24, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(12), name: "MargridTheSly", panelOrder: 5, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(13), name: "Zenmai", panelOrder: 19, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(14), name: "Olias", panelOrder: 11, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(15), name: "Razah", panelOrder: 14, campaign: "Nightfall", kind: "razah" },
  { id: heroId(16), name: "MOX", panelOrder: 28, campaign: "Nightfall", kind: "campaign" },
  { id: heroId(17), name: "KeiranThackeray", panelOrder: 25, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(18), name: "Jora", panelOrder: 3, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(19), name: "PyreFierceshot", panelOrder: 6, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(20), name: "Anton", panelOrder: 20, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(21), name: "Livia", panelOrder: 12, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(22), name: "Hayda", panelOrder: 26, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(23), name: "Kahmu", panelOrder: 29, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(24), name: "Gwen", panelOrder: 15, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(25), name: "Xandra", panelOrder: 22, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(26), name: "Vekk", panelOrder: 18, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(27), name: "Ogden", panelOrder: 9, campaign: "EyeOfTheNorth", kind: "campaign" },
  { id: heroId(28), name: "Merc1", panelOrder: 30, campaign: null, kind: "mercenary" },
  { id: heroId(29), name: "Merc2", panelOrder: 31, campaign: null, kind: "mercenary" },
  { id: heroId(30), name: "Merc3", panelOrder: 32, campaign: null, kind: "mercenary" },
  { id: heroId(31), name: "Merc4", panelOrder: 33, campaign: null, kind: "mercenary" },
  { id: heroId(32), name: "Merc5", panelOrder: 34, campaign: null, kind: "mercenary" },
  { id: heroId(33), name: "Merc6", panelOrder: 35, campaign: null, kind: "mercenary" },
  { id: heroId(34), name: "Merc7", panelOrder: 36, campaign: null, kind: "mercenary" },
  { id: heroId(35), name: "Merc8", panelOrder: 37, campaign: null, kind: "mercenary" },
  { id: heroId(36), name: "Miku", panelOrder: 21, campaign: "Factions", kind: "campaign" },
  { id: heroId(37), name: "ZeiRi", panelOrder: 23, campaign: "Factions", kind: "campaign" },
  { id: heroId(38), name: "Devona", panelOrder: 38, campaign: "Prophecies", kind: "campaign" },
  { id: heroId(39), name: "GhostOfAlthea", panelOrder: 39, campaign: "Prophecies", kind: "campaign" },
] as const satisfies readonly HeroFacts[];

/** One row of `HEROES`. */
export type Hero = (typeof HEROES)[number];

/** The `HeroID` enum identifiers, which are also the fallback labels. */
export type HeroName = Hero["name"];

/** The lookup a stored record needs: slots hold the numeric id, nothing else. */
export const HERO_BY_ID: ReadonlyMap<HeroId, Hero> = new Map(
  HEROES.map((hero) => [hero.id, hero] as const),
);

/**
 * The fallback label for a hero id: the `HeroID` identifier with its words
 * separated, so `GhostOfAlthea` reads as `Ghost Of Althea`.
 *
 * Deliberately *not* a display-name table. The real display name is localised
 * and belongs to the client, and this file's header says so — adding an English
 * name column here would be a second answer to what a hero is called, and the
 * wrong one in nine languages. This is the derived spelling of the identifier
 * the table already holds, which is why it is a function over `HEROES` and not
 * a column in it.
 *
 * It lives here rather than in the panel because capture writes hero names into
 * the stored library. A library holding `GhostOfAlthea` beside a list showing
 * `Ghost Of Althea` is one hero rendered as two, and that outlives the session.
 *
 * An id the table does not know keeps its number rather than going blank: a
 * hero we cannot name is still a hero, and hiding the id hides the evidence.
 */
export function heroLabel(hero: HeroId): string {
  const known = HERO_BY_ID.get(hero);
  return known === undefined
    ? `Hero ${hero}`
    : known.name.replace(/([a-z])([A-Z])/gu, "$1 $2");
}

/**
 * The same heroes in the client's hero-panel order, which is the order a hero
 * picker must offer them in. Derived by sorting `HEROES` on `panelOrder` rather
 * than written out again: two orderings of the same 39 rows would be two places
 * to add the 40th.
 */
export const HEROES_IN_PANEL_ORDER: readonly Hero[] = [...HEROES].sort(
  (left, right) => left.panelOrder - right.panelOrder,
);

/** The shape each profession row satisfies. */
interface ProfessionFacts {
  readonly id: number;
  /** The English name from `Constants.h:18-19`; the key is the display acronym. */
  readonly name: string;
}

/**
 * The ten playable professions, keyed by the acronym `library.ts` stores.
 * `None = 0` is not a profession and so is not a row here; `PROFESSION_NONE_ID`
 * below is the sentinel a codec writes for an absent secondary.
 *
 * Id 10 needs four bits, which exactly fills the whisper format's fixed 4-bit
 * profession field (`TeamBuildEncoder.h:54-55`).
 */
export const PROFESSIONS = {
  W: { id: 1, name: "Warrior" },
  R: { id: 2, name: "Ranger" },
  Mo: { id: 3, name: "Monk" },
  N: { id: 4, name: "Necromancer" },
  Me: { id: 5, name: "Mesmer" },
  E: { id: 6, name: "Elementalist" },
  A: { id: 7, name: "Assassin" },
  Rt: { id: 8, name: "Ritualist" },
  P: { id: 9, name: "Paragon" },
  D: { id: 10, name: "Dervish" },
} as const satisfies Readonly<Record<Profession, ProfessionFacts>>;

/** The wire value of a profession, 1-10. */
export type ProfessionId = (typeof PROFESSIONS)[Profession]["id"];

/**
 * The client's `Profession::None`. It is not one of `PROFESSIONS` because it is
 * not a profession: it is what a monoclass character's secondary encodes to,
 * which `library.ts` spells `null`.
 */
export const PROFESSION_NONE_ID = 0;

/** The shape each attribute row satisfies. */
interface AttributeFacts {
  readonly id: number;
  /** The profession the source's own trailing comment attributes it to. */
  readonly profession: Profession;
}

/**
 * Every attribute the client names, keyed by the source's enum spelling, in id
 * order. Two things this table cannot spell, both deliberately:
 *
 *  - **26, 27 and 28.** `Constants.h:71` restarts at `DaggerMastery = 29` and
 *    says nothing about the three it skipped. They are valid-width, unknown
 *    ids: a decoder must reject them as a typed failure rather than collapse
 *    them into "none" or assume they are unused.
 *  - **`None = 0xff`.** An in-memory "unset" marker that does not fit the
 *    6-bit wire field, so no codec may ever write it. Here, an attribute with
 *    no rank is simply absent from `AttributeRanks`.
 */
export const ATTRIBUTES = {
  FastCasting: { id: 0, profession: "Me" },
  IllusionMagic: { id: 1, profession: "Me" },
  DominationMagic: { id: 2, profession: "Me" },
  InspirationMagic: { id: 3, profession: "Me" },
  BloodMagic: { id: 4, profession: "N" },
  DeathMagic: { id: 5, profession: "N" },
  SoulReaping: { id: 6, profession: "N" },
  Curses: { id: 7, profession: "N" },
  AirMagic: { id: 8, profession: "E" },
  EarthMagic: { id: 9, profession: "E" },
  FireMagic: { id: 10, profession: "E" },
  WaterMagic: { id: 11, profession: "E" },
  EnergyStorage: { id: 12, profession: "E" },
  HealingPrayers: { id: 13, profession: "Mo" },
  SmitingPrayers: { id: 14, profession: "Mo" },
  ProtectionPrayers: { id: 15, profession: "Mo" },
  DivineFavor: { id: 16, profession: "Mo" },
  Strength: { id: 17, profession: "W" },
  AxeMastery: { id: 18, profession: "W" },
  HammerMastery: { id: 19, profession: "W" },
  Swordsmanship: { id: 20, profession: "W" },
  Tactics: { id: 21, profession: "W" },
  BeastMastery: { id: 22, profession: "R" },
  Expertise: { id: 23, profession: "R" },
  WildernessSurvival: { id: 24, profession: "R" },
  Marksmanship: { id: 25, profession: "R" },
  DaggerMastery: { id: 29, profession: "A" },
  DeadlyArts: { id: 30, profession: "A" },
  ShadowArts: { id: 31, profession: "A" },
  Communing: { id: 32, profession: "Rt" },
  RestorationMagic: { id: 33, profession: "Rt" },
  ChannelingMagic: { id: 34, profession: "Rt" },
  // These two sit out of profession order in the source, and that is the whole
  // evidence for the two primaries this file claims: the trailing comment on
  // `Constants.h:73` reads "sin/rit primary (gw is weird)".
  CriticalStrikes: { id: 35, profession: "A" },
  SpawningPower: { id: 36, profession: "Rt" },
  SpearMastery: { id: 37, profession: "P" },
  Command: { id: 38, profession: "P" },
  Motivation: { id: 39, profession: "P" },
  Leadership: { id: 40, profession: "P" },
  ScytheMastery: { id: 41, profession: "D" },
  WindPrayers: { id: 42, profession: "D" },
  EarthPrayers: { id: 43, profession: "D" },
  Mysticism: { id: 44, profession: "D" },
} as const satisfies Readonly<Record<Attribute, AttributeFacts>>;

/** The wire value of an attribute. The highest, 44, needs six bits. */
export type AttributeId = (typeof ATTRIBUTES)[Attribute]["id"];

/**
 * Cumulative attribute points to reach each rank, from
 * `TeamBuildEncoder.h:152-153`. Keyed by `AttributeRank`, so the table and the
 * rank ceiling cannot drift apart: the source's `kAttrCost` has thirteen
 * entries, and that is exactly why a stored rank stops at 12.
 *
 * The level-20 budget these are spent from is **not** here. It is stated
 * nowhere in either source tree; validation keeps that assumption outside this
 * wire-value table.
 */
export const ATTRIBUTE_POINT_COST: Readonly<Record<AttributeRank, number>> = {
  0: 0,
  1: 1,
  2: 3,
  3: 6,
  4: 10,
  5: 15,
  6: 21,
  7: 28,
  8: 37,
  9: 48,
  10: 61,
  11: 77,
  12: 97,
};

// `Object.entries` widens a record's key back to `string`. These two reads are
// the only place that happens, and each assertion restores exactly the key type
// the record above was declared with — nothing is being claimed that the
// `satisfies` clauses have not already checked.
const professionEntries = Object.entries(PROFESSIONS) as readonly (readonly [
  Profession,
  ProfessionFacts,
])[];
const attributeEntries = Object.entries(ATTRIBUTES) as readonly (readonly [
  Attribute,
  AttributeFacts,
])[];

/** Wire value to acronym; `PROFESSIONS[acronym]` holds the rest. */
export const PROFESSION_BY_ID: ReadonlyMap<number, Profession> = new Map(
  professionEntries.map(([acronym, facts]) => [facts.id, acronym] as const),
);

/** Wire value to name; `ATTRIBUTES[name]` holds the rest. */
export const ATTRIBUTE_BY_ID: ReadonlyMap<number, Attribute> = new Map(
  attributeEntries.map(([name, facts]) => [facts.id, name] as const),
);
