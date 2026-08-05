// Two renderer modules name the game's template directories: filesystem.ts
// creates them in preRun, template-store.ts reads and writes them. They cannot
// share a constant — filesystem.ts is merged wholesale into the WASM host and
// may export nothing but its installer, which
// tests/unit/renderer-host-modules-merge-without-collision.test.ts enforces.
//
// So the agreement is proved instead of assumed. The failure this prevents is
// silent in exactly the way the hand-mirrored bridge markers were: no error, no
// log, just an import that writes to a directory the game never looks in.

import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { templatePath } from "../../src/renderer/template-store.js";
import type { TemplateKind } from "../../src/renderer/template-format.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The directory the store would write into, taken from the store itself. */
function directoryFor(kind: TemplateKind): string {
  const written = templatePath({ kind, folder: null, name: "Probe", code: "OQCiUyo8" });
  assert.ok(written, `the store refused to place a ${kind} template`);
  return written.slice(0, written.lastIndexOf("/"));
}

test("the store writes to the directories the mount creates", async () => {
  const filesystem = await readFile(
    path.join(root, "src/renderer/filesystem.ts"),
    "utf8",
  );

  for (const kind of ["skills", "equipment"] as const) {
    const directory = directoryFor(kind);
    // filesystem.ts builds these from `${MOUNT}/…` while the working directory
    // is still the root, so the literal it carries is the tail.
    const tail = directory.replace(/^\/app:/, "");
    assert.ok(
      filesystem.includes(`\${MOUNT}${tail}`),
      `filesystem.ts does not create ${directory}`,
    );
  }

  assert.match(filesystem, /const MOUNT = 'app:'/);
});

test("the store addresses the mount absolutely", () => {
  // filesystem.ts ends preRun with `chdir(MOUNT)`, so from then on the working
  // directory is the mount itself. A mount-relative spelling here would resolve
  // to `/app:/app:/Templates/…`: every read finds nothing, the pane concludes
  // the game is not running, and no test with a fake filesystem notices,
  // because a fake treats a path as an opaque key.
  for (const kind of ["skills", "equipment"] as const) {
    assert.match(directoryFor(kind), /^\/app:\//, kind);
  }
});
