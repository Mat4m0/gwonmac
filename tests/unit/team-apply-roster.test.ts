/** Observation-driven roster reconciliation and order invariants. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  runTeamApply,
  type TeamApplyEnvironment,
} from "../../src/shared/builds/team-apply-runner.ts";
import { liveParty } from "../../src/shared/builds/live-party.ts";
import { heroId } from "../../src/shared/builds/library.ts";
import {
  applyHarness as harness,
  applyMember as member,
  applyParty as party,
  applyPlan as plan,
} from "./team-apply-fixture.ts";

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
    /Enter a PvE outpost/,
  );
  assert.deepEqual(outside.sent, []);

  const unknown = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }], null);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "fight" })]), unknown.environment, 1),
    /Waiting to confirm that this is a PvE outpost/,
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
