/**
 * Structural rules that decide whether a stored `Build` describes a character
 * the game could actually produce. Team rules (the same hero in two slots, a
 * gap between filled party slots, or an unlocked-hero check) belong to a team
 * validator and are
 * deliberately not here — this file takes one build and answers about that
 * build alone, with no clock, no I/O and no game access.
 *
 * Three decisions shape everything below.
 *
 * 1. **The answer is a typed problem list, never a boolean.** A player who is
 * told "invalid" learns nothing; a player told "slot 4 is a second elite"
 * fixes it. Every problem therefore names its rule *and* its location — a
 * `SkillSlotIndex` for the bar rules, an `Attribute` for the attribute
 * rules — so the UI can point at the offending control rather than at the
 * build. And the result is a union, not a struct with an optional list: a
 * valid answer has no `problems` field to read, and an invalid one carries
 * a non-empty tuple, so "invalid with nothing wrong" and "valid but here
 * are three problems" are both unspellable.
 *
 * 2. **The skill catalogue is injected, because this pure validator does not
 * own ArenaNet content.** Inventing a second skill table here would create a
 * stale authority. So `validateBuild` takes the lookup as a parameter: a
 * fixture answers it in tests and the host catalogue answers it in production.
 * A skill the
 * catalogue cannot resolve is reported as `unknown-skill` rather than
 * skipped, because silently skipping turns an incomplete catalogue into a
 * clean bill of health — the one lie this module must not tell.
 *
 * 3. **Provenance is marked, not smoothed over.** Two of the ten primary
 * attributes are asserted by the reviewed source tree and eight are not; the
 * level-20 budget is not in the source tree at all. Each of those carries a
 * comment saying so where it is declared. Nothing here is presented as
 * read-from-source when it was not.
 *
 * Order of the reported problems is deterministic — professions, then the bar
 * slot by slot, then attributes in the client's own enum order, then the
 * budget — so a UI can render the list without sorting it and a test can assert
 * on it.
 */
import type {
  Attribute,
  AttributeRank,
  Build,
  Profession,
  SkillId,
  SkillSlotIndex,
} from "./library.js";
import { SKILL_SLOTS } from "./library.js";
import { ATTRIBUTE_POINT_COST, ATTRIBUTES } from "./heroes.js";

/**
 * What the validator needs to know about one skill. `profession` is `null` for
 * a common skill — the client's `Any` profession, which is what PvE-only,
 * Sunspear, Kurzick/Luxon and title-line skills carry — and such a skill is
 * legal on every bar. This is deliberately the *minimum*: a name, an icon and
 * an attribute are what the UI wants from a catalogue, but none decide whether a
 * build can exist, so none of them are required to answer that question.
 */
export interface CataloguedSkill {
  readonly profession: Profession | null;
  readonly elite: boolean;
  readonly availability: "pve" | "player-only-pve" | "pvp" | "not-equippable";
}

/**
 * The injected catalogue lookup. `null` means "this catalogue does not know
 * that id", which is a real and expected answer — degraded operation has
 * every id unknown — and not an error.
 */
export type SkillCatalogue = (skill: SkillId) => CataloguedSkill | null;

/**
 * Every attribute name, in the client's enum order, which is what fixes the
 * order attribute problems are reported in.
 *
 * `heroes.ts` owns the table — which profession each attribute belongs to, from
 * the trailing comments on `GWCA/Constants/Constants.h:64-77` — and this file
 * reads it. A second transcription of
 * those 42 rows here would be a second answer to "whose attribute is Divine
 * Favor", and the two would only be found to disagree by a player whose legal
 * build was rejected.
 *
 * The cast is sound because `ATTRIBUTES` is declared
 * `satisfies Readonly<Record<Attribute, …>>`: TypeScript requires every
 * `Attribute` as a key and rejects any key that is not one, so its keys are
 * exactly `Attribute` and nothing else.
 */
const ATTRIBUTE_NAMES = Object.keys(ATTRIBUTES) as readonly Attribute[];

/**
 * Each profession's primary attribute — the one only that profession's *own*
 * characters may invest in, which is what makes this a validation rule rather
 * than trivia.
 *
 * **Provenance is uneven and this is the honest state of it.** The reviewed
 * source tree asserts only two of these ten. The
 * comment on `Constants.h:73` ("sin/rit primary") establishes `CriticalStrikes`
 * for the Assassin and `SpawningPower` for the Ritualist, and those two sit out
 * of enum order precisely because of it. The other eight are **assumed** here
 * from ordinary knowledge of the game; they are not read from either source
 * tree. Do not infer them from
 * `kProfessionAttributes`, which is ordered by frequency of use and would name
 * `DominationMagic` for the Mesmer. The live read that can settle them is
 * `GW::SkillbarMgr::GetAttributeConstantData`. When that read happens, this
 * table is the one place to correct — it is the only one. `heroes.ts` used to
 * carry the two source-asserted answers a second time and `null` for the rest,
 * with no production reader and nothing but a test asserting the two agreed;
 * the provenance that copy existed to record is the two trailing comments
 * below, and a fact stated twice is a fact that can be corrected once.
 *
 * Exported so the test beside this file drives the rule over this table rather
 * than over a transcription of it. A third copy would assert the module back to
 * itself for the eight rows nothing else states.
 */
export const PRIMARY_ATTRIBUTE = {
  W: "Strength",
  R: "Expertise",
  Mo: "DivineFavor",
  N: "SoulReaping",
  Me: "FastCasting",
  E: "EnergyStorage",
  A: "CriticalStrikes", // source-asserted, Constants.h:73
  Rt: "SpawningPower", // source-asserted, Constants.h:73
  P: "Leadership",
  D: "Mysticism",
} as const satisfies Record<Profession, Attribute>;

/**
 * The highest buyable rank, derived from `heroes.ts`'s `kAttrCost` transcription
 * (`GWTB/Utils/TeamBuildEncoder.h:153`) rather than
 * restated. That table has thirteen entries, so the ranks a character can buy
 * are 0-12 and its last key *is* the cap — a rank with no entry there is a rank
 * the game cannot sell.
 */
const MAX_ATTRIBUTE_RANK = Object.keys(ATTRIBUTE_POINT_COST).length - 1;

/**
 * Attribute points a level-20 character has to spend.
 *
 * **Assumed, not read.** Neither GWCA nor GWToolbox states 200 anywhere. It is
 * here because a budget rule with no budget is not a rule, and
 * it matches the cost table's shape (rank 12 costs 97, so two attributes at 12
 * plus change is the familiar level-20 spread). Treat it as the single value to
 * correct if a live read disagrees.
 */
export const LEVEL_20_ATTRIBUTE_BUDGET = 200;

/**
 * One reason a build cannot exist. The `rule` tag names what is broken and the
 * remaining fields say where: every bar rule carries the slot, every attribute
 * rule carries the attribute. The two rules that are about a *pair* of slots
 * carry both, because "slot 4 duplicates slot 1" is the sentence the player
 * needs and "slot 4 is a duplicate" is not.
 */
export type BuildProblem =
  /** The secondary profession repeats the primary. A monoclass build carries `null`. */
  | { readonly rule: "secondary-repeats-primary"; readonly profession: Profession }
  /** The catalogue does not know this id, so its profession and elite flag are unknown. */
  | { readonly rule: "unknown-skill"; readonly slot: SkillSlotIndex; readonly skill: SkillId }
  /** The catalogue knows the record, but Guild Wars cannot equip it in PvE. */
  | {
      readonly rule: "skill-not-equippable";
      readonly slot: SkillSlotIndex;
      readonly skill: SkillId;
      readonly availability: "pvp" | "not-equippable";
    }
  /** A PvE title skill can be equipped by the player, never by a hero. */
  | {
      readonly rule: "player-only-skill-on-hero";
      readonly slot: SkillSlotIndex;
      readonly skill: SkillId;
    }
  /** The same skill occupies two slots. */
  | {
      readonly rule: "duplicate-skill";
      readonly slot: SkillSlotIndex;
      readonly firstSlot: SkillSlotIndex;
      readonly skill: SkillId;
    }
  /** A second elite. A bar may hold one. */
  | {
      readonly rule: "second-elite";
      readonly slot: SkillSlotIndex;
      readonly firstSlot: SkillSlotIndex;
      readonly skill: SkillId;
    }
  /** The skill belongs to a profession this build has neither of. */
  | {
      readonly rule: "skill-off-profession";
      readonly slot: SkillSlotIndex;
      readonly skill: SkillId;
      readonly profession: Profession;
    }
  /** The attribute belongs to a profession this build has neither of. */
  | {
      readonly rule: "attribute-off-profession";
      readonly attribute: Attribute;
      readonly profession: Profession;
    }
  /** A profession's primary attribute, on a build that only has it as its secondary. */
  | {
      readonly rule: "primary-attribute-of-secondary";
      readonly attribute: Attribute;
      readonly profession: Profession;
    }
  /** A rank the game cannot sell. Reachable from a decoder, not from a `Build` literal. */
  | { readonly rule: "rank-above-cap"; readonly attribute: Attribute; readonly rank: number; readonly cap: number }
  /** The ranks together cost more than a level-20 character has. */
  | { readonly rule: "over-budget"; readonly spent: number; readonly budget: number };

/**
 * The verdict. A union rather than `{ valid: boolean; problems: [] }` so the
 * two impossible states — a valid build carrying problems, an invalid one
 * carrying none — cannot be constructed, and so a caller that reaches
 * `problems` has already proved there is at least one.
 */
export type BuildValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly problems: readonly [BuildProblem, ...BuildProblem[]];
    };

/**
 * Every structural reason `build` could not exist in game, or `valid: true`.
 *
 * Pure: same inputs, same answer, no clock and no game access. `catalogue` is
 * the injected catalogue lookup — see the file header for why it is a parameter and
 * not a table in this repository.
 */
export function validateBuild(
  build: Build,
  catalogue: SkillCatalogue,
): BuildValidation {
  const problems: BuildProblem[] = [];
  const [primary, secondary] = build.professions;

  if (secondary === primary) {
    problems.push({ rule: "secondary-repeats-primary", profession: primary });
  }

  checkSkills(build, catalogue, primary, secondary, problems);
  checkAttributes(build, primary, secondary, problems);

  const [first, ...rest] = problems;
  return first === undefined
    ? { valid: true }
    : { valid: false, problems: [first, ...rest] };
}

/** Assignment-specific rules that do not make the reusable build intrinsically invalid. */
export function validateBuildFor(
  build: Build,
  catalogue: SkillCatalogue,
  context: "player" | "hero",
): BuildValidation {
  const intrinsic = validateBuild(build, catalogue);
  const problems = intrinsic.valid ? [] : [...intrinsic.problems];
  if (context === "hero") {
    for (const slot of SKILL_SLOTS) {
      const skill = build.skills[slot] ?? null;
      if (skill === null) continue;
      if (catalogue(skill)?.availability === "player-only-pve") {
        problems.push({ rule: "player-only-skill-on-hero", slot, skill });
      }
    }
  }
  const [first, ...rest] = problems;
  return first === undefined
    ? { valid: true }
    : { valid: false, problems: [first, ...rest] };
}

/**
 * The bar, slot by slot in order. An empty slot is skipped and never a problem:
 * a half-written bar is a legal saved state, which is why `SkillSlot` is
 * nullable in the first place.
 *
 * A duplicated elite reports both `duplicate-skill` and `second-elite`. They
 * are independent failures — swapping the duplicate for a different elite fixes
 * one and leaves the other — and collapsing them would hide the rule the player
 * has not yet met.
 */
function checkSkills(
  build: Build,
  catalogue: SkillCatalogue,
  primary: Profession,
  secondary: Profession | null,
  problems: BuildProblem[],
): void {
  const seen = new Map<SkillId, SkillSlotIndex>();
  let elite: { readonly slot: SkillSlotIndex; readonly skill: SkillId } | null =
    null;

  for (const slot of SKILL_SLOTS) {
    // `?? null` rather than a bare read, for the reason `diff.ts` gives at the
    // same line: a record parsed from a stored file can be short despite the
    // tuple type. Without it a six-slot record reads `undefined` in slots 6 and
    // 7, `undefined !== null`, and the two are reported as a duplicate of each
    // other — naming a `skill` that does not exist, in a field the
    // `BuildProblem` union declares to be a `SkillId`.
    const skill = build.skills[slot] ?? null;
    if (skill === null) continue;

    const firstSlot = seen.get(skill);
    if (firstSlot === undefined) seen.set(skill, slot);
    else problems.push({ rule: "duplicate-skill", slot, firstSlot, skill });

    const known = catalogue(skill);
    if (known === null) {
      problems.push({ rule: "unknown-skill", slot, skill });
      continue;
    }

    if (known.availability === "pvp" || known.availability === "not-equippable") {
      problems.push({
        rule: "skill-not-equippable",
        slot,
        skill,
        availability: known.availability,
      });
    }

    if (known.elite) {
      if (elite === null) elite = { slot, skill };
      else problems.push({ rule: "second-elite", slot, firstSlot: elite.slot, skill });
    }

    // A common skill (`profession: null`) is legal on every bar.
    const profession = known.profession;
    if (
      profession !== null &&
      profession !== primary &&
      profession !== secondary
    ) {
      problems.push({ rule: "skill-off-profession", slot, skill, profession });
    }
  }
}

/**
 * The attribute spread, in the client's enum order.
 *
 * Two judgement calls worth naming. First, only a rank *above* zero is held to
 * the profession rules: `library.ts` says an absent attribute is rank 0, so an
 * explicit 0 buys nothing and grants nothing, and calling a build impossible
 * over a value the game cannot distinguish from absence would be wrong.
 * Second, the budget sums every rank present, including any that a profession
 * rule has already rejected — those are still points the record spends, and
 * excluding them would let an impossible build also look affordable.
 */
function checkAttributes(
  build: Build,
  primary: Profession,
  secondary: Profession | null,
  problems: BuildProblem[],
): void {
  let spent = 0;

  for (const attribute of ATTRIBUTE_NAMES) {
    const rank: AttributeRank | undefined = build.attributes[attribute];
    if (rank === undefined) continue;

    // `AttributeRank` stops at 12, so this branch is unreachable from a `Build`
    // literal. It is not dead: imported data can carry ranks off the wire and a
    // file is a promise nobody kept, and this validator is where such a record
    // first meets the rules. A rank with no cost entry is one the game cannot
    // sell, so it is rejected rather than clamped and it buys nothing.
    //
    // The annotation is the part the type system cannot see. `ATTRIBUTE_POINT_COST`
    // is keyed by the thirteen `AttributeRank` values, so tsc reads this as a
    // `number`; the record that reaches here says rank 13.
    const cost: number | undefined = ATTRIBUTE_POINT_COST[rank];
    if (cost === undefined) {
      problems.push({
        rule: "rank-above-cap",
        attribute,
        rank,
        cap: MAX_ATTRIBUTE_RANK,
      });
    } else {
      spent += cost;
    }

    if (rank <= 0) continue;

    const owner = ATTRIBUTES[attribute].profession;
    if (owner !== primary && owner !== secondary) {
      problems.push({
        rule: "attribute-off-profession",
        attribute,
        profession: owner,
      });
    } else if (PRIMARY_ATTRIBUTE[owner] === attribute && owner !== primary) {
      // The build has this profession, but only as its secondary, and a
      // primary attribute is the one thing a secondary profession does not
      // bring with it. Reported instead of `attribute-off-profession` rather
      // than beside it: the two are mutually exclusive by construction, and
      // the more specific sentence is the one the player can act on.
      problems.push({
        rule: "primary-attribute-of-secondary",
        attribute,
        profession: owner,
      });
    }
  }

  if (spent > LEVEL_20_ATTRIBUTE_BUDGET) {
    problems.push({
      rule: "over-budget",
      spent,
      budget: LEVEL_20_ATTRIBUTE_BUDGET,
    });
  }
}
