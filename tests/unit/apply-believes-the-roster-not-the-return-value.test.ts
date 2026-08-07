// The commands this runner drives are client-to-server packets. Every one of
// them returns "the packet was built and handed to the sender" and nothing
// more — not that the server agreed, not that anything changed. GWCAjs records
// the exact trap: `MsgSendLeave` returned normally without leaving the party.
//
// So these tests do the one thing that matters: they let every command succeed
// while the roster refuses to move, and assert the runner does not believe it.
// A fixture whose commands and roster always agree would pass whether or not
// the runner read anything at all.
import test from "node:test";
import assert from "node:assert/strict";
import {
  runTeamApply,
  type TeamApplyCommands,
  type TeamApplyEnvironment,
} from "../../src/shared/builds/team-apply-runner.ts";
import {
  liveParty,
  type LiveParty,
} from "../../src/shared/builds/live-party.ts";
import { heroId, skillId } from "../../src/shared/builds/library.ts";
import type {
  TeamApplyMember,
  TeamApplyPlan,
} from "../../src/shared/builds/team-apply.ts";

type Slot = {
  hero: number;
  agentId: number;
  behaviour: number | null;
  skills: readonly number[] | null;
  attributes?: readonly (readonly number[])[] | null;
};

/** A published party, built the way the decoder publishes one. */
function party(slots: readonly Slot[], inOutpost: boolean | null = true): LiveParty {
  return liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: slots.length > 0,
    heroCount: slots.length,
    firstHeroId: slots[0]?.hero ?? 0,
    party: {
      status: "ready",
      rosterObserved: true,
      inOutpost,
      slotCount: slots.length,
      slots: [
        {
          index: 0, occupied: false, hero: null, agentId: null, level: null,
          professions: null, behaviour: null, skills: null, disabled: null,
          attributes: null,
        },
        ...slots.map((slot, index) => ({
          index: index + 1,
          occupied: true,
          hero: slot.hero,
          agentId: slot.agentId,
          level: 20,
          professions: [1, 2] as readonly number[],
          behaviour: slot.behaviour,
          skills: slot.skills,
          disabled: 0,
          attributes: slot.attributes ?? [],
        })),
      ],
    },
  });
}

/**
 * A game that accepts every packet and changes only when `world` is rewritten.
 *
 * The separation is the point: `sent` records what was asked for, `world`
 * records what is true, and nothing links them unless a test says so.
 */
function harness(initial: readonly Slot[], inOutpost: boolean | null = true) {
  const sent: string[] = [];
  let world = [...initial];
  let outpost = inOutpost;
  const commands: TeamApplyCommands = {
    addHero: (heroId) => { sent.push(`add:${heroId}`); return true; },
    kickHero: (heroId) => { sent.push(`kick:${heroId}`); return true; },
    setHeroBehaviour: (agentId, behaviour) => {
      sent.push(`behaviour:${agentId}:${behaviour}`); return true;
    },
    setHeroSkills: (agentId, skills) => {
      sent.push(`skills:${agentId}:${skills.join(",")}`); return true;
    },
    setHeroAttributes: (agentId, ranks) => {
      sent.push(`attributes:${agentId}:${ranks.map(([a, r]) => `${a}=${r}`).join(",")}`);
      return true;
    },
  };
  const environment: TeamApplyEnvironment = {
    commands,
    party: () => party(world, outpost),
    settle: () => Promise.resolve(),
  };
  return {
    sent,
    environment,
    set(next: readonly Slot[]) { world = [...next]; },
    leave() { outpost = false; },
    /** Apply the change the next time the runner looks, as the game would. */
    react(when: string, next: readonly Slot[]) {
      const original = commands;
      const react = () => { if (sent.at(-1) === when) world = [...next]; };
      // Wrapping every command rather than the one named: the runner is free
      // to reach the reacting state through a different call than the test
      // expects, and a wrapper on one method would then never fire.
      const mutable = commands as unknown as Record<string, (...args: never[]) => boolean>;
      for (const key of Object.keys(original)) {
        const inner = mutable[key]!;
        mutable[key] = (...args: never[]) => {
          const result = inner(...args);
          react();
          return result;
        };
      }
    },
  };
}

function member(over: Partial<TeamApplyMember> = {}): TeamApplyMember {
  return { hero: null, build: null, behaviour: null, disabled: [], ...over };
}

function plan(members: readonly TeamApplyMember[]): TeamApplyPlan {
  return { mode: "none", members: [member(), ...members] };
}

/** A build whose bar and ranks are the ones the assertions below expect. */
function build() {
  return {
    professions: ["W", "R"] as const,
    attributes: { Strength: 7, HammerMastery: 12 },
    skills: [
      skillId(1), skillId(2), skillId(3), skillId(4),
      skillId(5), skillId(6), skillId(7), skillId(8),
    ],
  } as unknown as NonNullable<TeamApplyMember["build"]>;
}

test("a hero the game never adds is a refusal, however cheerful the command", async () => {
  const game = harness([]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /adding hero 6 did not take effect/,
  );
  assert.deepEqual(game.sent, ["add:6"], "and it did not go on to the next step");
});

test("a hero that appears without an agent id is not yet added", async () => {
  // The roster carries the hero before the instance has given it an agent, and
  // every command after this one is keyed by that agent. Treating the identity
  // alone as arrival is how a skill bar gets sent to agent zero.
  const game = harness([]);
  game.react("add:6", [{ hero: 6, agentId: 0, behaviour: null, skills: null }]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6) })]), game.environment, 1),
    /adding hero 6 did not take effect/,
  );
});

test("a full apply reports only the changes the roster confirmed", async () => {
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  const wanted = [{
    hero: 6,
    agentId: 11,
    behaviour: 0,
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }];
  game.react("skills:11:1,2,3,4,5,6,7,8",
    wanted.map((slot) => ({ ...slot, behaviour: 1, attributes: [] })));
  game.react("attributes:11:17=7,19=12",
    wanted.map((slot) => ({ ...slot, behaviour: 1 })));
  game.react("behaviour:11:0", wanted);

  const result = await runTeamApply(
    plan([member({ hero: heroId(6), behaviour: "fight", build: build() })]),
    game.environment,
    7,
  );

  assert.equal(result.commandId, 7);
  assert.equal(result.skillsSkipped, false);
  assert.deepEqual(game.sent, [
    "skills:11:1,2,3,4,5,6,7,8",
    "attributes:11:17=7,19=12",
    "behaviour:11:0",
  ], "no add and no kick: the hero was already there");
  // Bar, attributes, behaviour. The hero itself was not a change.
  assert.equal(result.completedChanges, 3);
});

// Attributes are published per hero, so they are confirmed like everything
// else. The runner used to count this step the moment the packet went out --
// a comment that had gone stale when the region grew the field.
test("attributes the game never applies are a refusal too", async () => {
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  game.react("skills:11:1,2,3,4,5,6,7,8", [{
    hero: 6, agentId: 11, behaviour: 1, skills: [1, 2, 3, 4, 5, 6, 7, 8],
  }]);
  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build() })]),
      game.environment,
      1,
    ),
    /the attributes of hero 6 did not take effect/,
  );
  assert.deepEqual(game.sent.at(-1), "attributes:11:17=7,19=12");
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
  // A full party has no room, so the order is not cosmetic.
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

test("Devona is never kicked, because the client's kick-all is her id", async () => {
  // `KickAllHeroes` is `kick(0x26)` and 0x26 is 38. One of those two meanings
  // is wrong on a build that has her and nobody has established which, so the
  // runner refuses rather than finding out during someone's apply.
  const game = harness([{ hero: 38, agentId: 11, behaviour: 1, skills: null }]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /Devona shares her hero id/,
  );
  assert.deepEqual(game.sent, [], "and no packet was sent at all");
});

test("applying outside an outpost is refused before anything is sent", async () => {
  const outside = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }], false);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "fight" })]), outside.environment, 1),
    /only be applied in an outpost/,
  );
  assert.deepEqual(outside.sent, []);

  // And "not observed" is its own answer, not a quiet yes.
  const unknown = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }], null);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "fight" })]), unknown.environment, 1),
    /has not been observed/,
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
  // The add is accepted and never arrives.
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /1 change were made before it stopped/,
  );
});
