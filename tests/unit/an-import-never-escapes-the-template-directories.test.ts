// One claim, driven end to end: whatever text a player picks, every file an
// import writes lands inside the game's own two template directories.
//
// It is a separate file because the mount does not defend itself. The
// `normalize` that src/renderer/filesystem.ts installs onto FS rewrites
// backslashes and carries no traversal guard, so `mkdirTree` will happily climb
// out of the mount; the only thing standing between a hostile name and the rest
// of IDBFS is the check in template-store.ts. Rounds 5 and 9 of
// internal/upstream/investigation-log.md are what getting this wrong cost.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  combineParses,
  parseTemplateSource,
} from "../../src/renderer/template-format.js";
import {
  type TemplateFileSystem,
  applyImport,
  planImport,
} from "../../src/renderer/template-store.js";

const SKILLS = "OQCiUyo8AkVwR4KMMGAAAEAA";
const EQUIPMENT = "Pk5hbug2fkaiklWVqQhyI90YjyIBLziyIBTpgyIBr7hyIbB";
const DIRECTORIES = ["/app:/Templates/Skills", "/app:/Templates/Equipment"];

/** Names and destinations a player could plausibly paste, pick, or be handed. */
const HOSTILE = [
  "..",
  ".",
  "../..",
  "../../../../etc/passwd",
  "..\\..\\Windows\\System32",
  "/app:/Templates/Skills/elsewhere",
  "/absolute",
  "C:\\Users\\someone",
  "a/b/c",
  "....",
  "  ..  ",
  "name\u0000truncated",
  "-",
  "",
];

function recordingFilesystem(): TemplateFileSystem & { written: string[] } {
  const directories = new Set(DIRECTORIES);
  const written: string[] = [];
  return {
    written,
    readdir: (path) => (directories.has(path) ? [".", ".."] : []),
    stat: () => ({ mode: 1 }),
    isDir: (mode) => mode === 1,
    isFile: (mode) => mode === 2,
    readFile: () => {
      throw new Error("nothing exists yet");
    },
    writeFile: (path) => {
      written.push(path);
    },
    unlink: () => {},
    rmdir: () => {},
    mkdirTree: (path) => {
      directories.add(path);
    },
    analyzePath: (path) => ({ exists: directories.has(path) }),
    syncfs: (_populate, callback) => callback(),
  };
}

test("no hostile name reaches a path outside the two template directories", async () => {
  const fs = recordingFilesystem();

  const parses = HOSTILE.flatMap((hostile) => [
    // As a template name, in every line form that carries one.
    parseTemplateSource(`${hostile}\t${SKILLS}`, { sourceName: null, namePrefix: null }),
    parseTemplateSource(`[${hostile};${EQUIPMENT}]`, { sourceName: null, namePrefix: null }),
    // As the filename a picked file lends its code.
    parseTemplateSource(SKILLS, { sourceName: hostile, namePrefix: null }),
    // As the folder a picked path implies, which becomes part of the name.
    parseTemplateSource(SKILLS, { sourceName: "Build", namePrefix: hostile }),
  ]);

  const combined = combineParses(parses);
  assert.ok(combined.candidates.length > 0, "the corpus must actually produce candidates");

  await applyImport(fs, planImport(fs, combined.candidates, "replace"));

  assert.ok(fs.written.length > 0, "the corpus must actually produce writes");
  for (const path of fs.written) {
    const directory = DIRECTORIES.find((known) => path.startsWith(`${known}/`));
    assert.ok(directory, `escaped the mount: ${path}`);

    const relative = path.slice(directory.length + 1);
    const segments = relative.split("/");
    // An import always lands at the type root: the client's scan never
    // enumerates a subdirectory, so a template written into one is invisible in
    // game (defect 8 in internal/upstream/upstream-defects.md).
    assert.equal(segments.length, 1, `an import must land at the type root: ${path}`);
    for (const segment of segments) {
      assert.notEqual(segment, "", path);
      assert.notEqual(segment, ".", path);
      assert.notEqual(segment, "..", path);
      assert.doesNotMatch(segment, /[\\:]/, path);
    }
    assert.match(relative, /\.txt$/, path);
  }
});
