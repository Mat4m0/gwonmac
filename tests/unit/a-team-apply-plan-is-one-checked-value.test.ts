import assert from "node:assert/strict";
import test from "node:test";
import {
  buildId,
  heroId,
  teamId,
  type Build,
  type BuildLibrary,
  type Team,
  type TeamSlot,
  type TeamSlots,
} from "../../src/shared/builds/library.js";
import {
  resolveTeamApplyPlan,
  type TeamApplyProblem,
} from "../../src/shared/builds/team-apply.js";

const build: Build = {
  id: buildId("devona"),
  name: "Devona",
  professions: ["W", null],
  attributes: { Strength: 8 },
  skills: [null, null, null, null, null, null, null, null],
  tags: [],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: null,
  origin: null,
};

const library: BuildLibrary = {
  version: 2,
  builds: [build],
  teams: [],
  tags: [],
};

const player = (ref: Build["id"] | null = null): TeamSlot => ({
  build: ref,
  hero: null,
  behaviour: null,
  panel: false,
  disabled: [],
});
const hero = (
  id: number,
  ref: Build["id"] | null = null,
): TeamSlot => ({
  build: ref,
  hero: heroId(id),
  behaviour: "guard",
  panel: false,
  disabled: [],
});
const empty: TeamSlot = {
  build: null,
  hero: null,
  behaviour: "guard",
  panel: false,
  disabled: [],
};
const team = (slots: TeamSlots): Team => ({
  id: teamId("team"),
  name: "Team",
  tags: [],
  mode: "none",
  favourite: false,
  lastUsed: null,
  notes: "",
  slots,
});
const valid = () => ({ valid: true } as const);
const rules = (
  result: ReturnType<typeof resolveTeamApplyPlan>,
): TeamApplyProblem["rule"][] =>
  result.valid ? [] : result.problems.map((problem) => problem.rule);

test("a team plan resolves references once and is never another stored model", () => {
  const source = team([
    player(build.id),
    hero(38, build.id),
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
  ]);
  const result = resolveTeamApplyPlan(source, library, valid);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.plan, {
    mode: "none",
    members: [
      {
        hero: null,
        build,
        behaviour: null,
        panel: false,
        disabled: [],
      },
      {
        hero: heroId(38),
        build,
        behaviour: "guard",
        panel: false,
        disabled: [],
      },
    ],
  });
  assert.notEqual(result.plan.members[0]?.build, source.slots[0].build);
});

test("duplicates, gaps, and malformed player state cannot construct a command", () => {
  const malformedPlayer = {
    ...player(),
    behaviour: "fight" as const,
  };
  const result = resolveTeamApplyPlan(
    team([
      malformedPlayer,
      hero(38),
      empty,
      hero(38),
      empty,
      empty,
      empty,
      empty,
    ]),
    library,
    valid,
  );
  assert.deepEqual(rules(result), [
    "player-slot",
    "party-gap",
    "duplicate-hero",
  ]);
});

test("assignment validation is part of resolving the immutable plan", () => {
  const result = resolveTeamApplyPlan(
    team([
      player(),
      hero(38, build.id),
      empty,
      empty,
      empty,
      empty,
      empty,
      empty,
    ]),
    library,
    () => ({
      valid: false,
      problems: [{ rule: "secondary-repeats-primary", profession: "W" }],
    }),
  );
  assert.deepEqual(rules(result), ["invalid-build"]);
});

test("dangling build references fail closed instead of becoming empty builds", () => {
  const missing = buildId("missing");
  const result = resolveTeamApplyPlan(
    team([
      player(missing),
      hero(38, missing),
      empty,
      empty,
      empty,
      empty,
      empty,
      empty,
    ]),
    library,
    valid,
  );
  assert.deepEqual(rules(result), ["invalid-build", "invalid-build"]);
});
