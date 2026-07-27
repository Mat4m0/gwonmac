// `src/shared/builds/validate.ts` is primitive A6's build half, and its whole
// value is in *what it says* rather than in whether it says yes or no. A player
// who is told "this build is invalid" is stuck; a player told "slot 3 is a
// second elite" is one click from fixed. So every case below drives one rule to
// failure and asserts the exact problem record — rule tag, slot index,
// attribute name — not merely that something was reported.
//
// The catalogue here is a fixture on purpose and is not a claim about any real
// skill. Skill-to-profession and the elite flag are primitive A1, an undecided
// product question (`plans/tools/hero-builds/primitives.md` §A1), so the
// validator takes the lookup as a parameter and this file supplies nine
// invented ids with the shapes the rules care about: two warrior elites, plain
// skills of three professions, two common skills, and an id the catalogue does
// not know. That last one is a rule in its own right — a catalogue that cannot
// answer must not be able to certify a build clean.
//
// Two cases are here because they are the ones a boolean validator gets wrong:
//
//   - a rank of exactly 12 in two attributes plus change spends exactly the
//     level-20 budget and is *legal*. Off-by-one on the budget rejects half the
//     real builds in the game;
//   - an explicit rank 0 on an attribute the build's professions do not own is
//     *not* a problem. `library.ts` says an absent attribute is rank 0, so a
//     stored 0 buys nothing, and the game cannot tell it from absence.
//
// The last test asserts the full problem list of one deliberately broken build
// in order. That is the rendering contract: professions, then the bar slot by
// slot, then attributes in the client's own enum order (Healing Prayers before
// Divine Favor — alphabetical order would reverse them), then the budget.
//
// The first test's `@ts-expect-error` lines are real assertions: they *fail*
// when the line they guard type-checks. Node strips types and never sees them,
// so they are checked by `tsc -p tsconfig.tests.json` and this file only
// half-runs without it:
//
//   node --import ./tests/ts-hook.mjs --experimental-strip-types --test \
//     tests/unit/a-build-that-cannot-exist-in-game-is-rejected.test.ts
//   npx tsc -p tsconfig.tests.json
//
// What they pin is the shape of the answer, which no runtime check can: a clean
// result has no `problems` to read, and an invalid one cannot carry an empty
// list.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  Attribute,
  Build,
  Profession,
  SkillBar,
  SkillId,
} from "../../src/shared/builds/library.ts";
import { buildId, skillId } from "../../src/shared/builds/library.ts";
import { ATTRIBUTES, PROFESSIONS } from "../../src/shared/builds/heroes.ts";
import type {
  BuildProblem,
  BuildValidation,
  CataloguedSkill,
  SkillCatalogue,
} from "../../src/shared/builds/validate.ts";
import {
  LEVEL_20_ATTRIBUTE_BUDGET,
  PRIMARY_ATTRIBUTE,
  validateBuild,
  validateBuildFor,
} from "../../src/shared/builds/validate.ts";

/**
 * Invented ids. The numbers mean nothing beyond keeping the professions
 * visually separate: 1x warrior, 2x monk, 3x elementalist, 4x common. `999` is
 * deliberately absent so the unknown-skill path has an input.
 */
const CATALOGUE = new Map<number, CataloguedSkill>([
  [10, { profession: "W", elite: true, availability: "pve" }],
  [11, { profession: "W", elite: true, availability: "pve" }],
  [12, { profession: "W", elite: false, availability: "pve" }],
  [13, { profession: "W", elite: false, availability: "pve" }],
  [20, { profession: "Mo", elite: false, availability: "pve" }],
  [21, { profession: "Mo", elite: true, availability: "pve" }],
  [30, { profession: "E", elite: false, availability: "pve" }],
  [40, { profession: null, elite: false, availability: "pve" }],
  [41, { profession: null, elite: false, availability: "player-only-pve" }],
  [42, { profession: null, elite: false, availability: "pvp" }],
  [43, { profession: null, elite: false, availability: "not-equippable" }],
]);

const catalogue: SkillCatalogue = (skill) => CATALOGUE.get(skill) ?? null;

/** Every id unknown — the degraded state A1 warns the whole UI must survive. */
const emptyCatalogue: SkillCatalogue = () => null;

/** Written out rather than mapped, so the fixture needs no cast to be eight long. */
type Eight<T> = readonly [T, T, T, T, T, T, T, T];

const bar = (ids: Eight<number | null>): SkillBar => {
  const one = (id: number | null): SkillId | null =>
    id === null ? null : skillId(id);
  return [
    one(ids[0]),
    one(ids[1]),
    one(ids[2]),
    one(ids[3]),
    one(ids[4]),
    one(ids[5]),
    one(ids[6]),
    one(ids[7]),
  ];
};

/**
 * A W/Mo that breaks nothing: one elite, no duplicates, two common skills, two
 * empty slots, and 97 + 97 + 6 = 200 points — exactly the budget.
 */
const legal = (): Build => ({
  id: buildId("b1"),
  name: "Sword warrior",
  professions: ["W", "Mo"],
  skills: bar([10, 12, 13, 20, 40, 41, null, null]),
  attributes: { Strength: 12, Swordsmanship: 12, HealingPrayers: 3 },
  tags: [],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: null,
  origin: null,
});

/** The legal build with some fields replaced. Keeps each case to its one rule. */
const broken = (changes: Partial<Build>): Build => ({ ...legal(), ...changes });

/** The problems, having first asserted there are any. */
function problemsOf(result: BuildValidation): readonly BuildProblem[] {
  if (result.valid) assert.fail("expected an invalid build, got a clean one");
  return result.problems;
}

test("a clean verdict has nothing to explain, and a broken one cannot be silent", () => {
  const takeVerdict = (value: BuildValidation): BuildValidation => value;

  assert.equal(takeVerdict({ valid: true }).valid, true);

  // @ts-expect-error a valid build has no problems to carry
  takeVerdict({ valid: true, problems: [] });
  // @ts-expect-error "invalid, nothing wrong" is a red banner over a blank list
  takeVerdict({ valid: false, problems: [] });

  // What is allowed is exactly one or more.
  const repeat: BuildProblem = {
    rule: "secondary-repeats-primary",
    profession: "W",
  };
  assert.equal(takeVerdict({ valid: false, problems: [repeat] }).valid, false);
});

test("a legal build reports clean, spending exactly the level-20 budget", () => {
  assert.deepEqual(validateBuild(legal(), catalogue), { valid: true });

  // Not a coincidence worth losing: the fixture sits on the boundary, so an
  // off-by-one in the budget rule fails here rather than in some later feature.
  assert.equal(LEVEL_20_ATTRIBUTE_BUDGET, 200);
});

test("PvE availability is intrinsic while player-only eligibility belongs to assignment", () => {
  const playerOnly = broken({
    skills: bar([10, 12, 13, 20, 40, 41, null, null]),
  });
  assert.deepEqual(validateBuildFor(playerOnly, catalogue, "player"), { valid: true });
  assert.deepEqual(
    problemsOf(validateBuildFor(playerOnly, catalogue, "hero")),
    [{ rule: "player-only-skill-on-hero", slot: 5, skill: 41 }],
  );

  const excluded = broken({
    skills: bar([10, 12, 13, 20, 42, 43, null, null]),
  });
  assert.deepEqual(problemsOf(validateBuild(excluded, catalogue)), [
    { rule: "skill-not-equippable", slot: 4, skill: 42, availability: "pvp" },
    {
      rule: "skill-not-equippable",
      slot: 5,
      skill: 43,
      availability: "not-equippable",
    },
  ]);
});

test("a secondary profession may not repeat the primary", () => {
  // Nothing monk-shaped is left on the build, so the repeat is the only rule
  // this case can break.
  const result = validateBuild(
    broken({
      professions: ["W", "W"],
      skills: bar([10, 12, 13, null, 40, 41, null, null]),
      attributes: { Strength: 12, Swordsmanship: 12 },
    }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "secondary-repeats-primary", profession: "W" },
  ]);

  // A monoclass build is the other spelling of "no secondary", and it is legal.
  const mono = broken({
    professions: ["W", null],
    skills: bar([10, 12, 13, null, 40, 41, null, null]),
    attributes: { Strength: 12, Swordsmanship: 12 },
  });
  assert.deepEqual(validateBuild(mono, catalogue), { valid: true });
});

test("a bar may hold one elite, and the second is reported against the first", () => {
  const result = validateBuild(
    // Slot 0 is elite 10; slot 2 is elite 11; slot 5 is elite 21.
    broken({ skills: bar([10, 12, 11, 20, 40, 21, null, null]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "second-elite", slot: 2, firstSlot: 0, skill: 11 },
    { rule: "second-elite", slot: 5, firstSlot: 0, skill: 21 },
  ]);
});

test("the same skill cannot occupy two slots", () => {
  const result = validateBuild(
    broken({ skills: bar([12, 13, 12, 20, 40, null, null, null]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "duplicate-skill", slot: 2, firstSlot: 0, skill: 12 },
  ]);

  // Two empty slots are not duplicates of each other: the legal fixture has
  // two, and a half-written bar is a state the record is built to hold.
  assert.deepEqual(validateBuild(legal(), catalogue), { valid: true });
});

test("a stored record short of eight slots is validated, not accused of duplicates", () => {
  // `diff.ts` already takes the position that "a record parsed from a stored
  // file can be short despite the tuple type" and reads every slot with
  // `?? null`. This file read the slot bare, so a six-slot record made slots 6
  // and 7 both `undefined`, `undefined !== null` skipped the empty-slot guard,
  // and the two were reported as duplicates of each other — carrying a `skill`
  // of `undefined` in a field `BuildProblem` declares to be a `SkillId`. Two
  // modules over one record cannot hold opposite beliefs about `SkillBar`.
  const short = broken({
    skills: bar([10, 12, 13, 20, 40, 41, null, null]).slice(
      0,
      6,
    ) as unknown as SkillBar,
  });
  assert.deepEqual(validateBuild(short, catalogue), { valid: true });

  // And a short record with a real problem in it still reports that problem,
  // rather than the missing positions drowning it.
  const alsoBroken = broken({
    skills: bar([10, 12, 10, 20, 40, 41, null, null]).slice(
      0,
      6,
    ) as unknown as SkillBar,
  });
  assert.deepEqual(problemsOf(validateBuild(alsoBroken, catalogue)), [
    { rule: "duplicate-skill", slot: 2, firstSlot: 0, skill: 10 },
    { rule: "second-elite", slot: 2, firstSlot: 0, skill: 10 },
  ]);
});

test("the last two bar positions are checked like the first six", () => {
  // The slot list used to be `satisfies readonly SkillSlotIndex[]`, which
  // constrains membership and not length: cutting it to six left `tsc` green
  // and every test in this file green, because none of them drove a problem
  // past slot 5. `library.ts` now owns one list typed from `SkillBar` itself,
  // and these are the cases that would have caught the cut.
  const duplicate = validateBuild(
    broken({ skills: bar([null, null, null, null, null, null, 12, 12]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(duplicate), [
    { rule: "duplicate-skill", slot: 7, firstSlot: 6, skill: 12 },
  ]);

  const lastSlot = validateBuild(
    broken({ skills: bar([null, null, null, null, null, null, null, 999]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(lastSlot), [
    { rule: "unknown-skill", slot: 7, skill: 999 },
  ]);

  const seventh = validateBuild(
    broken({ skills: bar([null, null, null, null, null, null, 30, null]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(seventh), [
    { rule: "skill-off-profession", slot: 6, skill: 30, profession: "E" },
  ]);
});

test("a duplicated elite reports both rules, because fixing one need not fix the other", () => {
  const result = validateBuild(
    broken({ skills: bar([10, 12, 10, 20, 40, null, null, null]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "duplicate-skill", slot: 2, firstSlot: 0, skill: 10 },
    { rule: "second-elite", slot: 2, firstSlot: 0, skill: 10 },
  ]);
});

test("a skill must belong to one of the build's two professions, or to none", () => {
  const result = validateBuild(
    // 30 is an elementalist skill on a W/Mo. 40 and 41 are common and stay legal.
    broken({ skills: bar([10, 12, 30, 20, 40, 41, null, null]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "skill-off-profession", slot: 2, skill: 30, profession: "E" },
  ]);

  // The secondary genuinely counts: the same bar on a W/E is clean.
  const elementalist = broken({
    professions: ["W", "E"],
    skills: bar([10, 12, 30, null, 40, 41, null, null]),
    attributes: { Strength: 12, Swordsmanship: 12 },
  });
  assert.deepEqual(validateBuild(elementalist, catalogue), { valid: true });
});

test("a skill the catalogue cannot resolve is reported, never assumed clean", () => {
  const result = validateBuild(
    broken({ skills: bar([10, 12, 999, 20, 40, null, null, null]) }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "unknown-skill", slot: 2, skill: 999 },
  ]);

  // With no catalogue at all, every filled slot is unknown and none of them is
  // silently certified. Six filled slots in the legal fixture, two empty.
  const blind = problemsOf(validateBuild(legal(), emptyCatalogue));
  assert.deepEqual(
    blind.map((problem) => problem.rule),
    Array.from({ length: 6 }, () => "unknown-skill"),
  );
});

test("an attribute must belong to one of the build's two professions", () => {
  const result = validateBuild(
    broken({ attributes: { Strength: 12, Swordsmanship: 12, FireMagic: 3 } }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "attribute-off-profession", attribute: "FireMagic", profession: "E" },
  ]);
});

test("a rank of 0 on an attribute the build cannot have is not a problem", () => {
  // `library.ts` says an absent attribute is rank 0. A stored 0 therefore buys
  // nothing the game can see, and calling the build impossible over it would
  // reject a record that differs from a clean one only in what it wrote down.
  const result = validateBuild(
    broken({ attributes: { Strength: 12, Swordsmanship: 12, FireMagic: 0 } }),
    catalogue,
  );
  assert.deepEqual(result, { valid: true });
});

test("a primary attribute needs the profession as the primary, not the secondary", () => {
  // Divine Favor on a W/Mo: the build has Monk, but only as its secondary, and
  // a secondary profession does not bring its primary attribute with it.
  const secondary = validateBuild(
    broken({ attributes: { Strength: 12, DivineFavor: 3 } }),
    catalogue,
  );
  assert.deepEqual(problemsOf(secondary), [
    {
      rule: "primary-attribute-of-secondary",
      attribute: "DivineFavor",
      profession: "Mo",
    },
  ]);

  // Turned around, the same attribute is the whole point of the profession.
  const monk = broken({
    professions: ["Mo", "W"],
    skills: bar([21, 20, 12, 13, 40, 41, null, null]),
    // Tactics rather than Strength: a secondary profession brings its ordinary
    // attributes and only its primary is out of reach.
    attributes: { DivineFavor: 12, HealingPrayers: 12, Tactics: 3 },
  });
  assert.deepEqual(validateBuild(monk, catalogue), { valid: true });

  // Every profession's primary attribute is refused to a build that has that
  // profession second, and accepted when it has it first — driven over the
  // module's own table rather than over a copy of it. A copy would assert the
  // implementation back to itself for the eight rows the evidence document
  // marks as *assumed* (§3.2 — only the Assassin's and the Ritualist's are
  // source-asserted), because both literals would have been written from the
  // same guess. What is worth testing is the rule at both profession positions,
  // and a live read that corrects an entry changes one place and stays green.
  const primaries = Object.entries(PRIMARY_ATTRIBUTE) as readonly (readonly [
    Profession,
    Attribute,
  ])[];

  // The table's own shape, which is a fact about it and not a transcription:
  // ten professions, each primary owned by the profession that claims it, and
  // no attribute standing as two professions' primary. That is the shape a
  // copy-paste error takes, and it is checked against `heroes.ts`'s attribute
  // ownership rather than against a second list of pairs.
  assert.deepEqual(
    primaries.map(([profession]) => profession).sort(),
    Object.keys(PROFESSIONS).sort(),
  );
  for (const [profession, attribute] of primaries) {
    assert.equal(ATTRIBUTES[attribute].profession, profession, attribute);
  }
  assert.equal(new Set(primaries.map(([, attribute]) => attribute)).size, 10);

  const empty = bar([null, null, null, null, null, null, null, null]);

  for (const [profession, attribute] of primaries) {
    // Any second profession will do so long as it is not the one under test —
    // a repeated profession is a different rule and would mask this one.
    const partner = profession === "W" ? "Mo" : "W";
    const asSecondary = broken({
      professions: [partner, profession],
      skills: empty,
      attributes: { [attribute]: 6 },
    });
    const asPrimary = broken({
      professions: [profession, partner],
      skills: empty,
      attributes: { [attribute]: 6 },
    });

    assert.deepEqual(
      problemsOf(validateBuild(asSecondary, catalogue)),
      [{ rule: "primary-attribute-of-secondary", attribute, profession }],
      attribute,
    );
    assert.deepEqual(
      validateBuild(asPrimary, catalogue),
      { valid: true },
      attribute,
    );
  }
});

test("a rank above the cap is rejected rather than clamped", () => {
  // Unreachable from a `Build` literal — `AttributeRank` stops at 12 — which is
  // exactly why the cast is here. A2 decodes ranks off the wire and an imported
  // file is a promise nobody kept; this validator is where such a record first
  // meets the rules, so the runtime check is a boundary and not dead code.
  const decoded = broken({
    attributes: { Strength: 13 } as unknown as Build["attributes"],
  });
  assert.deepEqual(problemsOf(validateBuild(decoded, catalogue)), [
    { rule: "rank-above-cap", attribute: "Strength", rank: 13, cap: 12 },
  ]);

  // The rank buys nothing rather than costing an invented amount: the build is
  // rejected for the rank, not additionally for a budget it never spent.
  const rank12 = broken({ attributes: { Strength: 12 } });
  assert.deepEqual(validateBuild(rank12, catalogue), { valid: true });
});

test("the ranks together may not cost more than a level-20 character has", () => {
  // 97 + 97 + 21 = 215.
  const result = validateBuild(
    broken({
      professions: ["E", "Mo"],
      skills: bar([30, 40, 41, null, null, null, null, null]),
      attributes: { FireMagic: 12, EnergyStorage: 12, AirMagic: 6 },
    }),
    catalogue,
  );
  assert.deepEqual(problemsOf(result), [
    { rule: "over-budget", spent: 215, budget: 200 },
  ]);

  // One point under is legal, so the rule is `>` and not `>=`. 97 + 97 + 3 = 197.
  const affordable = broken({
    professions: ["E", "Mo"],
    skills: bar([30, 40, 41, null, null, null, null, null]),
    attributes: { FireMagic: 12, EnergyStorage: 12, AirMagic: 2 },
  });
  assert.deepEqual(validateBuild(affordable, catalogue), { valid: true });
});

test("the whole problem list is ordered: professions, bar slots, attributes, budget", () => {
  const result = validateBuild(
    broken({
      professions: ["W", "W"],
      skills: bar([null, 20, 10, 10, 999, null, null, null]),
      // 97 + 97 + 15 + 6 = 215. Healing Prayers is attribute 13 and Divine
      // Favor is 16, so enum order puts them in this order and alphabetical
      // order would not.
      attributes: {
        Strength: 12,
        Swordsmanship: 12,
        HealingPrayers: 5,
        DivineFavor: 3,
      },
    }),
    catalogue,
  );

  assert.deepEqual(problemsOf(result), [
    { rule: "secondary-repeats-primary", profession: "W" },
    { rule: "skill-off-profession", slot: 1, skill: 20, profession: "Mo" },
    { rule: "duplicate-skill", slot: 3, firstSlot: 2, skill: 10 },
    { rule: "second-elite", slot: 3, firstSlot: 2, skill: 10 },
    { rule: "unknown-skill", slot: 4, skill: 999 },
    {
      rule: "attribute-off-profession",
      attribute: "HealingPrayers",
      profession: "Mo",
    },
    {
      rule: "attribute-off-profession",
      attribute: "DivineFavor",
      profession: "Mo",
    },
    { rule: "over-budget", spent: 215, budget: 200 },
  ]);
});
