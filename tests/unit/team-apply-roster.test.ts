/** Observation-driven roster reconciliation and order invariants. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  runTeamApply,
  TeamApplyPreflightRefusal,
  type TeamApplyEnvironment,
} from "../../src/shared/builds/team-apply-runner.ts";
import { liveParty } from "../../src/shared/builds/live-party.ts";
import { heroId } from "../../src/shared/builds/library.ts";
import type { TeamApplyRuntimeProblem } from "../../src/shared/builds/team-apply.ts";
import {
  applyHarness as harness,
  applyMember as member,
  applyParty as party,
  applyPlan as plan,
} from "./team-apply-fixture.ts";

test("primary-mismatch facts carry exact professions", () => {
  const problem: TeamApplyRuntimeProblem = {
    rule: "primary-mismatch",
    hero: null,
    observed: "W",
    // @ts-expect-error presentation text is not a profession fact.
    wanted: "Warrior",
  };
  assert.equal(problem.rule, "primary-mismatch");
});

test("a behaviour already set is not sent again", async () => {
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  const result = await runTeamApply(
    plan([member({ hero: heroId(6), behaviour: "guard" })]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, [], "nothing needed doing");
  assert.equal(result.completedChanges, 0);
});

test("heroes that are not in the team leave before the ones that are arrive", async () => {
  const game = harness([{ hero: 7, agentId: 11, behaviour: 1, skills: null }]);
  game.react("kick:7", []);
  game.react("add:6", [{ hero: 6, agentId: 12, behaviour: 1, skills: null }]);
  const result = await runTeamApply(
    plan([member({ hero: heroId(6), behaviour: "guard" })]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, ["kick:7", "add:6"]);
  assert.equal(result.completedChanges, 2);
});

test("a changed hero order rebuilds the roster in the saved order", async () => {
  const game = harness([
    { hero: 6, agentId: 11, behaviour: 1, skills: null },
    { hero: 7, agentId: 12, behaviour: 1, skills: null },
  ]);
  game.react("kick:6", [{ hero: 7, agentId: 12, behaviour: 1, skills: null }]);
  game.react("kick:7", []);
  game.react("add:7", [{ hero: 7, agentId: 21, behaviour: 1, skills: null }]);
  game.react("add:6", [
    { hero: 7, agentId: 21, behaviour: 1, skills: null },
    { hero: 6, agentId: 22, behaviour: 1, skills: null },
  ]);

  const result = await runTeamApply(
    plan([
      member({ hero: heroId(7), behaviour: "guard" }),
      member({ hero: heroId(6), behaviour: "guard" }),
    ]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, ["kick:6", "kick:7", "add:7", "add:6"]);
  assert.equal(result.completedChanges, 4);
});

test("a roster rebuild adds nobody until each removal is confirmed", async () => {
  const game = harness([
    { hero: 6, agentId: 11, behaviour: 1, skills: null },
    { hero: 7, agentId: 12, behaviour: 1, skills: null },
  ]);
  await assert.rejects(
    runTeamApply(
      plan([
        member({ hero: heroId(7), behaviour: "guard" }),
        member({ hero: heroId(6), behaviour: "guard" }),
      ]),
      game.environment,
      1,
    ),
    /Koss's removal did not take effect/,
  );
  assert.deepEqual(game.sent, ["kick:6"]);
});

test("a concurrent roster addition cannot turn into a false Apply success", async () => {
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  const original = game.environment.commands.setHeroBehaviour;
  game.environment.commands.setHeroBehaviour = (hero, behaviour) => {
    original(hero, behaviour);
    game.set([
      { hero: 6, agentId: 11, behaviour: 0, skills: null },
      { hero: 7, agentId: 12, behaviour: 1, skills: null },
    ]);
  };
  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), behaviour: "fight" })]),
      game.environment,
      1,
    ),
    /final party order did not match the team/,
  );
  assert.deepEqual(game.sent, ["behaviour:11:0"]);
});

test("Devona is removed through the current build's observed hero-id command", async () => {
  const game = harness([
    { hero: 7, agentId: 10, behaviour: 1, skills: null },
    { hero: 38, agentId: 11, behaviour: 1, skills: null },
  ]);
  game.react("kick:7", [{ hero: 38, agentId: 11, behaviour: 1, skills: null }]);
  game.react("kick:38", []);
  game.react("add:6", [{ hero: 6, agentId: 12, behaviour: 1, skills: null }]);
  const result = await runTeamApply(
    plan([member({ hero: heroId(6), behaviour: "guard" })]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, ["kick:7", "kick:38", "add:6"]);
  assert.equal(result.completedChanges, 3);
});

test("applying outside an outpost is refused before anything is sent", async () => {
  const outside = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }], false);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "fight" })]), outside.environment, 1),
    (error: unknown) => {
      assert.ok(error instanceof TeamApplyPreflightRefusal);
      assert.deepEqual(error.problem, { rule: "not-outpost" });
      return true;
    },
  );
  assert.deepEqual(outside.sent, []);

  const unknown = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }], null);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "fight" })]), unknown.environment, 1),
    (error: unknown) => {
      assert.ok(error instanceof TeamApplyPreflightRefusal);
      assert.deepEqual(error.problem, { rule: "outpost-unknown" });
      return true;
    },
  );
  assert.deepEqual(unknown.sent, []);
});

test("a party that stops publishing mid-apply stops the apply", async () => {
  const game = harness([]);
  const environment: TeamApplyEnvironment = {
    ...game.environment,
    party: (() => {
      let calls = 0;
      return () => (calls++ === 0
        ? party([], true)
        : liveParty({ status: "waiting" }));
    })(),
  };
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6) })]), environment, 1),
    /stopped publishing a party/,
  );
});

test("the count in a refusal is the work that landed, not the work attempted", async () => {
  const game = harness([{ hero: 7, agentId: 11, behaviour: 1, skills: null }]);
  game.react("kick:7", []);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /1 change was confirmed before Apply stopped/,
  );
});

test('loading one player build never reconciles heroes or changes difficulty', async () => {
  const { runBuildApply } = await import('../../src/shared/builds/team-apply-runner.ts');
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  const { skillBarOf } = await import('../../src/shared/builds/library.ts');
  await runBuildApply({ professions: ['W', 'R'], skills: skillBarOf(() => null), attributes: {} }, null, game.environment, 9);
  assert.deepEqual(game.sent, []);
});

test('loading one hero build preserves the rest of the party', async () => {
  const { runBuildApply } = await import('../../src/shared/builds/team-apply-runner.ts');
  const { skillBarOf } = await import('../../src/shared/builds/library.ts');
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: [0,0,0,0,0,0,0,0] }, { hero: 7, agentId: 12, behaviour: 1, skills: null }]);
  game.setHard(true);
  await runBuildApply({ professions: ['W', 'R'], skills: skillBarOf(() => null), attributes: {} }, heroId(6), game.environment, 10);
  assert.deepEqual(game.sent, []);
  assert.equal(game.environment.party().hardMode, true);
  assert.equal(game.environment.party().heroes.length, 2);
});

test('a replaced build target is refused before commands are submitted', async () => {
  const { runBuildApply } = await import('../../src/shared/builds/team-apply-runner.ts');
  const { skillBarOf } = await import('../../src/shared/builds/library.ts');
  const game = harness([]);
  let reads = 0;
  const environment = { ...game.environment, party() {
    if (++reads > 1) game.setPlayer({ agentId: 2, professions: [1,2], skills: null, attributes: [] });
    return game.environment.party();
  } };
  await assert.rejects(runBuildApply({ professions: ['W', 'R'], skills: skillBarOf(() => null), attributes: {} }, null, environment, 11), /target changed/);
  assert.deepEqual(game.sent, []);
});
