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
} from "../../src/shared/builds/team-apply-runner.ts";
import { heroId, skillId } from "../../src/shared/builds/library.ts";
import type {
  TeamApplyMember,
} from "../../src/shared/builds/team-apply.ts";
import { preflightTeamApply } from "../../src/shared/builds/team-apply.ts";
import {
  applyBuild as build,
  applyHarness as harness,
  applyMember as member,
  applyParty as party,
  applyPlan as plan,
} from "./team-apply-fixture.ts";

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

test("a partial roster does not invent hero-specific verification failures", () => {
  const result = preflightTeamApply(
    plan([
      member({ hero: heroId(6), build: build(), behaviour: "guard" }),
      member({ hero: heroId(7), build: build(), behaviour: "fight" }),
    ]),
    { ...party([]), partial: true },
  );
  assert.equal(result.ready, false);
  assert.deepEqual(result.ready ? [] : result.blockers, [
    { rule: "partial-roster" },
  ]);
});

test("a rejected roster does not multiply into unknown region and mode failures", () => {
  const result = preflightTeamApply(
    plan([member({ hero: heroId(6), build: build() })]),
    {
      ...party([], true, false, null),
      partial: true,
      playRegion: "unknown",
      hardMode: null,
      inOutpost: null,
    },
  );
  assert.deepEqual(result.ready ? [] : result.blockers, [
    { rule: "partial-roster" },
  ]);
});

test("known permanent policy blockers outrank an incomplete roster", () => {
  const assigned = plan([member({ hero: heroId(6), build: build() })]);
  const partial = { ...party([]), partial: true };
  const pvp = preflightTeamApply(assigned, {
    ...partial,
    playRegion: "pvp",
  });
  assert.deepEqual(pvp.ready ? [] : pvp.blockers, [{ rule: "pvp" }]);

  const explorable = preflightTeamApply(assigned, {
    ...partial,
    inOutpost: false,
  });
  assert.deepEqual(explorable.ready ? [] : explorable.blockers, [
    { rule: "not-outpost" },
  ]);
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

test("a known-locked assigned skill refuses before the first command", async () => {
  const game = harness([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]);
  const assigned = {
    ...build(),
    skills: [skillId(350), skillId(351), null, null, null, null, null, null],
  } as NonNullable<TeamApplyMember["build"]>;
  const observed = {
    ...party([{ hero: 6, agentId: 11, behaviour: 1, skills: null }]),
    accountSkills: {
      knownThrough: 500,
      unlocked: new Set([skillId(349)]),
    },
  };

  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: assigned, behaviour: "guard" })]),
      { ...game.environment, party: () => observed },
      1,
    ),
    /Koss's assigned build uses skills 350, 351, which are not unlocked/,
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

test("roster order is a canonical Apply change", () => {
  const result = preflightTeamApply(
    plan([
      member({ hero: heroId(6), behaviour: "guard" }),
      member({ hero: heroId(7), behaviour: "guard" }),
    ]),
    party([
      { hero: 7, agentId: 11, behaviour: 1, skills: null },
      { hero: 6, agentId: 12, behaviour: 1, skills: null },
    ]),
  );
  assert.equal(result.ready, true);
  assert.deepEqual(result.ready ? result.changes : [], [
    { kind: "rebuild-roster" },
  ]);
});

test("canonical preflight reports each logical change once", () => {
  const result = preflightTeamApply(
    plan([member({ hero: heroId(6), build: build(), behaviour: "fight" })]),
    party([{
      hero: 6,
      agentId: 11,
      behaviour: 1,
      professions: [1, 2],
      skills: [90, 91, 92, 93, 94, 95, 96, 97],
    }]),
  );
  assert.equal(result.ready, true);
  const changes = result.ready ? result.changes : [];
  assert.equal(
    new Set(changes.map((change) => JSON.stringify(change))).size,
    changes.length,
  );
});

test("a hero the game never adds is a refusal, however cheerful the command", async () => {
  const game = harness([]);
  await assert.rejects(
    runTeamApply(plan([member({ hero: heroId(6), behaviour: "guard" })]), game.environment, 1),
    /Koss's addition did not take effect/,
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
    /Koss's addition did not take effect/,
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

test("a bar waits for the client's profession rebuild after confirmation", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  } as const;
  const changed = { ...initial, professions: [1, 2] as const };
  const game = harness([initial]);
  game.react("secondary:11:2", [changed]);
  const setSkills = game.environment.commands.setHeroSkills;
  game.environment.commands.setHeroSkills = (hero, skills) => {
    assert.ok(
      game.environment.confirmationTime!.now() >= 1_000,
      "the profession projection was published before its skill state was ready",
    );
    setSkills(hero, skills);
    game.set([{ ...changed, skills }]);
  };
  game.environment.commands.setHeroAttributes = () => {
    game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
      attributes: [[17, 7], [19, 12]],
    }]);
  };

  await runTeamApply(
    plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
    game.environment,
    1,
  );
});

test("a live secondary transition may exceed the ordinary command deadline", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  } as const;
  const changed = { ...initial, professions: [1, 2] as const };
  const game = harness([initial]);
  const events: { state: string; elapsedMs: number }[] = [];
  const observedParty = game.environment.party;
  let professionRequested = false;
  let professionPublished = false;
  const setSecondary = game.environment.commands.setHeroSecondary;
  game.environment.commands.setHeroSecondary = (hero, profession) => {
    setSecondary(hero, profession);
    professionRequested = true;
  };
  game.environment.party = () => {
    if (
      professionRequested
      && !professionPublished
      && game.environment.confirmationTime!.now() >= 12_000
    ) {
      professionPublished = true;
      game.set([changed]);
    }
    return observedParty();
  };
  game.environment.commands.setHeroSkills = (_hero, skills) => {
    assert.ok(game.environment.confirmationTime!.now() >= 13_000);
    game.set([{ ...changed, skills }]);
  };
  game.environment.commands.setHeroAttributes = () => {
    game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
      attributes: [[17, 7], [19, 12]],
    }]);
  };

  await runTeamApply(
    plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
    { ...game.environment, onEvent: (event) => events.push(event) },
    1,
  );
  assert.equal(
    game.sent.filter((command) => command === "secondary:11:2").length,
    2,
    "one retry is sent while the first command is still unobserved",
  );
  assert.deepEqual(
    events
      .filter((event) => event.state === "retrying")
      .map(({ state, elapsedMs }) => ({ state, elapsedMs })),
    [{ state: "retrying", elapsedMs: 3_000 }],
  );
});

test("a profession first published on the deadline receives its stability grace", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  } as const;
  const changed = { ...initial, professions: [1, 2] as const };
  const game = harness([initial]);
  const observedParty = game.environment.party;
  let requested = false;
  let skillsApplied = false;
  let attributesApplied = false;
  game.environment.commands.setHeroSecondary = () => { requested = true; };
  game.environment.party = () => {
    const now = game.environment.confirmationTime!.now();
    if (attributesApplied) game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
      attributes: [[17, 7], [19, 12]],
    }]);
    else if (skillsApplied) game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
    }]);
    else if (requested && now >= 15_000) game.set([changed]);
    return observedParty();
  };
  game.environment.commands.setHeroSkills = (_hero, skills) => {
    assert.ok(game.environment.confirmationTime!.now() >= 16_000);
    skillsApplied = true;
    game.set([{ ...changed, skills }]);
  };
  game.environment.commands.setHeroAttributes = () => {
    attributesApplied = true;
    game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
      attributes: [[17, 7], [19, 12]],
    }]);
  };

  await runTeamApply(
    plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
    game.environment,
    1,
  );
});

test("a deadline candidate that disappears is refused without extending the operation", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  } as const;
  const changed = { ...initial, professions: [1, 2] as const };
  const game = harness([initial]);
  const observedParty = game.environment.party;
  game.environment.commands.setHeroSecondary = () => {};
  game.environment.party = () => {
    const now = game.environment.confirmationTime!.now();
    game.set(now >= 15_000 && now < 15_500 ? [changed] : [initial]);
    return observedParty();
  };

  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
      game.environment,
      1,
    ),
    /Koss's secondary profession did not take effect/,
  );
  assert.equal(
    game.sent.some((command) => command.startsWith("skills:")),
    false,
  );
});

test("a profession must remain observed for a full stable interval", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  } as const;
  const changed = { ...initial, professions: [1, 2] as const };
  const game = harness([initial]);
  const baseParty = game.environment.party;
  let requested = false;
  let skillsApplied = false;
  let attributesApplied = false;
  game.environment.commands.setHeroSecondary = () => { requested = true; };
  game.environment.party = () => {
    const now = game.environment.confirmationTime!.now();
    if (attributesApplied) game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
      attributes: [[17, 7], [19, 12]],
    }]);
    else if (skillsApplied) game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
    }]);
    else if (requested && ((now >= 100 && now < 500) || now >= 700)) game.set([changed]);
    else game.set([initial]);
    return baseParty();
  };
  game.environment.commands.setHeroSkills = (_hero, skills) => {
    assert.ok(game.environment.confirmationTime!.now() >= 1_700);
    skillsApplied = true;
    game.set([{ ...changed, skills }]);
  };
  game.environment.commands.setHeroAttributes = () => {
    attributesApplied = true;
    game.set([{
      ...changed,
      skills: build().skills.map((skill) => skill ?? 0),
      attributes: [[17, 7], [19, 12]],
    }]);
  };

  await runTeamApply(
    plan([member({ hero: heroId(6), build: build(), behaviour: "guard" })]),
    game.environment,
    1,
  );
});

test("cancelling during confirmation sends no dependent command", async () => {
  const game = harness([{
    hero: 6, agentId: 11, behaviour: 1, skills: null, professions: [1, 3],
  }]);
  const operation = new AbortController();
  const secondary = game.environment.commands.setHeroSecondary;
  game.environment.commands.setHeroSecondary = (hero, profession) => {
    secondary(hero, profession);
    operation.abort();
  };

  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build() })]),
      { ...game.environment, signal: operation.signal },
      1,
    ),
    (cause: unknown) => cause instanceof Error && cause.name === "AbortError",
  );
  assert.deepEqual(game.sent, ["secondary:11:2"]);
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
  const events: { state: string; elapsedMs: number }[] = [];
  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build() })]),
      { ...game.environment, onEvent: (event) => events.push(event) },
      1,
    ),
    /Koss's secondary profession did not take effect/,
  );
  assert.deepEqual(
    game.sent,
    ["secondary:11:2", "secondary:11:2"],
    "one profession retry is sent, and the bar is never sent",
  );
  assert.deepEqual(
    events
      .filter((event) => event.state === "retrying")
      .map(({ state, elapsedMs }) => ({ state, elapsedMs })),
    [{ state: "retrying", elapsedMs: 3_000 }],
  );
  assert.deepEqual(
    events
      .filter((event) => event.state === "failed")
      .map(({ state, elapsedMs }) => ({ state, elapsedMs })),
    [{ state: "failed", elapsedMs: 15_000 }],
  );
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

test("a progressively published bar is not mistaken for a stable partial bar", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [90, 91, 92, 93, 94, 95, 96, 97],
  } as const;
  const game = harness([initial]);
  const baseParty = game.environment.party;
  let requested = false;
  let attributesApplied = false;
  game.environment.commands.setHeroSkills = () => { requested = true; };
  game.environment.party = () => {
    const now = game.environment.confirmationTime!.now();
    if (attributesApplied) {
      game.set([{
        ...initial,
        skills: [1, 2, 3, 4, 5, 6, 7, 8],
        attributes: [[17, 7], [19, 12]],
      }]);
    } else if (requested && now >= 500) {
      game.set([{ ...initial, skills: [1, 2, 3, 4, 5, 6, 7, 8] }]);
    } else if (requested && now >= 250) {
      game.set([{ ...initial, skills: [1, 2, 3, 4, 94, 95, 96, 97] }]);
    } else if (requested && now >= 100) {
      game.set([{ ...initial, skills: [1, 2, 92, 93, 94, 95, 96, 97] }]);
    }
    return baseParty();
  };
  game.environment.commands.setHeroAttributes = () => {
    attributesApplied = true;
    game.set([{
      ...initial,
      skills: [1, 2, 3, 4, 5, 6, 7, 8],
      attributes: [[17, 7], [19, 12]],
    }]);
  };

  const result = await runTeamApply(
    plan([member({ hero: heroId(6), build: build() })]),
    game.environment,
    1,
  );
  assert.deepEqual(result.skippedSkills, []);
});

test("an omitted reportedly unlocked skill is an inconsistency, not a skip", async () => {
  const initial = {
    hero: 6, agentId: 11, behaviour: 1, professions: [1, 2],
    skills: [90, 91, 92, 93, 94, 95, 96, 97],
  } as const;
  const partial = { ...initial, skills: [1, 2, 3, 4, 5, 6, 0, 8] };
  const game = harness([initial]);
  game.react("skills:11:1,2,3,4,5,6,7,8", [partial]);
  const baseParty = game.environment.party;
  game.environment.party = () => ({
    ...baseParty(),
    accountSkills: {
      knownThrough: 100,
      unlocked: new Set(Array.from({ length: 8 }, (_, index) => skillId(index + 1))),
    },
  });

  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build() })]),
      game.environment,
      1,
    ),
    /omitted reportedly unlocked skill 7 from slot 7/,
  );
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
  const events: { state: string; elapsedMs: number }[] = [];
  await assert.rejects(
    runTeamApply(
      plan([member({ hero: heroId(6), build: build() })]),
      { ...game.environment, onEvent: (event) => events.push(event) },
      1,
    ),
    /Koss's skill bar did not take effect/,
  );
  assert.deepEqual(game.sent, [
    "skills:11:1,2,3,4,5,6,7,8",
    "skills:11:1,2,3,4,5,6,7,8",
  ], "the safe skill-bar retry is sent exactly once");
  assert.deepEqual(
    events
      .filter((event) => event.state === "retrying")
      .map(({ state, elapsedMs }) => ({ state, elapsedMs })),
    [{ state: "retrying", elapsedMs: 750 }],
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
