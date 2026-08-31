/** Corrupt player documents are preserved without accumulating forever. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import {
  preserveCorruptDocument,
  quarantineCorruptDocument,
} from "../../src/main/core/corrupt-document.js";

describe("corrupt document quarantine", () => {
  it("can preserve bytes without creating an absent-document crash window", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gw-corrupt-document-"));
    const documentPath = join(directory, "launcher-state.json");
    await writeFile(documentPath, "current corrupt bytes");

    const backupPath = await preserveCorruptDocument(
      documentPath,
      "current corrupt bytes",
    );

    assert.equal(await readFile(documentPath, "utf8"), "current corrupt bytes");
    assert.equal(await readFile(backupPath, "utf8"), "current corrupt bytes");
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves the new bytes, retains three backups, and touches no neighbour", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gw-corrupt-document-"));
    const documentPath = join(directory, "player.json");
    for (const timestamp of [1000, 2000, 3000, 4000]) {
      await writeFile(`${documentPath}.corrupt-${timestamp}`, String(timestamp));
    }
    await writeFile(`${documentPath}.corrupt-manual`, "keep manual evidence");
    await writeFile(join(directory, "other.json"), "keep neighbour");
    await writeFile(documentPath, "current corrupt bytes");

    const backupPath = await quarantineCorruptDocument(documentPath);
    assert.ok(backupPath);
    assert.match(
      backupPath,
      /player\.json\.corrupt-\d+-[0-9a-f-]{36}$/u,
    );
    assert.equal(await readFile(backupPath, "utf8"), "current corrupt bytes");
    assert.equal(await readFile(`${documentPath}.corrupt-4000`, "utf8"), "4000");
    assert.equal(await readFile(`${documentPath}.corrupt-3000`, "utf8"), "3000");
    assert.equal(
      await readFile(`${documentPath}.corrupt-manual`, "utf8"),
      "keep manual evidence",
    );
    assert.equal(
      await readFile(join(directory, "other.json"), "utf8"),
      "keep neighbour",
    );
    assert.deepEqual(
      (await readdir(directory)).filter((name) =>
        /^player\.json\.corrupt-\d/u.test(name)).sort(),
      [
        "player.json.corrupt-3000",
        "player.json.corrupt-4000",
        basename(backupPath),
      ].sort(),
    );
  });

  it("returns null when another owner already moved the document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gw-corrupt-document-"));
    assert.equal(
      await quarantineCorruptDocument(join(directory, "missing.json")),
      null,
    );
    assert.deepEqual(await readdir(directory), []);
  });
});
