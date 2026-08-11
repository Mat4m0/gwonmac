// `src/shared/builds/library.ts` claims two things that no amount of runtime
// checking would give you, and one that runtime checking is exactly right for.
// This file proves all three, because the shapes are about to carry the whole
// hero-builds feature and several other modules are written against them.
//
// The two compile-time claims are asserted with `@ts-expect-error`, which is a
// real assertion: it *fails* when the line it guards type-checks. Node strips
// types and never sees them, so the normal unit and typecheck gates are both
// required: the former executes behavior and the latter executes these type
// assertions against the production contracts.
//
//   1. A skill bar is a fixed-length tuple. A nine-slot bar is not a build with
//      a small mistake in it; it is not a build, and it must not be spellable.
//   2. A team slot holds a `BuildId`, never a `Build`. That is the load-bearing
//      half of the reference model: if a slot could carry a build, two teams
//      sharing one build would quietly become two teams with two copies, and
//      forking, the "used in N teams" banner and merge-back would all be
//      describing a relationship that no longer exists.
//
// The runtime claim is lineage. The fixture below is deliberately awkward: it
// holds a root with two variants, a variant whose parent has been deleted, a
// build no team uses, and a team that points at the same build from two slots.
// Those are the states the library actually reaches — deleting a parent
// promotes its variants rather than cascading, so a dangling `parent` is normal
// — and each one is a way the three helpers could answer plausibly and wrongly.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  Build,
  BuildLibrary,
  HeroBehaviour,
  SkillBar,
  SkillId,
  Team,
  TeamSlot,
  TeamSlots,
} from "../../src/shared/builds/library.ts";
import {
  LIBRARY_VERSION,
  SKILL_SLOTS,
  buildById,
  buildId,
  forkParentOf,
  heroId,
  parentOf,
  skillId,
  teamId,
  usedBy,
  variantsOf,
} from "../../src/shared/builds/library.ts";

/** Written out rather than mapped so the fixture helpers need no casts. */
type Eight<T> = readonly [T, T, T, T, T, T, T, T];

const bar = (ids: Eight<number | null>): SkillBar => {
  const one = (id: number | null) => (id === null ? null : skillId(id));
  return [
    one(ids[0]),
    one(ids[1]),
    one(ids[2]),
    one(ids[3]),
    one(ids[4]),
    one(ids[5]),
    one(ids[6]),
    one(ids[7]),
  ];
};

const build = (id: string, name: string, parent: string | null): Build => ({
  id: buildId(id),
  name,
  professions: ["N", "Rt"],
  skills: bar([0, 1, 2, 3, 4, 5, 6, 7]),
  attributes: { DeathMagic: 12, SoulReaping: 10, RestorationMagic: 8 },
  tags: ["hero", "discord"],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: parent === null ? null : buildId(parent),
  origin: null,
});

const player = (ref: string | null): TeamSlot => ({
  build: ref === null ? null : buildId(ref),
  hero: null,
  behaviour: null,
});

const hero = (
  ref: string | null,
  id: number,
  behaviour: HeroBehaviour = "guard",
): TeamSlot => ({
  build: ref === null ? null : buildId(ref),
  hero: heroId(id),
  behaviour,
});

const vacant: TeamSlot = {
  build: null,
  hero: null,
  behaviour: "guard",
};

const team = (id: string, name: string, slots: TeamSlots): Team => ({
  id: teamId(id),
  name,
  tags: ["vanquish"],
  mode: "hard",
  favourite: false,
  lastUsed: null,
  notes: "",
  slots,
});

const DISCORD = buildId("b_discord");
const DISCORD_ROT = buildId("b_discord2");
const DISCORD_HM = buildId("b_discord3");
const WOH = buildId("b_woh");
const ORPHAN = buildId("b_orphan");
const SHELVED = buildId("b_shelved");

const library: BuildLibrary = {
  version: LIBRARY_VERSION,
  builds: [
    build("b_discord", "Discord Necro", null),
    build("b_discord2", "Discord Necro (rot)", "b_discord"),
    build("b_discord3", "Discord Necro (HM)", "b_discord"),
    build("b_woh", "Word of Healing", null),
    // Its parent was deleted, which promotes it rather than cascading. The
    // link is still on the record, and it resolves to nothing.
    build("b_orphan", "Orphaned variant", "b_deleted"),
    build("b_shelved", "Never used by anything", null),
  ],
  teams: [
    // Two slots point at the same build on purpose: `usedBy` answers in teams,
    // not in slots, so this team must appear exactly once.
    team(
      "t_discord",
      "Discordway",
      [
        player("b_discord"),
        hero("b_discord", 1),
        hero("b_discord2", 2),
        hero("b_woh", 3, "avoid"),
        vacant,
        vacant,
        vacant,
        vacant,
      ],
    ),
    team(
      "t_mesmer",
      "Mesmerway",
      [
        player(null),
        hero("b_woh", 3, "avoid"),
        hero("b_orphan", 4),
        vacant,
        vacant,
        vacant,
        vacant,
        vacant,
      ],
    ),
  ],
  tags: ["vanquish", "HM", "hero", "discord"],
};

const namesOf = (builds: readonly Build[]) => builds.map((b) => b.id).sort();

test("a bar is eight slots, and a ninth cannot be written", () => {
  const takeBar = (value: SkillBar): SkillBar => value;

  // Eight is the only length that compiles, empty slots included.
  assert.equal(takeBar(bar([0, null, 2, null, 4, 5, 6, null])).length, 8);

  // @ts-expect-error a ninth slot is not a build with a mistake in it
  takeBar([null, null, null, null, null, null, null, null, null]);
  // @ts-expect-error seven slots is not a bar either
  takeBar([null, null, null, null, null, null, null]);
  // @ts-expect-error a bar is not a growable list of skills
  takeBar(([] as SkillId[]).concat());

  // Same rule one level up: a party is eight positions, never nine.
  const takeSlots = (value: TeamSlots): TeamSlots => value;
  // @ts-expect-error a ninth party position does not exist
  takeSlots([vacant, vacant, vacant, vacant, vacant, vacant, vacant, vacant, vacant]);
});

test("the slot list every module iterates is as long as the bar it walks", () => {
  // The tuple above is genuinely fixed; the loops that *consume* it were not.
  // validation, diffing, and the two documented template formats each
  // restated "eight", none of them anchored to `SkillBar`, and the usual
  // `as const satisfies readonly SkillSlotIndex[]` constrains membership rather
  // than length — so cutting a list to six left `tsc` green and a validator
  // silently no longer checking the last two positions of any bar.
  assert.deepEqual([...SKILL_SLOTS], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(SKILL_SLOTS.length, bar([0, 1, 2, 3, 4, 5, 6, 7]).length);

  // Each index reaches a real position, and the eight are distinct: an index
  // list of the right length is not yet the right list.
  const filled = bar([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(
    SKILL_SLOTS.map((slot) => filled[slot]),
    [...filled],
  );

  // @ts-expect-error the length is the type's, so a six-slot list is not one
  const takeSlots: typeof SKILL_SLOTS = [0, 1, 2, 3, 4, 5];
  assert.equal(takeSlots.length, 6);
});

test("a team slot references a build and cannot carry one", () => {
  const takeSlot = (value: TeamSlot): TeamSlot => value;
  const discord = buildById(library, DISCORD);
  assert.ok(discord);

  // @ts-expect-error a slot holds a BuildId, never the build itself
  takeSlot({ ...vacant, build: discord });
  // @ts-expect-error nor a bare string that was never minted as a BuildId
  takeSlot({ ...vacant, build: "b_discord" });
  // @ts-expect-error nor a team's id, which is a different kind of name
  takeSlot({ ...vacant, build: teamId("t_discord") });
  // @ts-expect-error and a slot cannot grow a copy of the build alongside it
  takeSlot({ ...vacant, skills: discord.skills });

  // What is allowed is exactly the reference.
  assert.equal(takeSlot({ ...vacant, build: DISCORD }).build, DISCORD);
});

test("an attribute rank outside what a character can invest is unspellable", () => {
  const takeBuild = (value: Build): Build => value;
  const base = build("b_probe", "Probe", null);

  assert.equal(takeBuild({ ...base, attributes: { FireMagic: 12 } }).name, "Probe");

  // @ts-expect-error 12 is the highest rank the cost table admits
  takeBuild({ ...base, attributes: { FireMagic: 13 } });
  // @ts-expect-error the enum's unnamed 26-28 gap has no spelling here
  takeBuild({ ...base, attributes: { Unknown27: 8 } });
  // @ts-expect-error nor does the in-memory `None` sentinel
  takeBuild({ ...base, attributes: { None: 0 } });
});

test("variantsOf returns direct children, and nothing else", () => {
  assert.deepEqual(namesOf(variantsOf(library, DISCORD)), [DISCORD_ROT, DISCORD_HM].sort());

  // A root with no variants, and a variant that is nobody's parent, both answer
  // with an empty list rather than with their siblings.
  assert.deepEqual(variantsOf(library, WOH), []);
  assert.deepEqual(variantsOf(library, DISCORD_ROT), []);

  // The orphan's parent id names a build that is gone; asking about that id
  // must not sweep up every build whose parent is missing.
  assert.deepEqual(namesOf(variantsOf(library, buildId("b_deleted"))), [ORPHAN]);
  assert.deepEqual(variantsOf(library, buildId("b_never_existed")), []);
});

test("parentOf resolves a link, and answers null when there is nothing to resolve", () => {
  const rot = buildById(library, DISCORD_ROT);
  const root = buildById(library, DISCORD);
  const orphan = buildById(library, ORPHAN);
  assert.ok(rot && root && orphan);

  assert.equal(parentOf(library, rot), root);

  // A root has no parent.
  assert.equal(parentOf(library, root), null);

  // The failure path that actually happens: deleting a parent promotes its
  // variants, so a stored `parent` can name a build the library no longer
  // holds. That is an ordinary state, and the answer is null — not a throw,
  // and emphatically not the build itself.
  assert.equal(orphan.parent, buildId("b_deleted"));
  assert.equal(parentOf(library, orphan), null);
});

test("usedBy names teams once each, and says nothing about builds nobody uses", () => {
  // Discordway points at `b_discord` from two slots and must appear once.
  assert.deepEqual(
    usedBy(library, DISCORD).map((t) => t.id),
    [teamId("t_discord")],
  );
  assert.deepEqual(
    usedBy(library, WOH).map((t) => t.id),
    [teamId("t_discord"), teamId("t_mesmer")],
  );

  // A build in the library that no team references, and an id that is not in
  // the library at all, are both empty — an empty slot is not a match.
  assert.deepEqual(usedBy(library, SHELVED), []);
  assert.deepEqual(usedBy(library, buildId("b_never_existed")), []);
});

test("forking a variant keeps the root, so lineage never grows a second level", () => {
  const root = buildById(library, DISCORD);
  const rot = buildById(library, DISCORD_ROT);
  assert.ok(root && rot);

  // Forking a root makes a variant of it.
  assert.equal(forkParentOf(root), DISCORD);

  // Forking a variant makes a sibling of that variant, not a grandchild. This
  // is the whole one-level rule; `parent: source.id` is how a chain gets in.
  assert.equal(forkParentOf(rot), DISCORD);

  const forked: Build = {
    ...rot,
    id: buildId("b_discord4"),
    name: "Discord Necro (rot, HM)",
    parent: forkParentOf(rot),
  };
  const forkedLibrary: BuildLibrary = {
    ...library,
    builds: [...library.builds, forked],
  };

  // The family stays one level: three variants under the root, and the variant
  // that was forked has still no children of its own.
  assert.deepEqual(namesOf(variantsOf(forkedLibrary, DISCORD)), [
    DISCORD_ROT,
    DISCORD_HM,
    buildId("b_discord4"),
  ].sort());
  assert.deepEqual(variantsOf(forkedLibrary, DISCORD_ROT), []);
  assert.equal(parentOf(forkedLibrary, forked), root);

  // And the rule is idempotent: forking the fork still lands on the root.
  assert.equal(forkParentOf(forked), DISCORD);
});
