// `src/shared/builds/live-party.ts` is the read counterpart of `team-apply.ts`,
// and the whole of its value is in refusing to fill a blank. The companion
// publishes a fraction of what the type describes and will until the party
// region lands, so every case below drives one unobserved field and asserts it
// arrives as `null` — not as zero, not as an empty bar, not as a hero the
// table cannot name.
//
// That is not fussiness about a sentinel. The next thing built on this module
// is capture, and a captured build carrying invented attributes or a bar of
// eight empty slots is worse than one that admits it has none: the first is
// silently wrong in the library forever, the second is visibly incomplete and
// gets fixed. The boundary between "observed as absent" and "not observed" is
// the only thing standing between those two outcomes, so it is asserted here
// rather than left to the caller's judgement.
//
// The `partial` flag is derived and is tested as such: it is the single place
// the rule "this is not the whole party" is decided, and a panel that had to
// recompute it would eventually disagree with one that did not.
import test from "node:test";
import assert from "node:assert/strict";
import {
  liveParty,
  professionPair,
  unavailableParty,
} from "../../src/shared/builds/live-party.ts";
import { heroId } from "../../src/shared/builds/library.ts";

test("an observation that is not ready is a party nobody can draw", () => {
  for (const status of ["waiting", "unsupported", "", "READY"]) {
    const party = liveParty({ status, heroAvailable: true, heroCount: 4, firstHeroId: 6 });
    assert.equal(party.status, "unavailable", `status ${JSON.stringify(status)}`);
    assert.equal(party.heroCount, 0);
    assert.deepEqual(party.heroes, []);
    assert.equal(party.partial, false);
  }
  // The same statement, so it must be the same value rather than a second
  // shape the interface has to learn.
  assert.deepEqual(liveParty({ status: "waiting" }), unavailableParty());
});

// The one this module was written to prevent and shipped with anyway. Zoning
// between outposts publishes a perfectly well-formed record in which the
// kernel has read nothing: hero count 0, no hero available. Read as a party,
// that is the claim "you have no heroes", and the panel duly made it in the
// middle of every map load. `partyObserved` is the difference between a record
// that decoded and a party that was looked at.
test("a well-formed record nobody took a reading for is not an empty party", () => {
  const midZone = liveParty({
    status: "ready",
    heroCount: 0,
    firstHeroId: 0,
    firstHeroAgentId: 0,
  });

  assert.equal(midZone.status, "unavailable");
  assert.deepEqual(midZone, unavailableParty(), "the same statement, one value");

  // Explicit false is the same statement as absent, and must not read as a
  // weaker one.
  assert.deepEqual(
    liveParty({ status: "ready", partyObserved: false, heroCount: 0 }),
    unavailableParty(),
  );

  // And an observed empty party is a real, different answer: the walk ran, and
  // you genuinely have no heroes.
  const observedEmpty = liveParty({ status: "ready", partyObserved: true, heroCount: 0 });
  assert.equal(observedEmpty.status, "ready");
  assert.notDeepEqual(observedEmpty, unavailableParty());
});

test("a counted but unnamed hero is counted, not invented", () => {
  const party = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 3,
    firstHeroId: 6,
    firstHeroAgentId: 142,
  });

  assert.equal(party.status, "ready");
  assert.equal(party.heroCount, 3);
  assert.equal(party.heroes.length, 1, "only the identified hero is listed");
  assert.equal(party.partial, true, "three counted, one named");
  assert.equal(party.heroes[0]?.hero, heroId(6));
  assert.equal(party.heroes[0]?.agentId, 142);
});

test("every field the companion has not published reads as not observed", () => {
  const [hero] = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 1,
    firstHeroId: 6,
    firstHeroAgentId: 142,
  }).heroes;

  assert.ok(hero);
  // Position included: the kernel walks the hero array skipping heroes owned by
  // other players, so the index it stops at is not the position the player
  // sees, and claiming slot 1 would be a guess that looks like a fact.
  assert.equal(hero.slot, null, "party position");
  assert.equal(hero.professions, null, "professions");
  assert.equal(hero.behaviour, null, "behaviour");
  assert.equal(hero.level, null, "level");
  assert.equal(hero.skills, null, "skill bar");
  assert.equal(hero.disabled, null, "disabled slots");
});

test("account and instance facts stay unknown rather than defaulting to false", () => {
  const party = liveParty({ status: "ready", partyObserved: true, heroCount: 0 });

  // `unlocked: null` and an empty set are different claims. Only one of them
  // may grey a hero out in the picker.
  assert.equal(party.unlocked, null, "unlocked heroes");
  assert.equal(party.hardMode, null, "hard mode");
  assert.equal(party.inOutpost, null, "in an outpost");
});

test("a hero the table cannot name is dropped rather than published as a number", () => {
  for (const firstHeroId of [0, 40, 999, -1, 6.5]) {
    const party = liveParty({
      status: "ready",
      partyObserved: true,
      heroAvailable: true,
      heroCount: 2,
      firstHeroId,
    });
    assert.deepEqual(party.heroes, [], `hero id ${firstHeroId}`);
    // Dropping the identity does not drop the count — the party still has two
    // heroes in it and saying otherwise would be a second wrong answer.
    assert.equal(party.heroCount, 2);
    assert.equal(party.partial, true);
  }
});

test("the flag says available or the hero is not listed, whatever the id says", () => {
  const party = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: false,
    heroCount: 2,
    firstHeroId: 6,
  });
  assert.deepEqual(party.heroes, []);
});

test("a fully named party is not partial", () => {
  const party = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 1,
    firstHeroId: 6,
  });
  assert.equal(party.partial, false);
});

test("a nonsense count is floored rather than trusted", () => {
  for (const heroCount of [-3, Number.NaN, 1.5]) {
    const party = liveParty({ status: "ready", partyObserved: true, heroCount });
    assert.equal(party.heroCount, 0, `count ${String(heroCount)}`);
    assert.equal(party.partial, false);
  }
  // Absent entirely, which is what an older decoder would send.
  const party = liveParty({ status: "ready", partyObserved: true });
  assert.equal(party.heroCount, 0);
  assert.equal(party.partial, false);
});

test("profession ids become acronyms, and None is a secondary rather than a refusal", () => {
  assert.deepEqual(professionPair(1, 3), ["W", "Mo"]);
  // `Profession::None` as a secondary is a monoclass character, which is a real
  // state — not a read that failed.
  assert.deepEqual(professionPair(1, 0), ["W", null]);
  // A primary of None is a read that failed: every character has one.
  assert.equal(professionPair(0, 1), null);
  assert.equal(professionPair(1, 99), null);
  assert.equal(professionPair(99, 1), null);
});

// The party region supersedes the scalar summary, and the summary stays as the
// fallback rather than being deleted: a build whose layout carries no detail
// offsets still publishes the one-hero projection, and that is better than
// nothing on screen.
test("the full roster wins over the summary, and carries what was read", () => {
  const party = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 1,
    firstHeroId: 6,
    party: {
      status: "ready",
      rosterObserved: true,
      unlockObserved: true,
      slotCount: 2,
      unlocked: [38, 39],
      slots: [
        {
          index: 0, occupied: false, hero: null, agentId: null, level: null,
          professions: null, behaviour: null, skills: null, disabled: null,
          attributes: null,
        },
        {
          index: 1, occupied: true, hero: 38, agentId: 43, level: 16,
          professions: [1, 2], behaviour: 1,
          skills: [354, 357, 0, 351, 316, 371, 446, 2], disabled: 0b0000_0101,
          attributes: [[17, 7], [19, 12]],
        },
        {
          index: 2, occupied: true, hero: 39, agentId: 21, level: 15,
          professions: [5, 0], behaviour: null, skills: null, disabled: null,
          attributes: null,
        },
      ],
    },
  });

  assert.equal(party.heroes.length, 2, "the region's roster, not the summary's");
  assert.equal(party.partial, false);

  const [devona, althea] = party.heroes;
  // Party position is a fact now, not a guess: the kernel publishes the slot.
  assert.equal(devona?.slot, 1);
  assert.equal(devona?.hero, heroId(38));
  assert.deepEqual(devona?.professions, ["W", "R"]);
  assert.equal(devona?.behaviour, "guard");
  assert.equal(devona?.level, 16);
  // A zero skill id is an empty slot on the bar, not skill zero.
  assert.deepEqual(devona?.skills?.[2], null);
  assert.deepEqual(devona?.disabled, [0, 2]);

  // A monoclass hero has a real `null` secondary, and unread fields stay null
  // beside a sibling that was read — the flags are per slot, not per party.
  assert.deepEqual(althea?.professions, ["Me", null]);
  assert.equal(althea?.behaviour, null);
  assert.equal(althea?.skills, null);
  assert.equal(althea?.disabled, null);

  assert.deepEqual([...party.unlocked ?? []], [heroId(38), heroId(39)]);
});

test("a region whose walk was rejected is not an empty party", () => {
  const rejected = liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: 2,
    firstHeroId: 38,
    // Decodable, but nobody read it: eight empty slots that must not be shown
    // as a party of none. The summary is the fallback, so it answers instead.
    party: { status: "ready", rosterObserved: false, slotCount: 0, slots: [] },
  });

  assert.equal(rejected.heroCount, 2, "the summary still counted two");
  assert.equal(rejected.heroes.length, 1);
  assert.equal(rejected.partial, true);
});
