// `src/shared/builds/heroes.ts` is a transcription, and the failure mode of a
// transcription is not a crash — it is a build that loads the wrong skill on the
// wrong hero, or a hero picker whose seventh entry is somebody else. Nothing
// downstream can detect that, because every value is plausible. So this file
// checks the table at the points where the reviewed upstream constants make a
// checkable claim: how many heroes there are, where the ids stop, which ids are
// deliberately missing, and which values the source never supplied.
//
// That last one is most of the point. Hero display names, hero professions,
// eight of the ten primary attributes and the level-20 point budget are not in
// the reviewed source, and every one of them is a value somebody could
// supply from memory and be right about often enough to be dangerous. A missing
// value fails loudly at the one place that can resolve it — a live client read.
// A guessed one never fails at all. The tests below therefore assert the
// absences as hard as they assert the data, including a check on the module's
// own export list, so a later "while I was here" addition cannot land quietly.
//
// `library.ts` already makes half of this a compile-time question: `PROFESSIONS`
// and `ATTRIBUTES` are keyed by the unions it defines, so a misspelt, missing or
// invented name is a `tsc` error and not something asserted here. What is left
// for run time is everything about the *numbers*, which no type can see.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  Attribute,
  AttributeRank,
  Profession,
} from "../../src/shared/builds/library.ts";
import { heroId } from "../../src/shared/builds/library.ts";
import * as tables from "../../src/shared/builds/heroes.ts";
import {
  ATTRIBUTE_BY_ID,
  ATTRIBUTE_POINT_COST,
  ATTRIBUTES,
  HERO_BY_ID,
  HEROES,
  HEROES_IN_PANEL_ORDER,
  PROFESSION_BY_ID,
  PROFESSION_NONE_ID,
  PROFESSIONS,
} from "../../src/shared/builds/heroes.ts";

/** `Object.entries` widens the key; the records were declared with these. */
const professionEntries = Object.entries(PROFESSIONS) as readonly (readonly [
  Profession,
  (typeof PROFESSIONS)[Profession],
])[];
const attributeEntries = Object.entries(ATTRIBUTES) as readonly (readonly [
  Attribute,
  (typeof ATTRIBUTES)[Attribute],
])[];

const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_unused, index) => from + index);

test("the table holds the 39 real heroes and neither sentinel", () => {
  // The document's count: ids run consecutively from `NoHero = 0` to
  // `GhostOfAlthea = 39`, with `Count = 40` a sentinel and not a hero.
  assert.equal(HEROES.length, 39);

  const ids = HEROES.map((hero) => hero.id);
  assert.deepEqual(ascending(ids), range(1, 39));

  // `NoHero` is the player's own slot, which `library.ts` spells `null`, so it
  // must have no second spelling as a hero anyone could store.
  assert.equal(HERO_BY_ID.has(heroId(0)), false);
  // And the end marker is not a 40th hero.
  assert.equal(HERO_BY_ID.has(heroId(40)), false);

  // Six bits is what `EncodedTeamBuild` allocates. A 41st hero would not
  // overflow visibly; it would encode as somebody else.
  assert.ok(Math.max(...ids) < 64);

  // Names are the stable protocol identifiers and are used as fallback labels,
  // so two heroes sharing one is a defect the ids would not reveal.
  assert.equal(new Set(HEROES.map((hero) => hero.name)).size, 39);
});

test("HERO_BY_ID answers for every hero and for nothing else", () => {
  assert.equal(HERO_BY_ID.size, HEROES.length);
  for (const hero of HEROES) assert.equal(HERO_BY_ID.get(hero.id), hero);

  // Spot-checks at both ends of the enum, against the document's own rows.
  assert.equal(HERO_BY_ID.get(heroId(1))?.name, "Norgu");
  assert.equal(HERO_BY_ID.get(heroId(39))?.name, "GhostOfAlthea");

  // An id from outside the enum is a miss, not a default. A caller reading a
  // corrupt record must see `undefined` rather than hero 1.
  assert.equal(HERO_BY_ID.get(heroId(41)), undefined);
  assert.equal(HERO_BY_ID.get(heroId(255)), undefined);
});

test("panel order is a permutation of the 39 places after the player's own", () => {
  const orders = HEROES.map((hero) => hero.panelOrder);
  // Index 0 is `NoHero`, so the heroes fill 1-39 exactly: a duplicate or a gap
  // means the picker shows two heroes in one place or leaves one blank.
  assert.deepEqual(ascending(orders), range(1, 39));

  assert.equal(HEROES_IN_PANEL_ORDER.length, HEROES.length);
  assert.deepEqual(
    HEROES_IN_PANEL_ORDER.map((hero) => hero.panelOrder),
    range(1, 39),
  );
  // Derived from the same rows, not a second transcription of them.
  assert.deepEqual([...HEROES_IN_PANEL_ORDER].sort((a, b) => a.id - b.id), [
    ...HEROES,
  ]);

  // The document's own worked example of why this column exists: Razah sorts
  // after the mesmers rather than by id, and Goren leads the list.
  assert.equal(HEROES_IN_PANEL_ORDER[0]?.name, "Goren");
  assert.equal(HERO_BY_ID.get(heroId(15))?.panelOrder, 14);
});

test("no hero carries a profession or a display name, because the source has neither", () => {
  // Both are read from the client at run time. The check that matters is that
  // nothing here *looks* like an answer: a `professions` field defaulted to
  // W/W, or a `displayName` copied from the enum, would be believed.
  for (const hero of HEROES) {
    const fields = Object.keys(hero).sort();
    assert.deepEqual(fields, ["campaign", "id", "kind", "name", "panelOrder"], hero.name);
  }
});

test("the eight mercenaries are the only heroes no campaign unlocks", () => {
  const mercenaries = HEROES.filter((hero) => hero.kind === "mercenary");
  assert.deepEqual(
    mercenaries.map((hero) => hero.name),
    ["Merc1", "Merc2", "Merc3", "Merc4", "Merc5", "Merc6", "Merc7", "Merc8"],
  );

  // An empty campaign is a fact about mercenaries, not a row someone forgot:
  // no campaign lists one, so the two sets must coincide exactly.
  for (const hero of HEROES) {
    assert.equal(
      hero.campaign === null,
      hero.kind === "mercenary",
      hero.name,
    );
  }

  // The four campaigns the document cites, and no fifth.
  assert.deepEqual(
    [...new Set(HEROES.map((hero) => hero.campaign).filter((c) => c !== null))].sort(),
    ["EyeOfTheNorth", "Factions", "Nightfall", "Prophecies"],
  );
});

test("Razah is player-chosen too, and is the only non-mercenary that is", () => {
  const chosen = HEROES.filter((hero) => hero.kind !== "campaign");
  // Nine heroes have no fixed profession pair to cache: Razah plus the eight.
  assert.equal(chosen.length, 9);

  const razah = HERO_BY_ID.get(heroId(15));
  assert.equal(razah?.name, "Razah");
  assert.equal(razah?.kind, "razah");
  // He is unlocked by a campaign like any other hero — it is only his
  // professions that come from the account, so he is not a mercenary.
  assert.equal(razah?.campaign, "Nightfall");
  assert.equal(
    HEROES.filter((hero) => hero.kind === "razah").length,
    1,
  );
});

test("the ten professions carry ids 1-10, and None is not one of them", () => {
  assert.equal(professionEntries.length, 10);

  const ids = professionEntries.map(([, facts]) => facts.id);
  assert.deepEqual(ascending(ids), range(1, 10));
  assert.equal(PROFESSION_BY_ID.size, 10);

  // Id 10 fills the whisper format's 4-bit field exactly; an 11th would not.
  assert.ok(Math.max(...ids) < 16);

  // `None` is the absent-secondary sentinel, not a profession. It must be
  // reachable as a number and unreachable as a row.
  assert.equal(PROFESSION_NONE_ID, 0);
  assert.equal(PROFESSION_BY_ID.get(PROFESSION_NONE_ID), undefined);
  assert.equal(PROFESSION_BY_ID.get(11), undefined);

  // Both directions agree, so an encoder and a decoder cannot disagree.
  for (const [acronym, facts] of professionEntries) {
    assert.equal(PROFESSION_BY_ID.get(facts.id), acronym);
  }
  assert.equal(PROFESSIONS.Mo.id, 3);
  assert.equal(PROFESSIONS.D.name, "Dervish");
});

test("attribute ids skip the unnamed 26-28 gap and never spell the None sentinel", () => {
  assert.equal(attributeEntries.length, 42);

  const ids = attributeEntries.map(([, facts]) => facts.id);
  assert.deepEqual(ascending(ids), [...range(0, 25), ...range(29, 44)]);
  assert.equal(ATTRIBUTE_BY_ID.size, 42);

  // The three the source restarts past. A decoder must fail on them, which it
  // can only do if they are absent here rather than mapped to something.
  for (const unknown of [26, 27, 28]) {
    assert.equal(ATTRIBUTE_BY_ID.get(unknown), undefined, String(unknown));
  }
  // `None = 0xff` does not fit the 6-bit wire field and is an in-memory marker
  // only; an unset attribute is absent from `AttributeRanks` instead.
  assert.equal(ATTRIBUTE_BY_ID.get(255), undefined);

  // 44 is the highest, which is what the 6-bit escape in the party-loadout
  // attribute field is sized for.
  assert.ok(Math.max(...ids) < 64);

  for (const [name, facts] of attributeEntries) {
    assert.equal(ATTRIBUTE_BY_ID.get(facts.id), name);
  }
  // The spellings the document spot-checks, including the American "Favor".
  assert.equal(ATTRIBUTES.WildernessSurvival.id, 24);
  assert.equal(ATTRIBUTES.DivineFavor.id, 16);
  assert.equal(ATTRIBUTES.SpawningPower.id, 36);
});

test("every attribute names a profession the table defines", () => {
  const acronyms = new Set(professionEntries.map(([acronym]) => acronym));
  for (const [name, facts] of attributeEntries) {
    assert.ok(acronyms.has(facts.profession), name);
  }

  // Every profession owns at least one attribute: an empty column would mean a
  // row was attributed to the wrong profession somewhere.
  for (const [acronym] of professionEntries) {
    assert.ok(
      attributeEntries.some(([, facts]) => facts.profession === acronym),
      acronym,
    );
  }
});

test("a profession row states its wire id and its English name, and nothing else", () => {
  // A profession's primary attribute is a *rule*, not a wire value, and
  // `validate.ts`'s `PRIMARY_ATTRIBUTE` is the one table that states it — with
  // a per-line comment marking which two of the ten the source asserts ("sin/rit
  // primary (gw is weird)") and which eight are assumed. This file used to carry
  // those two a second time and `null` for the rest, read by no production code
  // at all: its whole function was to be cross-checked against the table that
  // does the work. A fact stated twice is a fact that can disagree with itself
  // instead of a fact that can be corrected, so it is stated once.
  //
  // What is left is what this file transcribes. Asserting the row's whole key
  // set keeps it that way: a `primaryAttribute`, a hero name, or any other
  // remembered value has to arrive with a reason, here, where the absences are
  // written down.
  for (const [acronym, facts] of professionEntries) {
    assert.deepEqual(Object.keys(facts).sort(), ["id", "name"], acronym);
  }
});

test("the cost table has one entry per rank and rises with every one", () => {
  // Written as `AttributeRank` values so the list is checked against the union
  // rather than against itself: thirteen entries is *why* a stored rank stops
  // at 12, and the two must not be changed apart.
  const ranks: readonly AttributeRank[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(ascending(Object.keys(ATTRIBUTE_POINT_COST).map(Number)), [
    ...ranks,
  ]);

  const costs = ranks.map((rank) => ATTRIBUTE_POINT_COST[rank]);
  assert.deepEqual(costs, [0, 1, 3, 6, 10, 15, 21, 28, 37, 48, 61, 77, 97]);

  // Strictly increasing, so "can this character afford rank n" is answerable by
  // comparison alone. Rank 12 costs 97 of a budget this file does not claim.
  for (let rank = 1; rank < costs.length; rank += 1) {
    assert.ok((costs[rank] ?? 0) > (costs[rank - 1] ?? 0), String(rank));
  }
  assert.equal(ATTRIBUTE_POINT_COST[12], 97);
});

test("the module exports nothing the source could not supply", () => {
  // The absences are the fragile part of this file, and every one of them is a
  // value a later reader will know off the top of their head. This asserts the
  // whole export surface so that adding the point budget, an English hero-name
  // list, or the missing eight primaries has to come here first — where the
  // reason they are absent is written down.
  // `heroLabel` is the one deliberate exception and stays a derivation, not a
  // column: it separates the words of the identifier this table already holds.
  // The English *name* is still absent, and the reason is unchanged — the
  // display name is localised and belongs to the client. If a name column ever
  // shows up in `HEROES`, this list has to change and this comment has to be
  // argued with first.
  assert.deepEqual(Object.keys(tables).sort(), [
    "ATTRIBUTES",
    "ATTRIBUTE_BY_ID",
    "ATTRIBUTE_POINT_COST",
    "HEROES",
    "HEROES_IN_PANEL_ORDER",
    "HERO_BY_ID",
    "PROFESSIONS",
    "PROFESSION_BY_ID",
    "PROFESSION_NONE_ID",
    "heroLabel",
  ]);
});
