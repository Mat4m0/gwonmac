// Capture is the one place in the toolbox where the game writes into the
// library, and the library is the thing that outlives the session. A wrong
// reading here is not a wrong pixel — it is a build the player keeps, trusts,
// and eventually publishes as a template.
//
// So the load-bearing assertion in this file is a round trip:
// `captureParty` -> `resolveTeamApplyPlan` -> valid. Those two modules were
// written months apart and share no code, and `resolveTeamApplyPlan` already
// encodes nine independent reasons a team cannot be handed to the game. Passing
// through it means a captured team is a team by the same definition every other
// team in the library is held to, rather than by capture's own opinion of one.
//
// The rest of the file is the other half: everything capture *could not* read
// has to arrive as absent and be said out loud, because a build carrying
// invented attributes or a bar of eight empty slots is silently wrong forever,
// while one that admits what it is missing gets fixed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_ORIGIN,
  captureParty,
  liveParty,
  unavailableParty,
  type ToolboxObservation,
} from "../../src/shared/builds/live-party.ts";
import {
  LIBRARY_VERSION,
  PARTY_SIZE,
  type BuildLibrary,
} from "../../src/shared/builds/library.ts";
import { resolveTeamApplyPlan } from "../../src/shared/builds/team-apply.ts";
import { validateBuild } from "../../src/shared/builds/validate.ts";

type RegionSlot = NonNullable<
  NonNullable<ToolboxObservation["party"]>["slots"]
>[number];

/** A fully observed hero, which is what the certified layout publishes. */
function hero(
  index: number,
  id: number,
  over: Partial<RegionSlot> = {},
): RegionSlot {
  return {
    index,
    occupied: true,
    hero: id,
    agentId: 100 + index,
    level: 20,
    professions: [1, 3],
    behaviour: 1,
    skills: [101, 102, 103, 104, 105, 106, 107, 108],
    disabled: 0,
    ...over,
  };
}

/** A party position holding nobody this walk could claim — a henchman, say. */
function vacant(index: number): RegionSlot {
  return {
    index,
    occupied: false,
    hero: null,
    agentId: null,
    level: null,
    professions: null,
    behaviour: null,
    skills: null,
    disabled: null,
  };
}

function party(slots: readonly RegionSlot[]) {
  return liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: true,
    heroCount: slots.filter((slot) => slot.occupied).length,
    firstHeroId: slots.find((slot) => slot.occupied)?.hero ?? 0,
    party: {
      status: "ready",
      rosterObserved: true,
      slotCount: slots.filter((slot) => slot.occupied).length,
      slots: [vacant(0), ...slots],
    },
  });
}

/** Ids that are stable across a run, so a failure names a slot and not a UUID. */
function counter(): (kind: "build" | "team") => string {
  let next = 0;
  return (kind) => `${kind}-${++next}`;
}

function libraryOf(capture: NonNullable<ReturnType<typeof captureParty>>): BuildLibrary {
  return {
    version: LIBRARY_VERSION,
    builds: capture.builds,
    teams: [capture.team],
    tags: [],
  };
}

// Every skill is a common one, legal on any profession's bar. The point is to
// leave `resolveTeamApplyPlan` judging what capture produced rather than a
// fixture skill table — an unknown skill id would fail this test for a reason
// that has nothing to do with capture.
const anySkill = () => ({
  profession: null,
  elite: false,
  availability: "pve" as const,
});

test("a captured team resolves through the same door every other team does", () => {
  const captured = captureParty(
    party([hero(1, 38), hero(2, 39), hero(3, 6)]),
    "Current party",
    counter(),
  );
  assert.ok(captured);

  const resolution = resolveTeamApplyPlan(
    captured.team,
    libraryOf(captured),
    // The real validator, not a `{ valid: true }` stub: the question is
    // whether a captured build is one the game would accept, and a stub
    // answers a different question.
    (build) => validateBuild(build, anySkill),
  );

  assert.equal(resolution.valid, true, resolution.valid ? "" : JSON.stringify(resolution.problems));
  assert.ok(resolution.valid);
  // Eight members: the player and seven positions, three of them heroes.
  assert.equal(resolution.plan.members.length, 4, "player plus three heroes");
  assert.equal(resolution.plan.members[0]?.hero, null, "slot 0 is the player");
  assert.equal(resolution.plan.members[1]?.build?.skills.length, 8);
});

test("heroes are compacted, because a henchman between two of them is a gap", () => {
  // Positions 1 and 3 in the game; a henchman is standing at 2. Preserving the
  // game's indices would put a hole in the team, and `party-gap` refuses that —
  // which would mean every mixed party captured a team that could never apply.
  const captured = captureParty(
    party([hero(1, 38), vacant(2), hero(3, 39)]),
    "Current party",
    counter(),
  );
  assert.ok(captured);

  assert.equal(captured.team.slots[1]?.hero, 38);
  assert.equal(captured.team.slots[2]?.hero, 39, "compacted, not left at 3");
  assert.equal(captured.team.slots[3]?.hero, null);

  const resolution = resolveTeamApplyPlan(
    captured.team,
    libraryOf(captured),
    (build) => validateBuild(build, anySkill),
  );
  assert.ok(resolution.valid);
});

test("the player's own slot stays empty, which is the only shape it may have", () => {
  const captured = captureParty(party([hero(1, 38)]), "Current party", counter());
  assert.ok(captured);

  const [player] = captured.team.slots;
  assert.equal(player?.hero, null);
  assert.equal(player?.build, null, "the player's own bar is not readable");
  assert.equal(player?.behaviour, null);
  assert.deepEqual(player?.disabled, []);
  assert.ok(
    captured.gaps.some((gap) => gap.includes("Your own build")),
    "and capture says so rather than leaving it to be noticed",
  );
});

test("a captured build carries no attributes and does not pretend otherwise", () => {
  const captured = captureParty(party([hero(1, 38)]), "Current party", counter());
  assert.ok(captured);

  const [build] = captured.builds;
  assert.ok(build);
  // `AttributeRanks` has no spelling for unknown — absent *is* rank zero — so
  // the prose is the only honest place, and it must not be silently dropped.
  assert.deepEqual(build.attributes, {});
  assert.match(build.notes, /attribute ranks were not read/iu);
  assert.equal(build.origin, CAPTURE_ORIGIN);
  assert.equal(build.parent, null);
  assert.equal(build.lastUsed, null);
  assert.equal(build.name, "Devona", "the display spelling, not the enum id");
});

test("a hero whose bar was not read keeps their place and gets no build", () => {
  const captured = captureParty(
    party([hero(1, 38), hero(2, 39, { skills: null, disabled: null })]),
    "Current party",
    counter(),
  );
  assert.ok(captured);

  assert.equal(captured.builds.length, 1, "one build, not two with one empty");
  assert.equal(captured.team.slots[2]?.hero, 39, "still in the team");
  assert.equal(captured.team.slots[2]?.build, null);
  assert.ok(captured.gaps.some((gap) => gap.startsWith("Ghost Of Althea")));

  const resolution = resolveTeamApplyPlan(
    captured.team,
    libraryOf(captured),
    (build) => validateBuild(build, anySkill),
  );
  assert.ok(resolution.valid, "a build-less hero is a legal team member");
});

test("disabled slots are dropped with the build they point at", () => {
  // Reachable: `disabled` rides the skillbar read and the professions come from
  // a different structure, so a bar can be read for a hero whose professions
  // were not. `disabled-without-build` refuses the pair, so capture must not
  // make it.
  const captured = captureParty(
    party([hero(1, 38, { professions: null, disabled: 0b0000_0101 })]),
    "Current party",
    counter(),
  );
  assert.ok(captured);

  assert.equal(captured.builds.length, 0);
  assert.deepEqual(captured.team.slots[1]?.disabled, []);

  const resolution = resolveTeamApplyPlan(
    captured.team,
    libraryOf(captured),
    (build) => validateBuild(build, anySkill),
  );
  assert.ok(resolution.valid);
});

test("disabled slots survive when the build they point at does", () => {
  const captured = captureParty(
    party([hero(1, 38, { disabled: 0b0000_0101 })]),
    "Current party",
    counter(),
  );
  assert.ok(captured);
  assert.deepEqual(captured.team.slots[1]?.disabled, [0, 2]);
});

test("behaviour is carried, never defaulted to Guard", () => {
  const read = captureParty(
    party([hero(1, 38, { behaviour: 2 })]),
    "Current party",
    counter(),
  );
  assert.equal(read?.team.slots[1]?.behaviour, "avoid");

  const unread = captureParty(
    party([hero(1, 38, { behaviour: null })]),
    "Current party",
    counter(),
  );
  assert.ok(unread);
  // Guard is a real setting somebody would act on, so an unread behaviour is
  // absent and the team is honestly incomplete until the player picks one.
  assert.equal(unread.team.slots[1]?.behaviour, null);
  assert.ok(unread.gaps.some((gap) => gap.includes("behaviour was not observed")));

  const resolution = resolveTeamApplyPlan(
    unread.team,
    libraryOf(unread),
    (build) => validateBuild(build, anySkill),
  );
  assert.equal(resolution.valid, false);
  assert.ok(
    !resolution.valid
      && resolution.problems.some(({ rule }) => rule === "missing-behaviour"),
    "and the existing rule is what says so, not a second one here",
  );
});

test("the mode is never said, because nobody read it", () => {
  const captured = captureParty(party([hero(1, 38)]), "Current party", counter());
  // `"normal"` would be a setting the player did not choose showing up as one
  // they did — and `"hard"` is refused by apply outright.
  assert.equal(captured?.team.mode, "none");
});

test("there is nothing to capture without a party, and capture says no", () => {
  assert.equal(captureParty(unavailableParty(), "Current party", counter()), null);
  assert.equal(
    captureParty(
      liveParty({ status: "ready", partyObserved: true, heroCount: 0 }),
      "Current party",
      counter(),
    ),
    null,
    "an observed empty party is still nothing to save",
  );
});

test("counted heroes nobody could name are reported, not quietly missing", () => {
  const captured = captureParty(
    liveParty({
      status: "ready",
      partyObserved: true,
      heroAvailable: true,
      heroCount: 3,
      firstHeroId: 38,
      firstHeroAgentId: 43,
    }),
    "Current party",
    counter(),
  );
  assert.ok(captured);

  assert.equal(captured.team.slots[1]?.hero, 38);
  assert.equal(captured.builds.length, 0, "the summary path publishes no bar");
  assert.ok(captured.gaps.some((gap) => gap.includes("2 more heroes")));
});

test("more heroes than a team has positions is refused for the surplus, not silently", () => {
  const slots = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => hero(index, index));
  const captured = captureParty(party(slots), "Current party", counter());
  assert.ok(captured);

  assert.equal(captured.builds.length, PARTY_SIZE - 1);
  assert.equal(captured.team.slots.filter((slot) => slot.hero !== null).length, PARTY_SIZE - 1);
  assert.ok(captured.gaps.some((gap) => gap.includes("hero positions")));
});

test("every gap is written into the team's notes, so the notice is not the record", () => {
  const captured = captureParty(
    party([hero(1, 38), hero(2, 39, { skills: null, disabled: null })]),
    "Current party",
    counter(),
  );
  assert.ok(captured);
  assert.ok(captured.gaps.length > 0);
  for (const gap of captured.gaps) {
    assert.ok(
      captured.team.notes.includes(gap),
      `the notes do not mention: ${gap}`,
    );
  }
});
