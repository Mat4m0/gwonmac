import assert from "node:assert/strict";
import test from "node:test";
import {
  LIBRARY_VERSION,
  buildId,
  heroId,
  skillBarOf,
  skillId,
  teamId,
  teamSlotsOf,
  type Build,
  type BuildLibrary,
} from "../../src/shared/builds/library.js";
import {
  decodeTeamBundle,
  encodeTeamBundle,
  importTeamBundle,
} from "../../src/shared/builds/team-bundle.js";

const prefix = "gwonmac-team:";
const decodePayload = (code: string) => JSON.parse(Buffer.from(
  code.slice(prefix.length),
  "base64url",
).toString("utf8")) as Record<string, unknown>;
const encodePayload = (value: unknown) => prefix
  + Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const build = (id: string, name: string, parent: string | null): Build => ({
  id: buildId(id),
  name,
  professions: ["Mo", "Me"],
  skills: skillBarOf((slot) => slot < 2 ? skillId(100 + slot) : null),
  attributes: { HealingPrayers: 12, DivineFavor: 9 },
  tags: ["support", "HM"],
  notes: `${name} notes`,
  favourite: name === "Child",
  lastUsed: 1_725_000_000_000,
  parent: parent === null ? null : buildId(parent),
  origin: "imported fixture",
});

const source: BuildLibrary = {
  version: LIBRARY_VERSION,
  tags: ["existing", "support", "HM"],
  builds: [build("root", "Root", null), build("child", "Child", "root")],
  teams: [{
    id: teamId("team"),
    name: "Complete team",
    tags: ["HM"],
    mode: "hard",
    favourite: true,
    lastUsed: 1_725_000_000_001,
    notes: "Team notes",
    slots: teamSlotsOf((slot) => slot === 0
      ? { hero: null, build: buildId("child"), behaviour: null }
      : slot === 1 || slot === 2
        ? { hero: heroId(slot === 1 ? 6 : 7), build: buildId("child"), behaviour: "guard" }
        : { hero: null, build: null, behaviour: null }),
  }],
};

test("a team code preserves every team field, shared slot, build and parent", () => {
  const selected = source.teams[0]!;
  const code = encodeTeamBundle(source, selected.id);
  const bundle = decodeTeamBundle(code);

  assert.deepEqual(bundle.team, selected);
  assert.deepEqual(bundle.tags, ["support", "HM"]);
  assert.deepEqual(
    bundle.builds.map(({ id }) => id),
    ["root", "child"],
  );
  assert.equal(bundle.team.slots[1]?.build, bundle.team.slots[2]?.build);
  assert.equal(bundle.builds.find(({ id }) => id === "child")?.parent, "root");
  assert.deepEqual(
    decodeTeamBundle(encodeTeamBundle({ ...source, teams: [bundle.team] }, bundle.team.id)),
    bundle,
  );
});

test("import remints identities and remaps repeated slots and lineage atomically", () => {
  const bundle = decodeTeamBundle(encodeTeamBundle(source, source.teams[0]!.id));
  let next = 0;
  const imported = importTeamBundle(source, bundle, (kind) => `${kind}-import-${++next}`);
  const team = imported.teams[0]!;

  assert.notEqual(team.id, bundle.team.id);
  assert.equal(imported.teams.length, source.teams.length + 1);
  assert.equal(imported.builds.length, source.builds.length + bundle.builds.length);
  assert.equal(team.slots[1]?.build, team.slots[2]?.build);
  const child = imported.builds.find(({ id, name }) => id !== "child" && name === "Child")!;
  const parent = imported.builds.find(({ id }) => id === child.parent)!;
  assert.equal(parent.name, "Root");
  assert.deepEqual(imported.tags, source.tags);
  assert.deepEqual(source.teams[0]?.id, teamId("team"));
});

test("future, malformed, dangling, duplicate and oversized codes are refused", () => {
  const code = encodeTeamBundle(source, source.teams[0]!.id);
  const valid = decodePayload(code);
  assert.throws(() => decodeTeamBundle(encodePayload({ ...valid, version: 2 })), /newer/iu);
  assert.throws(() => decodeTeamBundle("gwonmac-team:not+base64"), /damaged|base64/iu);

  const builds = valid.builds as Array<Record<string, unknown>>;
  assert.throws(
    () => decodeTeamBundle(encodePayload({ ...valid, builds: [...builds, builds[0]] })),
    /duplicate/iu,
  );
  assert.throws(
    () => decodeTeamBundle(encodePayload({
      ...valid,
      builds: builds.map((build, index) => index === 0
        ? { ...build, parent: "missing-parent" }
        : build),
    })),
    /parent/iu,
  );
  assert.throws(
    () => decodeTeamBundle(`${prefix}${"a".repeat(256 * 1024)}`),
    /large/iu,
  );
  const before = structuredClone(source);
  assert.throws(
    () => importTeamBundle(source, decodeTeamBundle(code), () => "child"),
    /fresh imported build ID/iu,
  );
  assert.deepEqual(source, before);
});
