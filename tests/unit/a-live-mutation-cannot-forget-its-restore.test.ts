import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  advanceMutationJournal,
  assertMutationRecoveryClear,
  prepareMutationJournal,
  readMutationJournal,
} from "../../scripts/enhancements-live/mutation-journal.js";

describe("the live mutation recovery obligation", () => {
  it("is durable before mutation and blocks a new baseline until restored", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gwonmac-journal-"));
    const journalPath = path.join(directory, "mutation.json");
    const input = {
      scenario: "hero-build-reconcile",
      clientBuild: 38_771,
      mapId: 81,
      before: [{ heroId: 1, skills: [1, 2, 3] }],
      planned: [{ heroId: 1, skills: [2, 1, 3] }],
    };

    await prepareMutationJournal(input, journalPath);
    assert.equal((await readMutationJournal(journalPath))?.phase, "prepared");
    await assert.rejects(
      prepareMutationJournal(input, journalPath),
      /unfinished mutation journal/,
    );

    await advanceMutationJournal("mutated", 4, journalPath);
    assert.equal(
      (await readMutationJournal(journalPath))?.lastAcknowledgedStep,
      4,
    );
    await assert.rejects(
      assertMutationRecoveryClear(journalPath),
      /is mutated after 4 acknowledged steps/,
    );

    await advanceMutationJournal("restored", 5, journalPath);
    await assertMutationRecoveryClear(journalPath);
    assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
    assert.deepEqual(
      JSON.parse(await readFile(journalPath, "utf8")).before,
      input.before,
    );
  });

  it("rejects malformed recovery state instead of treating it as clear", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gwonmac-journal-"));
    const journalPath = path.join(directory, "mutation.json");
    await assert.rejects(
      advanceMutationJournal("mutated", 1, journalPath),
      /no active mutation journal/,
    );
  });
});
