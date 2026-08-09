// The mounted template directories, driven through a fake of the one Emscripten
// object the generated glue publishes. The fake is a tree in a Map rather than a
// recording of calls, because every claim here is about what the game would find
// afterwards — not about which method was reached.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type TemplateFileSystem,
  ROOT_LIMIT,
  applyImport,
  exportEntries,
  mutationInFlight,
  planImport,
  readTemplates,
  rescueStranded,
  strandedTemplates,
  templatePath,
} from "../../src/renderer/template-store.js";
import type { TemplateCandidate } from "../../src/renderer/template-format.js";

const SKILLS = "OQCiUyo8AkVwR4KMMGAAAEAA";
const OTHER_SKILLS = "OQCiUyo8AkVwR4KMMGAAAEAB";
const EQUIPMENT = "Pk5hbug2fkaiklWVqQhyI90YjyIBLziyIBTpgyIBr7hyIbB";

const SKILLS_DIR = "/app:/Templates/Skills";
const EQUIPMENT_DIR = "/app:/Templates/Equipment";

interface Fake extends TemplateFileSystem {
  files: Map<string, string>;
  directories: Set<string>;
  syncs: number;
  /** Held so a test can observe what applyImport does before the sync answers. */
  settleSync: (() => void) | null;
}

function fakeFilesystem(files: Record<string, string> = {}, deferSync = false): Fake {
  const fake: Fake = {
    files: new Map(Object.entries(files)),
    directories: new Set([SKILLS_DIR, EQUIPMENT_DIR]),
    syncs: 0,
    settleSync: null,

    readdir(path) {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const file of fake.files.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0] ?? "");
      }
      for (const directory of fake.directories) {
        if (directory.startsWith(prefix)) {
          names.add(directory.slice(prefix.length).split("/")[0] ?? "");
        }
      }
      if (!fake.directories.has(path)) throw new Error(`no such directory: ${path}`);
      return [".", "..", ...names];
    },
    stat(path) {
      if (fake.directories.has(path)) return { mode: 1 };
      if (fake.files.has(path)) return { mode: 2 };
      throw new Error(`no such path: ${path}`);
    },
    isDir: (mode) => mode === 1,
    isFile: (mode) => mode === 2,
    readFile(path) {
      const contents = fake.files.get(path);
      if (contents === undefined) throw new Error(`no such file: ${path}`);
      return contents;
    },
    writeFile(path, data) {
      fake.files.set(path, data);
    },
    unlink(path) {
      if (!fake.files.delete(path)) throw new Error(`no such file: ${path}`);
    },
    rmdir(path) {
      const prefix = `${path}/`;
      const occupied = [...fake.files.keys(), ...fake.directories].some(
        (known) => known.startsWith(prefix),
      );
      if (occupied) throw new Error(`not empty: ${path}`);
      fake.directories.delete(path);
    },
    mkdirTree(path) {
      const segments = path.split("/");
      for (let index = 2; index <= segments.length; index += 1) {
        fake.directories.add(segments.slice(0, index).join("/"));
      }
    },
    analyzePath: (path) => ({
      exists: fake.files.has(path) || fake.directories.has(path),
    }),
    syncfs(_populate, callback) {
      fake.syncs += 1;
      if (deferSync) fake.settleSync = () => callback();
      else callback();
    },
  };
  for (const file of fake.files.keys()) {
    const cut = file.lastIndexOf("/");
    fake.mkdirTree(file.slice(0, cut));
  }
  return fake;
}

const candidate = (
  over: Partial<TemplateCandidate> = {},
): TemplateCandidate => ({
  kind: "skills",
  folder: null,
  name: "Shockaxe",
  code: SKILLS,
  ...over,
});

test("reads both kinds and one level of subfolder", () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Shockaxe.txt`]: SKILLS,
    [`${SKILLS_DIR}/Warrior/Hundred Blades.txt`]: OTHER_SKILLS,
    [`${EQUIPMENT_DIR}/PvP Set.txt`]: EQUIPMENT,
  });

  assert.deepEqual(readTemplates(fs), [
    { kind: "equipment", folder: null, name: "PvP Set", code: EQUIPMENT },
    { kind: "skills", folder: null, name: "Shockaxe", code: SKILLS },
    { kind: "skills", folder: "Warrior", name: "Hundred Blades", code: OTHER_SKILLS },
  ]);
});

test("ignores what the game would not list", () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/notes.md`]: SKILLS,
    [`${SKILLS_DIR}/Empty.txt`]: "",
    [`${SKILLS_DIR}/Corrupt.txt`]: "not a template code",
    [`${SKILLS_DIR}/Deep/Nested/Too Far.txt`]: SKILLS,
  });
  assert.deepEqual(readTemplates(fs), []);
});

test("addresses an export the way an export folder is addressed", () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Warrior/Shockaxe.txt`]: SKILLS,
    [`${EQUIPMENT_DIR}/PvP Set.txt`]: EQUIPMENT,
  });
  assert.deepEqual(exportEntries(fs), [
    { path: "Equipment/PvP Set.txt", contents: EQUIPMENT },
    { path: "Skills/Warrior/Shockaxe.txt", contents: SKILLS },
  ]);
});

test("re-importing the same folder does nothing at all", () => {
  const fs = fakeFilesystem({ [`${SKILLS_DIR}/Shockaxe.txt`]: SKILLS });
  const plan = planImport(fs, [candidate()], "skip");
  assert.equal(plan.already, 1);
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.taken, 0);
});

test("a name taken by a different build is refused, or replaced when asked", () => {
  const existing = { [`${SKILLS_DIR}/Shockaxe.txt`]: OTHER_SKILLS };

  const skip = planImport(fakeFilesystem(existing), [candidate()], "skip");
  assert.equal(skip.taken, 1);
  assert.equal(skip.writes.length, 0);

  const replace = planImport(fakeFilesystem(existing), [candidate()], "replace");
  assert.equal(replace.replaced, 1);
  assert.deepEqual(replace.writes, [candidate()]);
});

test("two incoming templates cannot claim one name", () => {
  const fs = fakeFilesystem();
  const plan = planImport(
    fs,
    [candidate(), candidate({ code: OTHER_SKILLS })],
    "skip",
  );
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.taken, 1);
});

test("the game's own root limit is reached before a write, not during one", () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < ROOT_LIMIT; index += 1) {
    files[`${SKILLS_DIR}/Build ${index}.txt`] = SKILLS;
  }
  const fs = fakeFilesystem(files);

  const plan = planImport(
    fs,
    [
      candidate({ name: "One More" }),
      // Subfolders are the documented way around the limit, so this still lands.
      candidate({ name: "One More", folder: "Warrior" }),
    ],
    "skip",
  );
  assert.equal(plan.full, 1);
  assert.deepEqual(plan.writes, [candidate({ name: "One More", folder: "Warrior" })]);
});

test("writes what it planned and creates the folder it needs", async () => {
  const fs = fakeFilesystem();
  const plan = planImport(
    fs,
    [candidate({ folder: "From Windows" }), candidate({ name: "PvP", kind: "equipment", code: EQUIPMENT })],
    "skip",
  );

  assert.equal(await applyImport(fs, plan), 2);
  assert.equal(fs.files.get(`${SKILLS_DIR}/From Windows/Shockaxe.txt`), SKILLS);
  assert.equal(fs.files.get(`${EQUIPMENT_DIR}/PvP.txt`), EQUIPMENT);
  assert.ok(fs.directories.has(`${SKILLS_DIR}/From Windows`));
});

test("a template is only reported saved once the mount has been synchronised", async () => {
  const fs = fakeFilesystem({}, true);
  const plan = planImport(fs, [candidate()], "skip");

  let resolved = false;
  const running = applyImport(fs, plan).then((count) => {
    resolved = true;
    return count;
  });
  await Promise.resolve();

  // The bytes are in the mount, but nothing has told IndexedDB about them yet.
  assert.equal(fs.files.has(`${SKILLS_DIR}/Shockaxe.txt`), true);
  assert.equal(resolved, false);
  assert.equal(fs.syncs, 1);

  fs.settleSync?.();
  assert.equal(await running, 1);
});

test("a second import cannot overlap the one already running", async () => {
  const fs = fakeFilesystem({}, true);
  const plan = planImport(fs, [candidate()], "skip");

  const running = applyImport(fs, plan);
  await Promise.resolve();
  await assert.rejects(() => applyImport(fs, plan), /already running/);

  fs.settleSync?.();
  await running;
  assert.equal(mutationInFlight(), false);
});

test("a failed synchronisation does not strand the guard", async () => {
  const fs = fakeFilesystem();
  fs.syncfs = (_populate, callback) => callback(new Error("quota exceeded"));
  await assert.rejects(() => applyImport(fs, planImport(fs, [candidate()], "skip")));
  assert.equal(mutationInFlight(), false);
});

test("finds only the templates the game has no way to reach", () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Shockaxe.txt`]: SKILLS,
    [`${SKILLS_DIR}/Paragon/Imbagon.txt`]: OTHER_SKILLS,
    [`${EQUIPMENT_DIR}/PvP/Set.txt`]: EQUIPMENT,
  });
  assert.deepEqual(
    strandedTemplates(fs).map((template) => `${template.folder}/${template.name}`),
    ["PvP/Set", "Paragon/Imbagon"],
  );
});

test("moves a stranded template up, keeping its folder in the name", async () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Paragon/Imbagon.txt`]: SKILLS,
  });

  assert.deepEqual(await rescueStranded(fs), { moved: 1, blocked: 0 });
  assert.equal(fs.files.get(`${SKILLS_DIR}/Paragon - Imbagon.txt`), SKILLS);
  assert.equal(fs.files.has(`${SKILLS_DIR}/Paragon/Imbagon.txt`), false);
  // The emptied folder goes too: the client's directory scan does find those,
  // so leaving one behind means a folder that opens onto nothing.
  assert.equal(fs.directories.has(`${SKILLS_DIR}/Paragon`), false);
  assert.deepEqual(strandedTemplates(fs), []);
});

test("a rescue that would overwrite a different build leaves both alone", async () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Paragon - Imbagon.txt`]: OTHER_SKILLS,
    [`${SKILLS_DIR}/Paragon/Imbagon.txt`]: SKILLS,
  });

  assert.deepEqual(await rescueStranded(fs), { moved: 0, blocked: 1 });
  assert.equal(fs.files.get(`${SKILLS_DIR}/Paragon - Imbagon.txt`), OTHER_SKILLS);
  assert.equal(fs.files.get(`${SKILLS_DIR}/Paragon/Imbagon.txt`), SKILLS);
});

test("a stranded copy of a build already at the top level is just removed", async () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Paragon - Imbagon.txt`]: SKILLS,
    [`${SKILLS_DIR}/Paragon/Imbagon.txt`]: SKILLS,
  });

  assert.deepEqual(await rescueStranded(fs), { moved: 1, blocked: 0 });
  assert.equal(fs.files.has(`${SKILLS_DIR}/Paragon/Imbagon.txt`), false);
  assert.equal(fs.files.get(`${SKILLS_DIR}/Paragon - Imbagon.txt`), SKILLS);
});

test("a rescue cannot push the top level past the game's own limit", async () => {
  const files: Record<string, string> = {
    [`${SKILLS_DIR}/Paragon/Imbagon.txt`]: OTHER_SKILLS,
  };
  for (let index = 0; index < ROOT_LIMIT; index += 1) {
    files[`${SKILLS_DIR}/Build ${index}.txt`] = SKILLS;
  }
  const fs = fakeFilesystem(files);

  assert.deepEqual(await rescueStranded(fs), { moved: 0, blocked: 1 });
  assert.equal(fs.files.get(`${SKILLS_DIR}/Paragon/Imbagon.txt`), OTHER_SKILLS);
});

test("a folder holding something else is left standing", async () => {
  const fs = fakeFilesystem({
    [`${SKILLS_DIR}/Paragon/Imbagon.txt`]: SKILLS,
    [`${SKILLS_DIR}/Paragon/notes.md`]: "not ours",
  });

  assert.deepEqual(await rescueStranded(fs), { moved: 1, blocked: 0 });
  assert.equal(fs.directories.has(`${SKILLS_DIR}/Paragon`), true);
  assert.equal(fs.files.get(`${SKILLS_DIR}/Paragon/notes.md`), "not ours");
});

test("refuses any name that would not stay inside the two directories", () => {
  for (const folder of ["..", ".", "", "a/b", "a\\b", "app:"]) {
    assert.equal(templatePath(candidate({ folder })), null, folder);
  }
  for (const name of ["..", ".", "", "a/b", "a\\b"]) {
    assert.equal(templatePath(candidate({ name })), null, name);
  }
  assert.equal(
    templatePath(candidate()),
    `${SKILLS_DIR}/Shockaxe.txt`,
  );
});
