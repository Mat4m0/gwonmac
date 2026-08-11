// `build-library.json` holds work nobody else has a copy of. A player's builds
// are not derivable from anything — not from the game, not from a cache, not
// from a re-download — which makes every failure mode of this store a question
// about how much of someone's collection a single bad byte is allowed to take.
//
// That is the whole subject of this file. The store answers it three different
// ways depending on the damage, and each answer is a deliberate choice rather
// than whatever the parser happened to do:
//
//   - a slot naming a build that is not in the file  →  that one slot empties
//   - two builds sharing an id                       →  the file is refused
//   - unreadable JSON, or a version from the future  →  moved aside, kept
//
// The middle one looks harsh next to the first, and it is the point of the
// file. `buildById` answers with the first match, so a duplicate id does not
// lose a build loudly — it loses one silently, and rebinds every team that
// pointed at it to the survivor. A library that loads with the wrong builds in
// the wrong teams is worse than one that refuses to load.
//
// The third never deletes. `settings.ts` recovers to defaults because defaults
// are a fine place to be; there is no such thing as a good default library, so
// the original file is renamed rather than replaced and `onRecovered` fires.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadBuildLibrary,
  referencedBuildIds,
  saveBuildLibrary,
} from "../../src/main/core/build-library.ts";
import {
  EMPTY_LIBRARY,
  parseBuildLibrary,
} from "../../src/shared/builds/parse-library.ts";
import {
  LIBRARY_VERSION,
  buildId,
  type BuildLibrary,
} from "../../src/shared/builds/library.ts";
import { AppError } from "../../src/shared/errors.ts";

const dir = () => mkdtemp(join(tmpdir(), "gw-build-library-"));

/** A build as JSON, i.e. how it actually arrives: unbranded and untrusted. */
const storedBuild = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `build ${id}`,
  professions: ["Mo", "Me"],
  skills: [282, 283, 281, 887, null, null, null, 2],
  attributes: { HealingPrayers: 12, DivineFavor: 11 },
  tags: ["heal"],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: null,
  origin: null,
  ...extra,
});

const storedSlot = (build: string | null) => ({
  build,
  hero: null,
  behaviour: null,
});

const storedTeam = (id: string, first: string | null) => ({
  id,
  name: `team ${id}`,
  tags: [],
  mode: "none",
  favourite: false,
  lastUsed: null,
  notes: "",
  slots: [
    storedSlot(first),
    storedSlot(null),
    storedSlot(null),
    storedSlot(null),
    storedSlot(null),
    storedSlot(null),
    storedSlot(null),
    storedSlot(null),
  ],
});

const stored = (builds: unknown[], teams: unknown[] = []) => ({
  version: LIBRARY_VERSION,
  builds,
  teams,
  tags: [],
});

test("a slot pointing at a build that is gone empties, and nothing else changes", () => {
  const library = parseBuildLibrary(
    stored([storedBuild("b1")], [storedTeam("t1", "b_deleted")]),
  );

  assert.equal(library.teams[0]?.slots[0]?.build, null);
  // The rest of the team, and the whole build list, survive the repair. This is
  // the same edit deleting a build performs, so a library that has been through
  // it is not a damaged library — it is a library with an empty slot.
  assert.equal(library.builds.length, 1);
  assert.equal(library.teams[0]?.name, "team t1");
  assert.equal(library.teams[0]?.slots.length, 8);
});

test("a slot pointing at a build that exists is left alone", () => {
  // Without this the test above passes against a parser that nulls every slot.
  const library = parseBuildLibrary(
    stored([storedBuild("b1")], [storedTeam("t1", "b1")]),
  );
  assert.equal(library.teams[0]?.slots[0]?.build, "b1");
  assert.deepEqual([...referencedBuildIds(library)], [buildId("b1")]);
});

test("two builds sharing an id refuse the file rather than lose one quietly", () => {
  assert.throws(
    () => parseBuildLibrary(stored([storedBuild("b1"), storedBuild("b1")])),
    (error: unknown) =>
      error instanceof AppError && error.code === "bad_build_library",
  );
  // Teams too: the same silent-loss argument applies to a duplicate team id.
  assert.throws(() =>
    parseBuildLibrary(stored([], [storedTeam("t1", null), storedTeam("t1", null)])),
  );
});

test("a bar that is not eight slots long is not a build to store", () => {
  // The tuple type says eight and a file on disk cannot respect a type, so this
  // is the only place the claim is enforced. Everything downstream indexes
  // `SKILL_SLOTS` into the bar and would read `undefined` off a short one.
  for (const skills of [[], [1, 2, 3], new Array(9).fill(null)]) {
    assert.throws(
      () => parseBuildLibrary(stored([storedBuild("b1", { skills })])),
      (error: unknown) => error instanceof AppError,
      `bar of ${skills.length}`,
    );
  }
});

test("a value the model has no name for is refused, not coerced", () => {
  const cases: readonly [string, Record<string, unknown>][] = [
    ["a profession that does not exist", { professions: ["Q", null] }],
    ["an attribute that does not exist", { attributes: { Juggling: 3 } }],
    ["a rank above what the cost table admits", { attributes: { Curses: 13 } }],
    ["a fractional rank", { attributes: { Curses: 1.5 } }],
    ["an empty id", { id: "" }],
    ["a timestamp that is not a time", { lastUsed: -1 }],
    ["a name that is not a string", { name: 7 }],
  ];
  for (const [what, extra] of cases) {
    assert.throws(
      () => parseBuildLibrary(stored([storedBuild("b1", extra)])),
      (error: unknown) => error instanceof AppError,
      what,
    );
  }
});

test("a version this build cannot read is refused rather than reinterpreted", () => {
  // Refusing is what lets the file be moved aside intact below. A parser that
  // read a future file on a best-effort basis would save the result back and
  // destroy whatever it did not understand.
  for (const version of [LIBRARY_VERSION + 1, LIBRARY_VERSION - 1, undefined, "2"]) {
    assert.throws(
      () => parseBuildLibrary({ version, builds: [], teams: [], tags: [] }),
      (error: unknown) => error instanceof AppError,
      `version ${String(version)}`,
    );
  }
});

test("a missing file is a new profile, and says nothing happened", async () => {
  const path = join(await dir(), "build-library.json");
  let recovered = false;
  const library = await loadBuildLibrary(path, () => {
    recovered = true;
  });
  assert.deepEqual(library, EMPTY_LIBRARY);
  assert.equal(recovered, false, "an absent file is not a recovery");
});

test("an unreadable library is moved aside, never overwritten", async () => {
  const folder = await dir();
  const path = join(folder, "build-library.json");
  await writeFile(path, "{ this is not json");

  const backups: string[] = [];
  const library = await loadBuildLibrary(path, (backup) => {
    backups.push(backup);
  });

  assert.deepEqual(library, EMPTY_LIBRARY);
  assert.equal(backups.length, 1, "the caller is told, so it can tell somebody");

  // The bytes are still there. This is the assertion the whole recovery path
  // exists for: an empty result is indistinguishable from a new profile, so if
  // the original were gone the player would have no way to know what they lost.
  assert.equal(await readFile(backups[0]!, "utf8"), "{ this is not json");
  const names = await readdir(folder);
  assert.equal(names.length, 1, "the original name is free, the content is kept");
});

test("a readable file that the model refuses is recovered the same way", async () => {
  // Corrupt JSON and valid JSON in an unreadable shape are the same event to a
  // player, and used to be two code paths that could disagree.
  const path = join(await dir(), "build-library.json");
  await writeFile(path, JSON.stringify(stored([storedBuild("b1"), storedBuild("b1")])));

  let recovered = false;
  const library = await loadBuildLibrary(path, () => {
    recovered = true;
  });
  assert.deepEqual(library, EMPTY_LIBRARY);
  assert.equal(recovered, true);
});

test("what a save returns is what the next load will hand back", async () => {
  const path = join(await dir(), "build-library.json");
  const written = parseBuildLibrary(
    stored([storedBuild("b1")], [storedTeam("t1", "b1")]),
  );

  const saved = await saveBuildLibrary(path, written);
  const reloaded = await loadBuildLibrary(path);
  assert.deepEqual(reloaded, saved);
  assert.deepEqual(reloaded, written);
});

test("a save applies the same repair a load would, so the two cannot disagree", async () => {
  const path = join(await dir(), "build-library.json");
  // A renderer bug hands over a slot referencing a build it also removed. The
  // store must not persist a shape its own loader would then quarantine.
  const wishful = {
    ...parseBuildLibrary(stored([storedBuild("b1")], [storedTeam("t1", "b1")])),
    builds: [],
  } as unknown as BuildLibrary;

  const saved = await saveBuildLibrary(path, wishful);
  assert.equal(saved.teams[0]?.slots[0]?.build, null);
  assert.deepEqual(await loadBuildLibrary(path), saved);
});

test("the library is owner-only on disk", async () => {
  // A build library is one player's own work. Nothing about it needs to be
  // readable by another account on a shared Mac.
  const path = join(await dir(), "build-library.json");
  await saveBuildLibrary(path, EMPTY_LIBRARY);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});
