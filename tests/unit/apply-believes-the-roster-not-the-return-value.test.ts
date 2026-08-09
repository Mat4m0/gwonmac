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
import { preflightTeamApply } from "../../src/shared/builds/team-apply.ts";

type Slot = {
  hero: number;
  agentId: number;
  professions?: readonly number[] | null;
  behaviour: number | null;
  skills: readonly number[] | null;
  attributes?: readonly (readonly number[])[] | null;
};
type Player = Omit<Slot, "hero" | "behaviour">;

/** A published party, built the way the decoder publishes one. */
function party(
  slots: readonly Slot[],
  inOutpost: boolean | null = true,
  hardMode = false,
  player: Player | null = {
    agentId: 1,
    professions: [1, 2],
    skills: [0, 0, 0, 0, 0, 0, 0, 0],
    attributes: [],
  },
): LiveParty {
  return liveParty({
    status: "ready",
    partyObserved: true,
    heroAvailable: slots.length > 0,
    heroCount: slots.length,
    firstHeroId: slots[0]?.hero ?? 0,
    party: {
      status: "ready",
      rosterObserved: true,
      unlockObserved: true,
      unlocked: Array.from({ length: 39 }, (_, index) => index + 1),
      playRegion: "pve",
      hardMode,
      inOutpost,
      slotCount: slots.length,
      slots: [
        {
          index: 0, occupied: player !== null, hero: null,
          agentId: player?.agentId ?? null, level: player === null ? null : 20,
          professions: player?.professions ?? null, behaviour: null,
          skills: player?.skills ?? null, disabled: player === null ? null : 0,
          attributes: player?.attributes ?? null,
        },
        ...slots.map((slot, index) => ({
          index: index + 1,
          occupied: true,
          hero: slot.hero,
          agentId: slot.agentId,
          level: 20,
          professions: slot.professions === undefined
            ? [1, 2] as readonly number[]
            : slot.professions,
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
  let hardMode = false;
  let player: Player | null = {
    agentId: 1,
    professions: [1, 2],
    skills: [0, 0, 0, 0, 0, 0, 0, 0],
    attributes: [],
  };
  const agentFor = (hero: number) => world.find((slot) => slot.hero === hero)?.agentId ?? 0;
  const commands: TeamApplyCommands = {
    setHardMode: (enabled) => { sent.push(`hard:${enabled}`); },
    setPlayerSecondary: (profession) => {
      sent.push(`player-secondary:${player?.agentId ?? 0}:${profession}`);
    },
    setPlayerSkills: (skills) => {
      sent.push(`player-skills:${player?.agentId ?? 0}:${skills.join(",")}`);
    },
    setPlayerAttributes: (ranks) => {
      sent.push(`player-attributes:${player?.agentId ?? 0}:${ranks.map(([a, r]) => `${a}=${r}`).join(",")}`);
    },
    addHero: (heroId) => { sent.push(`add:${heroId}`); },
    kickHero: (heroId) => { sent.push(`kick:${heroId}`); },
    setHeroBehaviour: (heroId, behaviour) => {
      sent.push(`behaviour:${agentFor(heroId)}:${behaviour}`);
    },
    setHeroSecondary: (heroId, profession) => {
      sent.push(`secondary:${agentFor(heroId)}:${profession}`);
    },
    setHeroSkills: (heroId, skills) => {
      sent.push(`skills:${agentFor(heroId)}:${skills.join(",")}`);
    },
    setHeroAttributes: (heroId, ranks) => {
      sent.push(`attributes:${agentFor(heroId)}:${ranks.map(([a, r]) => `${a}=${r}`).join(",")}`);
    },
  };
  const environment: TeamApplyEnvironment = {
    commands,
    party: () => party(world, outpost, hardMode, player),
    settle: () => Promise.resolve(),
  };
  return {
    sent,
    environment,
    set(next: readonly Slot[]) { world = [...next]; },
    setHard(next: boolean) { hardMode = next; },
    setPlayer(next: Player | null) { player = next; },
    leave() { outpost = false; },
    /** Apply the change the next time the runner looks, as the game would. */
    react(when: string, next: readonly Slot[]) {
      const original = commands;
      const react = () => { if (sent.at(-1) === when) world = [...next]; };
      // Wrapping every command rather than the one named: the runner is free
      // to reach the reacting state through a different call than the test
      // expects, and a wrapper on one method would then never fire.
      const mutable = commands as unknown as Record<string, (...args: never[]) => void>;
      for (const key of Object.keys(original)) {
        const inner = mutable[key]!;
        mutable[key] = (...args: never[]) => {
          inner(...args);
          react();
        };
      }
    },
  };
}

function member(over: Partial<TeamApplyMember> = {}): TeamApplyMember {
  return { hero: null, build: null, behaviour: null, ...over };
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

test("Hard Mode is changed and confirmed before any team command", async () => {
  const game = harness([]);
  const original = game.environment.commands.setHardMode;
  game.environment.commands.setHardMode = (enabled) => {
    original(enabled);
    game.setHard(enabled);
  };
  const result = await runTeamApply(
    { mode: "hard", members: [member()] },
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, ["hard:true"]);
  assert.equal(result.completedChanges, 1);
});

test("the player's build is applied before hero work and confirmed field by field", async () => {
  const game = harness([]);
  game.setPlayer({
    agentId: 7,
    professions: [1, 3],
    skills: [90, 91, 92, 93, 94, 95, 96, 97],
    attributes: [],
  });
  const secondary = game.environment.commands.setPlayerSecondary;
  game.environment.commands.setPlayerSecondary = (profession) => {
    secondary(profession);
    game.setPlayer({
      agentId: 7, professions: [1, 2], skills: null, attributes: [],
    });
  };
  const skills = game.environment.commands.setPlayerSkills;
  game.environment.commands.setPlayerSkills = (ids) => {
    skills(ids);
    game.setPlayer({
      agentId: 7, professions: [1, 2], skills: ids, attributes: [],
    });
  };
  const attributes = game.environment.commands.setPlayerAttributes;
  game.environment.commands.setPlayerAttributes = (ranks) => {
    attributes(ranks);
    game.setPlayer({
      agentId: 7, professions: [1, 2],
      skills: [1, 2, 3, 4, 5, 6, 7, 8], attributes: ranks,
    });
  };

  const result = await runTeamApply(
    { mode: "normal", members: [member({ build: build() })] },
    game.environment,
    2,
  );
  assert.deepEqual(game.sent, [
    "player-secondary:7:2",
    "player-skills:7:1,2,3,4,5,6,7,8",
    "player-attributes:7:17=7,19=12",
  ]);
  assert.equal(result.completedChanges, 3);
});

test("a wrong player primary refuses before changing difficulty", async () => {
  const game = harness([]);
  game.setPlayer({
    agentId: 7,
    professions: [2, 1],
    skills: null,
    attributes: [],
  });
  await assert.rejects(
    runTeamApply(
      { mode: "hard", members: [member({ build: build() })] },
      game.environment,
      2,
    ),
    /assigned build is for W, but the observed primary is R/,
  );
  assert.deepEqual(game.sent, []);
});

test("missing player, partial roster and known-locked hero all send zero commands", async () => {
  for (const [observed, message] of [
    [party([], true, false, null), /own character has not been observed/],
    [{ ...party([]), partial: true }, /complete party roster/],
    [{
      ...party([]),
      accountHeroes: new Map([[heroId(6), {
        availability: "locked" as const,
        professions: ["W", "R"] as const,
      }]]),
    }, /Koss is not unlocked/],
  ] as const) {
    const game = harness([]);
    const environment = { ...game.environment, party: () => observed };
    await assert.rejects(
      runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), environment, 1),
      message,
    );
    assert.deepEqual(game.sent, []);
  }
});

test("an absent hero's known primary mismatch refuses before roster mutation", async () => {
  const game = harness([]);
  const observed = {
    ...party([]),
    accountHeroes: new Map([[heroId(6), {
      availability: "unlocked" as const,
      professions: ["R", "W"] as const,
    }]]),
  };
  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
      { ...game.environment, party: () => observed },
      1,
    ),
    /assigned build is for W, but the observed primary is R/,
  );
  assert.deepEqual(game.sent, []);
});

test("behavior-only work is part of the canonical preview", () => {
  const result = preflightTeamApply(
    plan([member({ hero: heroId(6), behaviour: "fight" })]),
    party([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]),
  );
  assert.equal(result.ready, true);
  assert.deepEqual(result.ready ? result.changes : [], [
    { kind: "behaviour", hero: heroId(6) },
  ]);
});

test("a hero the game never adds is a refusal, however cheerful the command", async () => {
  const game = harness([]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /adding Koss did not take effect/,
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
    /adding Koss did not take effect/,
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
  assert.equal(result.skippedSkills.length, 0);
  assert.deepEqual(game.sent, [
    "skills:11:1,2,3,4,5,6,7,8",
    "attributes:11:17=7,19=12",
    "behaviour:11:0",
  ], "no add, no kick, and no secondary: all three already matched");
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
    /Koss's attributes did not take effect/,
  );
  assert.deepEqual(game.sent.at(-1), "attributes:11:17=7,19=12");
});

test("an empty attribute plan clears the player's invested ranks", async () => {
  const game = harness([]);
  game.setPlayer({
    agentId: 7,
    professions: [1, 2],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7]],
  });
  const attributes = game.environment.commands.setPlayerAttributes;
  game.environment.commands.setPlayerAttributes = (ranks) => {
    attributes(ranks);
    game.setPlayer({
      agentId: 7,
      professions: [1, 2],
      skills: [1, 2, 3, 4, 5, 6, 7, 8],
      attributes: ranks,
    });
  };
  const empty = { ...build(), attributes: {} };

  const result = await runTeamApply(
    { mode: "none", members: [member({ build: empty })] },
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, ["player-attributes:7:"]);
  assert.equal(result.completedChanges, 1);
});

test("an empty attribute plan clears a hero's invested ranks", async () => {
  const initial = {
    hero: 6,
    agentId: 11,
    behaviour: 1,
    professions: [1, 2],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7]] as readonly (readonly number[])[],
  };
  const game = harness([initial]);
  game.react("attributes:11:", [{ ...initial, attributes: [] }]);
  const empty = { ...build(), attributes: {} };

  const result = await runTeamApply(
    plan([member({ hero: heroId(6), build: empty, behaviour: "guard" })]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, ["attributes:11:"]);
  assert.equal(result.completedChanges, 1);
});

// Changing the secondary resets the bar and the attribute lines that belonged
// to the old profession, so it has to happen before either of them. A run that
// wrote skills first would apply them and then throw them away.
test("a new secondary profession is set, and set before the bar", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  }]);
  game.react("secondary:11:2", [{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 2],
  }]);
  game.react("skills:11:1,2,3,4,5,6,7,8", [{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
  }]);
  game.react("attributes:11:17=7,19=12", [{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }]);

  const result = await runTeamApply(
    plan([member({ hero: heroId(6), build: build() })]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, [
    "secondary:11:2",
    "skills:11:1,2,3,4,5,6,7,8",
    "attributes:11:17=7,19=12",
  ]);
  assert.equal(result.completedChanges, 3);
});

test("a monoclass build clears the secondary rather than leaving it", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  }]);
  const monoclass = { ...build(), professions: ["W", null] } as ReturnType<typeof build>;
  game.react("secondary:11:0", [{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 0],
  }]);
  game.react("skills:11:1,2,3,4,5,6,7,8", [{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 0],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
  }]);
  game.react("attributes:11:17=7,19=12", [{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 0],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }]);
  await runTeamApply(plan([member({ hero: heroId(6), build: monoclass })]), game.environment, 1);
  assert.equal(game.sent[0], "secondary:11:0", "Profession::None is a real secondary");
});

test("a secondary the game never changes is a refusal, not a bar written anyway", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  }]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), build: build() })]), game.environment, 1),
    /Koss's secondary profession did not take effect/,
  );
  assert.deepEqual(game.sent, ["secondary:11:2"], "and the bar was never sent");
});

test("unobserved professions refuse before the first command", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: null,
  }]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), build: build() })]), game.environment, 1),
    /Koss's professions have not been observed yet/,
  );
  assert.deepEqual(game.sent, []);
});

test("a wrong primary profession refuses before changing difficulty", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [2, 1],
  }]);
  await assert.rejects(
    runTeamApply(
      { mode: "hard", members: [
        member(),
        member({ hero: heroId(6), build: build() }),
      ] },
      game.environment,
      1,
    ),
    /Koss's assigned build is for W, but the observed primary is R/,
  );
  assert.deepEqual(game.sent, []);
});

// The bug the panel showed: change a hero's secondary, send a bar with skills
// from the new profession, and the client equips the ones it will and leaves
// the rest alone. The bar then matches neither the request nor its previous
// state, and waiting for an exact match reported a partly-applied bar as
// "did not take effect" — with a change count of zero, which was also wrong.
test("a bar the game only partly equips is applied, and says what it dropped", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [90, 91, 92, 93, 94, 95, 96, 97],
  }]);
  // Four of the eight land; the other four keep what was there, which is what
  // the client does with a skill the account has not unlocked.
  const partial = [1, 2, 3, 4, 94, 95, 96, 97];
  game.react("skills:11:1,2,3,4,5,6,7,8", [{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2], skills: partial,
  }]);
  game.react("attributes:11:17=7,19=12", [{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2], skills: partial,
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }]);

  const result = await runTeamApply(
    plan([member({ hero: heroId(6), build: build() })]),
    game.environment,
    1,
  );
  assert.ok(result.skippedSkills.length > 0);
  // Named, so the panel can say which ones rather than "one or more".
  assert.deepEqual(result.skippedSkills, [5, 6, 7, 8]);
  assert.equal(result.completedChanges, 2, "the bar and the attributes");
});

test("skipped skill names accumulate across the whole team", async () => {
  const first = {
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [90, 91, 92, 93, 94, 95, 96, 97],
  };
  const second = {
    hero: 7, agentId: 12, behaviour: 1, professions: [1, 2],
    skills: [80, 81, 82, 83, 84, 85, 86, 87],
  };
  const game = harness([first, second]);
  const firstPartial = { ...first, skills: [1, 2, 3, 4, 94, 95, 96, 97] };
  game.react("skills:11:1,2,3,4,5,6,7,8", [firstPartial, second]);
  game.react("attributes:11:17=7,19=12", [{
    ...firstPartial,
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }, second]);
  const firstDone = {
    ...firstPartial,
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  };
  const secondPartial = { ...second, skills: [1, 2, 82, 83, 5, 6, 7, 8] };
  game.react("skills:12:1,2,3,4,5,6,7,8", [firstDone, secondPartial]);
  game.react("attributes:12:17=7,19=12", [firstDone, {
    ...secondPartial,
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }]);

  const result = await runTeamApply(
    plan([
      member({ hero: heroId(6), build: build() }),
      member({ hero: heroId(7), build: build() }),
    ]),
    game.environment,
    1,
  );
  assert.ok(result.skippedSkills.length > 0);
  assert.deepEqual(result.skippedSkills, [5, 6, 7, 8, 3, 4]);
});

test("a bar that never moves is still a refusal", async () => {
  // The partial case must not turn every failure into a success. A bar that
  // stays exactly as it was is a bar the game ignored.
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [90, 91, 92, 93, 94, 95, 96, 97],
  }]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), build: build() })]), game.environment, 1),
    /Koss's skill bar did not take effect/,
  );
});

test("a bar and ranks already in place send nothing at all", async () => {
  // The second Apply of the same team. Every step compares before it sends, so
  // a team already in place costs zero packets and reports zero changes.
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [1, 2, 3, 4, 5, 6, 7, 8],
    attributes: [[17, 7], [19, 12]] as readonly (readonly number[])[],
  }]);
  const result = await runTeamApply(
    plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
    game.environment,
    1,
  );
  assert.deepEqual(game.sent, []);
  assert.equal(result.completedChanges, 0);
  assert.equal(result.skippedSkills.length, 0);
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

test("a concurrent roster addition cannot turn into a false Apply success", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null,
  }]);
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
    /final party roster did not match the team/,
  );
  assert.deepEqual(game.sent, ["behaviour:11:0"]);
});

test("Devona refuses the whole Apply before another hero is removed", async () => {
  // `KickAllHeroes` is `kick(0x26)` and 0x26 is 38. One of those two meanings
  // is wrong on a build that has her and nobody has established which, so the
  // runner refuses rather than finding out during someone's apply.
  const game = harness([
    { hero: 7, agentId: 10, behaviour: 1, skills: null },
    { hero: 38, agentId: 11, behaviour: 1, skills: null },
  ]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /Devona cannot be removed safely/,
  );
  assert.deepEqual(game.sent, [], "and no packet was sent at all");
});

test("applying outside an outpost is refused before anything is sent", async () => {
  const outside = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }], false);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "fight" })]), outside.environment, 1),
    /Enter a PvE outpost/,
  );
  assert.deepEqual(outside.sent, []);

  // And "not observed" is its own answer, not a quiet yes.
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
  // The add is accepted and never arrives.
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /1 change were made before it stopped/,
  );
});
