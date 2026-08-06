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
import { HERO_BY_ID, PROFESSION_BY_ID, PROFESSION_NONE_ID } from "./heroes.js";
import type {
  HeroBehaviour,
  HeroId,
  ProfessionPair,
  SkillBar,
  SkillSlotIndex,
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
