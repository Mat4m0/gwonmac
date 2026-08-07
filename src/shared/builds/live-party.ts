/**
 * The party the player is actually in, as the companion currently sees it.
 *
 * This is the read counterpart of `team-apply.ts`. That module turns a stored
 * team into the one checked value that may be handed to the game; this one
 * turns what the game publishes into the one value the panel may draw. Both
 * exist so the interface never reasons about a wire format.
 *
 * ## Everything unobserved says so
 *
 * The companion publishes far less than this type describes, and will until the
 * party region lands. Every field it cannot supply is `null` and means *not
 * observed* — never zero, never a default, never an empty bar. A captured build
 * with invented attributes is worse than one that admits it has none, and the
 * same is true of every field here.
 *
 * The shape is therefore the finished shape, populated in part. Filling it in
 * is a change to the kernel and the decoder, not to this type or to anything
 * drawing it.
 */
import {
  ATTRIBUTE_BY_ID,
  HERO_BY_ID,
  PROFESSION_BY_ID,
  PROFESSION_NONE_ID,
  heroLabel,
} from "./heroes.js";
import { PARTY_SIZE, buildId, skillId, teamId, teamSlotsOf } from "./library.js";
import type {
  Attribute,
  AttributeRank,
  AttributeRanks,
  Build,
  BuildId,
  HeroBehaviour,
  HeroId,
  ProfessionPair,
  SkillBar,
  SkillSlotIndex,
  Team,
  TeamSlot,
  TeamSlotIndex,
} from "./library.js";

/**
 * What this module reads, expressed structurally rather than as an import.
 *
 * `CompanionToolboxState` in `src/renderer/companion-snapshot.ts` satisfies it,
 * but `src/shared` may not depend on the renderer — and shouldn't: the decoder
 * owns the wire format, this owns the domain, and naming the overlap here is
 * what keeps the seam from becoming a shared type both sides edit.
 */
export type ToolboxObservation = Readonly<{
  status: string;
  /**
   * The kernel completed a party walk on a live game. Absent or false means
   * nobody looked — a map load, a game not yet running, a walk that rejected
   * what it found — which is a different statement from an empty party and is
   * the one the interface must not turn into "you have no heroes".
   */
  partyObserved?: boolean;
  heroAvailable?: boolean;
  heroCount?: number;
  firstHeroId?: number;
  firstHeroAgentId?: number;
  /**
   * The full roster, when the party region has published one. Its own
   * `rosterObserved` governs it: a decodable region whose walk was rejected
   * carries eight empty slots, and those are not an empty party.
   */
  party?: {
    readonly status: string;
    readonly rosterObserved?: boolean;
    readonly unlockObserved?: boolean;
    readonly slotCount?: number;
    readonly unlocked?: readonly number[] | null;
    readonly slots?: readonly {
      readonly index: number;
      readonly occupied: boolean;
      readonly hero: number | null;
      readonly agentId: number | null;
      readonly level: number | null;
      readonly professions: readonly number[] | null;
      readonly behaviour: number | null;
      readonly skills: readonly number[] | null;
      readonly disabled: number | null;
      /** `[attributeId, rank]` for each invested attribute, or unread. */
      readonly attributes: readonly (readonly number[])[] | null;
    }[];
  };
}>;

/** One hero the companion can currently identify in the player's own party. */
export interface LivePartyHero {
  /**
   * The party position, once the companion publishes the whole roster. `null`
   * while it identifies heroes without ordering them — the kernel walks the
   * hero array skipping heroes owned by other players, so the index it stops at
   * is not the position the player sees.
   */
  readonly slot: TeamSlotIndex | null;
  readonly hero: HeroId;
  /** The agent this hero is in the current instance. Changes on every map. */
  readonly agentId: number;
  /** `null` until observed. Never inferred from the hero table — a hero's
   *  secondary is the player's choice, not a property of who they are. */
  readonly professions: ProfessionPair | null;
  readonly behaviour: HeroBehaviour | null;
  readonly level: number | null;
  /** The bar as equipped. `null` until observed; never eight empty slots. */
  readonly skills: SkillBar | null;
  readonly disabled: readonly SkillSlotIndex[] | null;
  /**
   * Invested ranks, or `null` until observed. An observed character who has
   * spent nothing publishes `{}` — which is the same value as "not observed"
   * in `AttributeRanks`, and precisely why the two cannot share a spelling
   * here. A build captured with invented ranks is a template that gives the
   * character its skills at rank 0.
   */
  readonly attributes: AttributeRanks | null;
}

export interface LiveParty {
  readonly status: "unavailable" | "ready";
  /**
   * How many heroes the player owns in the current party. Known whenever the
   * status is `ready`, including when no individual hero has been identified.
   */
  readonly heroCount: number;
  /** The heroes identified so far. May be shorter than `heroCount`. */
  readonly heroes: readonly LivePartyHero[];
  /**
   * Derived: fewer heroes identified than counted. Held rather than recomputed
   * so the rule for "the panel must not present this as the whole party" lives
   * in one place.
   */
  readonly partial: boolean;
  /**
   * Heroes this account has unlocked, or `null` while unknown. The distinction
   * matters: "no mercenary is unlocked" and "we have not read the account's
   * hero table" are different claims, and only one of them may be shown as a
   * greyed-out hero.
   */
  readonly unlocked: ReadonlySet<HeroId> | null;
  readonly hardMode: boolean | null;
  readonly inOutpost: boolean | null;
}

const UNAVAILABLE: LiveParty = Object.freeze({
  status: "unavailable",
  heroCount: 0,
  heroes: Object.freeze([]),
  partial: false,
  unlocked: null,
  hardMode: null,
  inOutpost: null,
});

/** The party before anything has been observed. Also what a host with no
 *  running game reports, which is the same statement and deserves one value. */
export function unavailableParty(): LiveParty {
  return UNAVAILABLE;
}

/**
 * Reads one observation into the domain.
 *
 * Refuses rather than guesses: an id the hero table does not know is dropped,
 * because a hero the panel cannot name is a hero it cannot draw, assign to, or
 * capture — and publishing the number anyway is how an unknown becomes a fact
 * one layer up.
 */
export function liveParty(observation: ToolboxObservation): LiveParty {
  // A decodable record is not an observation. `status: "ready"` says the bytes
  // were well-formed; `partyObserved` says somebody actually read the party.
  // Zoning between outposts produces the first without the second, and treating
  // that as a ready party is what put "No heroes in your party" on screen mid-
  // load — a claim, where the truth was that nothing had been looked at.
  if (observation.status !== "ready" || observation.partyObserved !== true) {
    return UNAVAILABLE;
  }

  const heroCount = Number.isSafeInteger(observation.heroCount)
    ? Math.max(0, observation.heroCount as number)
    : 0;

  // The full roster supersedes the scalar summary whenever it is present and
  // was actually observed. The summary stays the fallback rather than being
  // deleted: the party region is newer, and a build whose layout does not
  // carry the detail offsets still publishes the one-hero projection.
  const region = observation.party;
  if (region?.status === "ready" && region.rosterObserved === true) {
    return fromRegion(region, observation);
  }

  const heroes: LivePartyHero[] = [];
  const id = observation.firstHeroId;
  if (
    observation.heroAvailable === true
    && Number.isSafeInteger(id)
    && HERO_BY_ID.has(id as HeroId)
  ) {
    heroes.push(Object.freeze({
      slot: null,
      hero: id as HeroId,
      agentId: Number.isSafeInteger(observation.firstHeroAgentId)
        ? (observation.firstHeroAgentId as number)
        : 0,
      professions: null,
      behaviour: null,
      level: null,
      skills: null,
      disabled: null,
      attributes: null,
    }));
  }

  return Object.freeze({
    status: "ready",
    heroCount,
    heroes: Object.freeze(heroes),
    partial: heroes.length < heroCount,
    unlocked: null,
    hardMode: null,
    inOutpost: null,
  });
}

/**
 * The client's numeric profession pair as an acronym pair, or `null` when
 * either value is outside the ten professions.
 *
 * Exported for the party region to use when it lands — the primary is a real
 * profession or the read is wrong, while `Profession::None` is a legitimate
 * secondary and is the one case that maps to `null` rather than to a refusal.
 */
export function professionPair(
  primary: number,
  secondary: number,
): ProfessionPair | null {
  const first = PROFESSION_BY_ID.get(primary);
  if (first === undefined) return null;
  if (secondary === PROFESSION_NONE_ID) return [first, null];
  const second = PROFESSION_BY_ID.get(secondary);
  return second === undefined ? null : [first, second];
}

/**
 * `[id, rank]` pairs as the domain's ranks.
 *
 * An id the table does not name is dropped rather than kept as a number: the
 * client's enum has three unnamed ids (26-28), and a rank against one of them
 * is a rank nothing downstream can spell, encode, or show. Same refusal as the
 * one `liveParty` makes for a hero the table cannot name.
 */
function attributeRanks(pairs: readonly (readonly number[])[]): AttributeRanks {
  const ranks: { -readonly [Name in Attribute]?: AttributeRank } = {};
  for (const [id, rank] of pairs) {
    const name = id === undefined ? undefined : ATTRIBUTE_BY_ID.get(id);
    if (name === undefined || rank === undefined) continue;
    if (!Number.isInteger(rank) || rank < 1 || rank > 12) continue;
    ranks[name] = rank as AttributeRank;
  }
  return Object.freeze(ranks);
}

const BEHAVIOURS: readonly HeroBehaviour[] = ["fight", "guard", "avoid"];

/** The client's numeric hero behaviour, or `null` for a value it never uses. */
function behaviourOf(value: number | null): HeroBehaviour | null {
  return value === null ? null : BEHAVIOURS[value] ?? null;
}

/**
 * Reads the party region into the domain.
 *
 * Every field arrives already paired with whether the kernel read it, so this
 * translates rather than decides — the one judgement it makes is dropping a
 * hero the table cannot name, for the same reason the scalar path does.
 */
function fromRegion(
  region: NonNullable<ToolboxObservation["party"]>,
  observation: ToolboxObservation,
): LiveParty {
  const heroes: LivePartyHero[] = [];
  for (const slot of region.slots ?? []) {
    if (!slot.occupied || slot.hero === null) continue;
    if (!HERO_BY_ID.has(slot.hero as HeroId)) continue;
    heroes.push(Object.freeze({
      // The kernel's slot indices are the party positions, player at 0.
      slot: slot.index as TeamSlotIndex,
      hero: slot.hero as HeroId,
      agentId: slot.agentId ?? 0,
      professions: slot.professions === null
        ? null
        : professionPair(slot.professions[0] ?? 0, slot.professions[1] ?? 0),
      behaviour: behaviourOf(slot.behaviour),
      level: slot.level,
      skills: slot.skills === null
        ? null
        : (Object.freeze(
            slot.skills.map((id) => id === 0 ? null : skillId(id)),
          ) as unknown as SkillBar),
      disabled: slot.disabled === null
        ? null
        : Object.freeze(
            [0, 1, 2, 3, 4, 5, 6, 7].filter(
              (index) => (slot.disabled! & (1 << index)) !== 0,
            ) as SkillSlotIndex[],
          ),
      attributes: slot.attributes === null
        ? null
        : attributeRanks(slot.attributes),
    }));
  }
  const counted = region.slotCount ?? heroes.length;
  return Object.freeze({
    status: "ready",
    heroCount: counted,
    heroes: Object.freeze(heroes),
    partial: heroes.length < counted,
    unlocked: region.unlockObserved === true && region.unlocked
      ? Object.freeze(new Set(
          region.unlocked.filter((id) => HERO_BY_ID.has(id as HeroId))
            .map((id) => id as HeroId),
        ))
      : null,
    // Neither reaches the region yet; the toolbox summary never carried them.
    hardMode: null,
    inOutpost: observation.status === "ready" ? true : null,
  });
}

/** Where a captured build came from, in `Build.origin`'s vocabulary. */
export const CAPTURE_ORIGIN = "live-party";

/**
 * A team and its builds, taken from the party the player is standing in, plus
 * the list of everything that could not be taken.
 *
 * `gaps` is not diagnostics. It is the honest half of the answer, and it is
 * written into the team's notes so it survives the notice that announced it.
 */
export interface PartyCapture {
  readonly team: Team;
  readonly builds: readonly Build[];
  readonly gaps: readonly string[];
}

/** Every position empty, which is also exactly what slot 0 must look like. */
const EMPTY_SLOT: TeamSlot = Object.freeze({
  build: null,
  hero: null,
  behaviour: null,
  panel: false,
  disabled: Object.freeze([]),
});

/**
 * Turns the observed party into a stored team.
 *
 * Pure, and deliberately without a clock, a library or an id source of its own:
 * `mint` is injected because `src/shared` is imported by main and the renderer
 * both, and neither may assume the other's `crypto`. Nothing here reads the
 * library, so nothing here can collide with it — the caller uniques the names
 * it gets back, which is the only thing that needs to know what is already
 * stored.
 *
 * Three rules, all of them about not making things up:
 *
 * 1. **Heroes are compacted into slots 1..n.** `hero.slot` is the party
 *    position, and a henchman standing between two heroes puts a hole in it.
 *    `resolveTeamApplyPlan` refuses a `party-gap`, so preserving the game's
 *    indices would capture teams that can never be applied. The position is
 *    used for ordering and then dropped, which is what it is actually good for.
 * 2. **A hero whose bar was not read gets no build**, rather than a build of
 *    eight empty slots. The slot still carries the hero, so the team is right
 *    about who was there and silent about what they were holding.
 * 3. **A build needs its attributes read, not just its bar.** They come from a
 *    different structure and can fail independently, and `AttributeRanks` has
 *    no spelling for *unknown* — an absent attribute is rank 0 by definition.
 *    So a bar without ranks would be a build that publishes as a template
 *    giving the character its skills at rank 0, indistinguishable from one
 *    that genuinely invested nothing. There is no honest place to put that, so
 *    the hero keeps their slot and gets no build.
 *
 * Returns `null` when there is nothing to capture: no observation, or an
 * observed party with no hero in it. A team of one empty player slot is not a
 * team, and saving one would leave the library holding the moment the player
 * happened to press the button.
 */
export function captureParty(
  live: LiveParty,
  name: string,
  mint: (kind: "build" | "team") => string,
): PartyCapture | null {
  if (live.status !== "ready" || live.heroes.length === 0) return null;

  const gaps: string[] = [];
  const builds: Build[] = [];
  const filled = new Map<TeamSlotIndex, TeamSlot>();

  // Party order where it was observed, discovery order where it was not. Slot 0
  // is the player and never holds a hero, so `PARTY_SIZE` sorts the unpositioned
  // to the back rather than into the player's place.
  const ordered = [...live.heroes].sort(
    (left, right) => (left.slot ?? PARTY_SIZE) - (right.slot ?? PARTY_SIZE),
  );
  const placed = ordered.slice(0, PARTY_SIZE - 1);
  if (ordered.length > placed.length) {
    gaps.push(
      `${ordered.length - placed.length} hero could not be saved: a team has `
      + `${PARTY_SIZE - 1} hero positions.`,
    );
  }

  for (const [index, hero] of placed.entries()) {
    const heroName = heroLabel(hero.hero);
    let build: BuildId | null = null;
    if (
      hero.professions !== null
      && hero.skills !== null
      && hero.attributes !== null
    ) {
      const id = buildId(mint("build"));
      builds.push({
        id,
        name: heroName,
        professions: hero.professions,
        skills: hero.skills,
        attributes: hero.attributes,
        tags: [],
        notes: "Captured from the running game.",
        favourite: false,
        lastUsed: null,
        parent: null,
        origin: CAPTURE_ORIGIN,
      });
      build = id;
    } else {
      const missing = hero.skills === null
        ? "their skill bar"
        : hero.attributes === null
          ? "their attribute ranks"
          : "their professions";
      gaps.push(`${heroName} was saved without a build: ${missing} was not observed.`);
    }
    if (hero.behaviour === null) {
      gaps.push(`${heroName}'s behaviour was not observed. Choose one before Apply.`);
    }
    filled.set((index + 1) as TeamSlotIndex, {
      build,
      hero: hero.hero,
      behaviour: hero.behaviour,
      panel: false,
      // Disabled positions name places on a bar. With no build there is no bar,
      // and `resolveTeamApplyPlan` rejects the pair outright — the professions
      // can be unread while the bar was read, so this is reachable.
      disabled: build === null ? [] : hero.disabled ?? [],
    });
  }

  const unnamed = live.heroCount - live.heroes.length;
  if (unnamed > 0) {
    gaps.push(
      `${unnamed} more ${unnamed === 1 ? "hero is" : "heroes are"} in your `
      + `party but could not be identified, and ${unnamed === 1 ? "is" : "are"} `
      + "not in this team.",
    );
  }
  gaps.push(
    "Your own build was not captured: the companion cannot read the player's "
    + "own skill bar.",
  );

  return {
    team: {
      id: teamId(mint("team")),
      name,
      tags: [],
      // Not `"normal"`. Hard mode is unobserved, and `"none"` is the spelling
      // for having never said — claiming normal would be a setting the player
      // did not choose showing up as one they did.
      mode: "none",
      favourite: false,
      lastUsed: null,
      notes: ["Captured from the party you were in.", ...gaps.map((gap) => `• ${gap}`)]
        .join("\n"),
      slots: teamSlotsOf((position) => filled.get(position) ?? EMPTY_SLOT),
    },
    builds,
    gaps,
  };
}
