// The point of `src/shared/builds/diff.ts` is not that it can tell two builds
// apart — comparing two records is easy, and a diff that answers "slot 3
// changed" is easy and useless. The point is that every answer it gives is one
// a player can read: the skill that left and the skill that arrived, a verb
// that agrees with what differs, and a nearest match that is either the build
// you already have or a genuinely close one rather than the least-bad row in
// the library. Those are the claims worth pinning, because each one is a way
// the module could be plausibly wrong while still "working":
//
//   - dropping `from` and keeping only the changed position (the swap becomes
//     unnameable, and the compare view has nothing to render),
//   - counting one difference and saying "differ", or two and saying "differs",
//   - treating an unspent attribute as different from an absent one, so a build
//     that changed nothing reports "1 attribute differs",
//   - letting `nearestBuild` answer past its ceiling, or answer with the first
//     candidate rather than the closest, which turns the near-duplicate guard
//     into a source of wrong "this is a variant of X" offers,
//   - matching a build against itself, which makes every stored build an exact
//     duplicate of something.
//
// The failure paths here are the ones the stored file actually reaches: an
// empty slot on either end of a swap, an attribute written as an explicit 0, a
// team slot whose build id names nothing, a party that lists a hero twice, and
// a record short of eight slots because that is what was on disk. None of them
// may throw — a diff runs while the player types, and a library that cannot be
// compared is a library that cannot be opened.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  Build,
  BuildLibrary,
  SkillBar,
  Team,
  TeamSlot,
  TeamSlots,
} from "../../src/shared/builds/library.ts";
import {
  LIBRARY_VERSION,
  buildId,
  heroId,
  skillId,
  teamId,
} from "../../src/shared/builds/library.ts";
import {
  diffBuilds,
  diffSummary,
  droppedByTeam,
  nearestBuild,
} from "../../src/shared/builds/diff.ts";

/** Written out rather than mapped so the fixture helpers need no casts. */
type Eight<T> = readonly [T, T, T, T, T, T, T, T];

const bar = (ids: Eight<number | null>): SkillBar => {
  const one = (id: number | null) => (id === null ? null : skillId(id));
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

// The numbers stand in for the client's skill ids; nothing here depends on
// which number a skill really has, only on the names being distinguishable when
// an assertion fails.
const WOH = 1;
const PATIENT_SPIRIT = 2;
const INFUSE_HEALTH = 3;
const PROTECTIVE_SPIRIT = 4;
const AEGIS = 5;
const GLYPH_OF_LESSER_ENERGY = 6;
const RESURRECTION_SIGNET = 7;
const DWAYNAS_KISS = 8;

/** The build every case below is a small edit away from. */
const monk: Build = {
  id: buildId("b_woh"),
  name: "Word of Healing",
  professions: ["Mo", "Me"],
  skills: bar([
    WOH,
    DWAYNAS_KISS,
    PATIENT_SPIRIT,
    INFUSE_HEALTH,
    PROTECTIVE_SPIRIT,
    AEGIS,
    null,
    RESURRECTION_SIGNET,
  ]),
  attributes: { HealingPrayers: 12, DivineFavor: 9, ProtectionPrayers: 3 },
  tags: ["hero"],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: null,
  origin: null,
};

/** A distinct build that differs from `monk` only in the ways named. */
const variant = (id: string, changes: Partial<Build>): Build => ({
  ...monk,
  id: buildId(id),
  name: id,
  ...changes,
});

const libraryOf = (
  builds: readonly Build[],
  teams: readonly Team[] = [],
): BuildLibrary => ({
  version: LIBRARY_VERSION,
  builds,
  teams,
  tags: ["hero"],
});

const vacant: TeamSlot = {
  build: null,
  hero: null,
  behaviour: "guard",
};

const party = (slots: TeamSlots): Team => ({
  id: teamId("t_party"),
  name: "party",
  tags: [],
  mode: "none",
  favourite: false,
  lastUsed: null,
  notes: "",
  slots,
});

const hero = (ref: string | null, id: number): TeamSlot => ({
  build: ref === null ? null : buildId(ref),
  hero: heroId(id),
  behaviour: "guard",
});

const LIVIA = 1;
const OLIAS = 2;
const MASTER_OF_WHISPERS = 3;
const GWEN = 4;

test("two builds with the same content are zero apart, however they were written", () => {
  const copy = variant("b_woh_copy", {});
  const diff = diffBuilds(monk, copy);

  assert.deepEqual(diff.skills, []);
  assert.deepEqual(diff.attributes, []);
  assert.equal(diff.professions, null);
  assert.equal(diff.total, 0);
  assert.equal(diffSummary(diff), "identical");

  // The same build spelled differently is still the same build: attributes in
  // another order, and an unspent attribute written out rather than omitted.
  // "Absent is rank 0" is the library's rule, so 0 and absent cannot be a
  // difference — otherwise saving a build twice would report a change.
  const respelled = variant("b_woh_respelled", {
    attributes: {
      ProtectionPrayers: 3,
      HealingPrayers: 12,
      DivineFavor: 9,
      SmitingPrayers: 0,
    },
  });
  assert.equal(diffBuilds(monk, respelled).total, 0);
  assert.equal(diffBuilds(respelled, monk).total, 0);
});

test("a single skill change is reported as a named swap, not as a slot number", () => {
  const swapped = variant("b_woh_glyph", {
    skills: bar([
      WOH,
      DWAYNAS_KISS,
      GLYPH_OF_LESSER_ENERGY,
      INFUSE_HEALTH,
      PROTECTIVE_SPIRIT,
      AEGIS,
      null,
      RESURRECTION_SIGNET,
    ]),
  });

  const diff = diffBuilds(monk, swapped);
  assert.equal(diff.total, 1);
  assert.equal(diff.skills.length, 1);

  const [change] = diff.skills;
  assert.ok(change);
  assert.equal(change.slot, 2);
  // Both ends present is the whole claim: with only `slot` a caller can say
  // "slot 3 changed" and nothing more.
  assert.equal(change.from, skillId(PATIENT_SPIRIT));
  assert.equal(change.to, skillId(GLYPH_OF_LESSER_ENERGY));
  assert.equal(diffSummary(diff), "1 skill differs");

  // Direction is a promise, not an accident: the first argument is the "from".
  const reversed = diffBuilds(swapped, monk);
  assert.deepEqual(reversed.skills, [
    { slot: 2, from: skillId(GLYPH_OF_LESSER_ENERGY), to: skillId(PATIENT_SPIRIT) },
  ]);

  // An empty position is a real value, so both ends of filling one in are
  // named: `null → skill` on the way in, `skill → null` on the way out.
  const filledIn = variant("b_woh_full", {
    skills: bar([
      WOH,
      DWAYNAS_KISS,
      PATIENT_SPIRIT,
      INFUSE_HEALTH,
      PROTECTIVE_SPIRIT,
      AEGIS,
      GLYPH_OF_LESSER_ENERGY,
      RESURRECTION_SIGNET,
    ]),
  });
  assert.deepEqual(diffBuilds(monk, filledIn).skills, [
    { slot: 6, from: null, to: skillId(GLYPH_OF_LESSER_ENERGY) },
  ]);
  assert.deepEqual(diffBuilds(filledIn, monk).skills, [
    { slot: 6, from: skillId(GLYPH_OF_LESSER_ENERGY), to: null },
  ]);
});

test("the summary's verb agrees with what differs, at none, one and two", () => {
  const summaryOf = (changes: Partial<Build>): string =>
    diffSummary(diffBuilds(monk, variant("b_probe", changes)));

  const oneSkill = bar([
    WOH,
    DWAYNAS_KISS,
    GLYPH_OF_LESSER_ENERGY,
    INFUSE_HEALTH,
    PROTECTIVE_SPIRIT,
    AEGIS,
    null,
    RESURRECTION_SIGNET,
  ]);
  const twoSkills = bar([
    WOH,
    DWAYNAS_KISS,
    GLYPH_OF_LESSER_ENERGY,
    INFUSE_HEALTH,
    PROTECTIVE_SPIRIT,
    AEGIS,
    GLYPH_OF_LESSER_ENERGY,
    RESURRECTION_SIGNET,
  ]);

  assert.equal(summaryOf({}), "identical");
  assert.equal(summaryOf({ skills: oneSkill }), "1 skill differs");
  assert.equal(summaryOf({ skills: twoSkills }), "2 skills differ");
  assert.equal(
    summaryOf({ attributes: { HealingPrayers: 11, DivineFavor: 9, ProtectionPrayers: 3 } }),
    "1 attribute differs",
  );
  assert.equal(
    summaryOf({ attributes: { HealingPrayers: 11, DivineFavor: 8, ProtectionPrayers: 3 } }),
    "2 attributes differ",
  );

  // Two singular things listed together still take the plural verb: the subject
  // is compound, so "1 skill, 1 attribute differs" is wrong even though both
  // counts are one.
  assert.equal(
    summaryOf({
      skills: oneSkill,
      attributes: { HealingPrayers: 11, DivineFavor: 9, ProtectionPrayers: 3 },
    }),
    "1 skill, 1 attribute differ",
  );
  assert.equal(
    summaryOf({
      skills: twoSkills,
      attributes: { HealingPrayers: 11, DivineFavor: 9, ProtectionPrayers: 3 },
    }),
    "2 skills, 1 attribute differ",
  );

  // A profession change is one difference but never a singular subject.
  assert.equal(summaryOf({ professions: ["Mo", "E"] }), "professions differ");
  assert.equal(
    summaryOf({
      skills: twoSkills,
      attributes: { HealingPrayers: 11, DivineFavor: 9, ProtectionPrayers: 3 },
      professions: ["Mo", null],
    }),
    "2 skills, 1 attribute, professions differ",
  );
});

test("a build that only re-spends its attributes still reports a difference", () => {
  const respent = variant("b_woh_prot", {
    attributes: { HealingPrayers: 11, DivineFavor: 9, SmitingPrayers: 4 },
  });

  const diff = diffBuilds(monk, respent);
  assert.deepEqual(diff.skills, []);
  assert.equal(diff.professions, null);
  assert.equal(diff.total, 3);

  // A rank moved, an attribute abandoned (to 0) and one taken up (from 0) are
  // all the same kind of change, and each carries both ranks.
  const byName = new Map(diff.attributes.map((a) => [a.attribute, a]));
  assert.deepEqual(byName.get("HealingPrayers"), {
    attribute: "HealingPrayers",
    from: 12,
    to: 11,
  });
  assert.deepEqual(byName.get("ProtectionPrayers"), {
    attribute: "ProtectionPrayers",
    from: 3,
    to: 0,
  });
  assert.deepEqual(byName.get("SmitingPrayers"), {
    attribute: "SmitingPrayers",
    from: 0,
    to: 4,
  });
  assert.equal(diffSummary(diff), "3 attributes differ");
});

test("a profession change is one difference and carries both pairs", () => {
  const monoclass = variant("b_woh_mono", { professions: ["Mo", null] });
  const diff = diffBuilds(monk, monoclass);

  assert.equal(diff.total, 1);
  assert.deepEqual(diff.professions, { from: ["Mo", "Me"], to: ["Mo", null] });
  assert.deepEqual(diff.skills, []);
});

test("nearestBuild answers with the closest build inside its ceiling, or with nothing", () => {
  const oneAway = variant("b_near", {
    attributes: { HealingPrayers: 11, DivineFavor: 9, ProtectionPrayers: 3 },
  });
  const twoAway = variant("b_mid", {
    attributes: { HealingPrayers: 11, DivineFavor: 8, ProtectionPrayers: 3 },
  });
  const fourAway = variant("b_far", {
    skills: bar([
      GLYPH_OF_LESSER_ENERGY,
      GLYPH_OF_LESSER_ENERGY,
      GLYPH_OF_LESSER_ENERGY,
      GLYPH_OF_LESSER_ENERGY,
      PROTECTIVE_SPIRIT,
      AEGIS,
      null,
      RESURRECTION_SIGNET,
    ]),
  });

  // The nearer candidate wins even though the further one is listed first, and
  // even when both are inside the ceiling. Answering "first admissible" would
  // pass a test that only ever holds one candidate.
  const both = libraryOf([twoAway, oneAway, fourAway]);
  const near = nearestBuild(both, monk);
  assert.ok(near);
  assert.equal(near.build.id, buildId("b_near"));
  assert.equal(near.exact, false);
  assert.equal(near.diff.total, 1);
  assert.equal(nearestBuild(both, monk, 4)?.build.id, buildId("b_near"));

  // The diff runs from the named build to the incoming one, which is the order
  // the offer is phrased in: "1 attribute differs from b_near".
  assert.deepEqual(near.diff.attributes, [
    { attribute: "HealingPrayers", from: 11, to: 12 },
  ]);
  assert.equal(`${diffSummary(near.diff)} from ${near.build.name}`, "1 attribute differs from b_near");

  // The ceiling is a real limit, not a preference: nothing inside it means no
  // offer, which is how a genuinely new build stays a new build.
  assert.equal(nearestBuild(libraryOf([fourAway]), monk), null);
  assert.equal(nearestBuild(both, monk, 0), null);
  assert.equal(nearestBuild(libraryOf([]), monk), null);

  // An exact match is the "you already have this" answer, and it outranks a
  // near one however the library is ordered.
  const exact = nearestBuild(libraryOf([oneAway, variant("b_same", {})]), monk);
  assert.ok(exact);
  assert.equal(exact.build.id, buildId("b_same"));
  assert.equal(exact.exact, true);
  assert.equal(exact.diff.total, 0);
});

test("nearestBuild never matches a build against itself, nor across primary professions", () => {
  // The build being examined is in the library, which is the ordinary case when
  // re-checking a stored build. Matching itself would report every build as an
  // exact duplicate and offer to merge it into itself.
  const self = nearestBuild(libraryOf([monk]), monk);
  assert.equal(self, null);

  const oneAway = variant("b_near", {
    attributes: { HealingPrayers: 11, DivineFavor: 9, ProtectionPrayers: 3 },
  });
  assert.equal(nearestBuild(libraryOf([monk, oneAway]), monk)?.build.id, buildId("b_near"));

  // A Ritualist running the same bar is not a variant of the Monk build: within
  // the ceiling by count, and wrong to offer.
  const otherPrimary = variant("b_rit", { professions: ["Rt", "Me"] });
  assert.equal(nearestBuild(libraryOf([otherPrimary]), monk), null);

  // The secondary is compared, not policed — re-secondarying a bar is exactly
  // the kind of variant this is meant to catch.
  const otherSecondary = variant("b_mo_e", { professions: ["Mo", "E"] });
  const near = nearestBuild(libraryOf([otherSecondary]), monk);
  assert.ok(near);
  assert.equal(near.build.id, buildId("b_mo_e"));
  assert.equal(near.diff.total, 1);
});

test("droppedByTeam names the working heroes a team has no place for, once each", () => {
  const empty = variant("b_empty", {
    skills: bar([null, null, null, null, null, null, null, null]),
  });
  const library = libraryOf([monk, empty]);

  const live = party([
    { ...vacant, build: buildId("b_woh") }, // the player, no hero
    hero("b_woh", LIVIA),
    hero("b_empty", OLIAS), // in the party, doing nothing
    hero("b_woh", MASTER_OF_WHISPERS),
    hero("b_missing", GWEN), // build id names nothing in the library
    vacant,
    vacant,
    vacant,
  ]);

  const wanted = party([
    { ...vacant, build: buildId("b_woh") },
    hero("b_woh", MASTER_OF_WHISPERS),
    vacant,
    vacant,
    vacant,
    vacant,
    vacant,
    vacant,
  ]);

  // Livia is working and unwanted, so she is the loss worth warning about.
  // Olias' bar is empty and Gwen's build is gone, so neither is doing anything
  // the player would notice losing; the Master of Whispers is kept; and slot 0
  // is the player, who carries no hero and cannot be dropped.
  assert.deepEqual(droppedByTeam(library, live, wanted), [heroId(LIVIA)]);

  // A team that asks for nobody drops everyone who was working.
  const nobody = party([vacant, vacant, vacant, vacant, vacant, vacant, vacant, vacant]);
  assert.deepEqual(droppedByTeam(library, live, nobody), [
    heroId(LIVIA),
    heroId(MASTER_OF_WHISPERS),
  ]);

  // A party is not supposed to list a hero twice. If one does, the warning
  // names the hero once rather than describing the bug.
  const doubled = party([
    vacant,
    hero("b_woh", LIVIA),
    hero("b_woh", LIVIA),
    vacant,
    vacant,
    vacant,
    vacant,
    vacant,
  ]);
  assert.deepEqual(droppedByTeam(library, doubled, nobody), [heroId(LIVIA)]);

  // Nothing live means nothing lost, and an empty library cannot say any bar is
  // worth keeping.
  assert.deepEqual(droppedByTeam(library, nobody, wanted), []);
  assert.deepEqual(droppedByTeam(libraryOf([]), live, nobody), []);
});

test("a stored record short of eight slots is compared rather than thrown over", () => {
  // The tuple type says eight, and a file on disk can still say six. `slice`
  // stands in for that file: the diff has to answer, because a library that
  // cannot be compared is a library that cannot be opened.
  const truncated = {
    ...monk,
    id: buildId("b_truncated"),
    skills: monk.skills.slice(0, 6),
  } as unknown as Build;

  const diff = diffBuilds(monk, truncated);
  // The two missing positions read as empty, and one of them was already empty.
  assert.deepEqual(diff.skills, [
    { slot: 7, from: skillId(RESURRECTION_SIGNET), to: null },
  ]);
  assert.equal(diff.total, 1);
  assert.equal(diffSummary(diff), "1 skill differs");
  assert.equal(diffBuilds(truncated, monk).total, 1);
});
