// Hub names a long apply with counted progress ("Applying GOM AFK… 5/16", HUB-083).
// The count is the runner's own evidence: a change counts once its confirmation
// landed, out of the changes the opening party needed. It never runs ahead of the
// work, and a refusal stops it where the work stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { runTeamApply, type TeamApplyEvent } from "../../src/shared/builds/team-apply-runner.ts";
import { heroId } from "../../src/shared/builds/library.ts";
import { plannedTeamApplyChanges } from "../../src/shared/builds/team-apply.ts";
import {
  applyBuild as build,
  applyHarness as harness,
  applyMember as member,
  applyParty as party,
  applyPlan as plan,
} from "./team-apply-fixture.ts";

const counts = (events: readonly TeamApplyEvent[]) => events.map((event) => `${event.changes?.done}/${event.changes?.planned}`);

test("a full apply counts up to exactly the changes the party needed", async () => {
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  const wanted = [{ hero: 6, agentId: 11, behaviour: 0, skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[] }];
  game.react("skills:11:1,2,3,4,5,6,7,8", wanted.map((slot) => ({ ...slot, behaviour: 1, attributes: [] })));
  game.react("attributes:11:17=7,19=12", wanted.map((slot) => ({ ...slot, behaviour: 1 })));
  game.react("behaviour:11:0", wanted);
  const events: TeamApplyEvent[] = [];
  const team = plan([member({ hero: heroId(6), behaviour: "fight", build: build() })]);
  assert.equal(plannedTeamApplyChanges(team, game.environment.party()), 3);
  const result = await runTeamApply(team, { ...game.environment, onEvent: (event) => events.push(event) }, 1);
  assert.equal(result.completedChanges, 3);
  assert.equal(counts(events)[0], "0/3", "the first command starts at zero of the planned changes");
  assert.equal(counts(events).at(-1), "3/3", "the last confirmation reaches the plan");
  assert.deepEqual(events.filter((event) => event.state === "confirmed").map((event) => event.changes?.done), [1, 2, 3]);
});

test("roster changes count one per removal and addition", async () => {
  const game = harness([{ hero: 7, agentId: 11, behaviour: 1, skills: null }]);
  game.react("kick:7", []);
  game.react("add:6", [{ hero: 6, agentId: 12, behaviour: 1, skills: null }]);
  const team = plan([member({ hero: heroId(6), behaviour: "guard" })]);
  const events: TeamApplyEvent[] = [];
  assert.equal(plannedTeamApplyChanges(team, party([{ hero: 7, agentId: 11, behaviour: 1, skills: null }])), 3,
    "an added hero's behaviour is not observed yet, so it counts");
  await runTeamApply(team, { ...game.environment, onEvent: (event) => events.push(event) }, 1);
  assert.equal(counts(events).at(-1), "2/3", "a planned change that proved unnecessary is never counted as done");
});

test("a refusal stops the count where the work stopped", async () => {
  const game = harness([{ hero: 7, agentId: 11, behaviour: 1, skills: null }]);
  game.react("kick:7", []);
  const events: TeamApplyEvent[] = [];
  await assert.rejects(runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]),
    { ...game.environment, onEvent: (event) => events.push(event) }, 1), /1 change was confirmed/);
  assert.equal(events.at(-1)?.state, "failed");
  assert.equal(events.at(-1)?.changes?.done, 1);
});

test("a party that already matches plans no change", () => {
  const team = plan([member({ hero: heroId(6), behaviour: "guard" })]);
  assert.equal(plannedTeamApplyChanges(team, party([{ hero: 6, agentId: 11, behaviour: 1, skills: null }])), 0);
});
