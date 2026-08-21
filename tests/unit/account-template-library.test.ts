/** Shared template reconciliation preserves concurrent work and applies edits. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AccountTemplateSessions,
  reconcileAccountTemplates,
} from "../../src/main/core/account-template-library.js";
import { AtomicPublicationUnconfirmedError } from "../../src/main/core/atomic-file.js";
import type { AccountTemplateLibrary } from "../../src/shared/contracts.js";

const A = "OQCiUyo8AkVwR4KMMGAAAEAA";
const B = "OQCiUyo8AkVwR4KMMGAAAEAB";
const C = "OQCiUyo8AkVwR4KMMGAAAEAC";
const entry = (path: string, contents: string) => ({ path, contents });

test("merges unrelated shared-template edits", () => {
  assert.deepEqual(
    reconcileAccountTemplates(
      [entry("Skills/A.txt", A)],
      [entry("Skills/A.txt", A), entry("Skills/B.txt", B)],
      [entry("Skills/A.txt", A), entry("Skills/C.txt", C)],
    ),
    [entry("Skills/A.txt", A), entry("Skills/B.txt", B), entry("Skills/C.txt", C)],
  );
});

test("a stale deletion cannot discard a concurrent edit", () => {
  assert.deepEqual(
    reconcileAccountTemplates(
      [entry("Skills/A.txt", A)],
      [entry("Skills/A.txt", B)],
      [],
    ),
    [entry("Skills/A.txt", B)],
  );
});

test("two concurrent edits to one path preserve both contents", () => {
  assert.deepEqual(
    reconcileAccountTemplates(
      [entry("Skills/A.txt", A)],
      [entry("Skills/A.txt", B)],
      [entry("Skills/A.txt", C)],
    ),
    [entry("Skills/A (conflict).txt", C), entry("Skills/A.txt", B)],
  );
});

test("one window's duplicate close cannot delete another window's addition", async () => {
  const sessions = new AccountTemplateSessions<object>();
  const primary = {};
  const alt = {};
  let canonical: AccountTemplateLibrary = { revision: 0, entries: [] };
  let publications = 0;
  const persistence = {
    loadLatest: async () => canonical,
    publish: async (library: AccountTemplateLibrary) => {
      publications += 1;
      canonical = library;
      return library;
    },
  };
  sessions.begin(primary, canonical);
  sessions.begin(alt, canonical);

  await sessions.save(primary, [entry("Skills/Primary.txt", A)], persistence);
  await sessions.save(alt, [entry("Skills/Alt.txt", B)], persistence);
  const revision = canonical.revision;
  await sessions.save(alt, [entry("Skills/Alt.txt", B)], persistence);

  assert.equal(publications, 2);
  assert.equal(canonical.revision, revision);
  assert.deepEqual(canonical.entries, [
    entry("Skills/Alt.txt", B),
    entry("Skills/Primary.txt", A),
  ]);
});

test("an identical duplicate uses the merge path's case-insensitive identity", async () => {
  const sessions = new AccountTemplateSessions<object>();
  const owner = {};
  let canonical: AccountTemplateLibrary = { revision: 0, entries: [] };
  let publications = 0;
  const persistence = {
    loadLatest: async () => canonical,
    publish: async (library: AccountTemplateLibrary) => {
      publications += 1;
      canonical = library;
      return library;
    },
  };
  sessions.begin(owner, canonical);
  await sessions.save(owner, [entry("Skills/Caf\u00e9.txt", A)], persistence);
  await sessions.save(owner, [entry("skills/Cafe\u0301.TXT", A)], persistence);

  assert.equal(publications, 1);
  assert.equal(canonical.revision, 1);
});

test("shared save requires a load and one generation refuses changed resubmission", async () => {
  const sessions = new AccountTemplateSessions<object>();
  const owner = {};
  let canonical: AccountTemplateLibrary = { revision: 0, entries: [] };
  const persistence = {
    loadLatest: async () => canonical,
    publish: async (library: AccountTemplateLibrary) => {
      canonical = library;
      return library;
    },
  };
  await assert.rejects(
    sessions.save(owner, [entry("Skills/A.txt", A)], persistence),
    /must load before/,
  );
  sessions.begin(owner, canonical);
  await sessions.save(owner, [entry("Skills/A.txt", A)], persistence);
  await assert.rejects(
    sessions.save(owner, [entry("Skills/A.txt", B)], persistence),
    /reload before saving again/,
  );
});

test("a failure before publication leaves the generation retryable", async () => {
  const sessions = new AccountTemplateSessions<object>();
  const owner = {};
  let canonical: AccountTemplateLibrary = { revision: 0, entries: [] };
  let attempts = 0;
  sessions.begin(owner, canonical);
  const persistence = {
    loadLatest: async () => canonical,
    publish: async (library: AccountTemplateLibrary) => {
      attempts += 1;
      if (attempts === 1) throw new Error("pre-rename failure");
      canonical = library;
      return library;
    },
  };

  await assert.rejects(
    sessions.save(owner, [entry("Skills/A.txt", A)], persistence),
    /pre-rename failure/,
  );
  await sessions.save(owner, [entry("Skills/A.txt", B)], persistence);
  assert.deepEqual(canonical.entries, [entry("Skills/A.txt", B)]);
});

test("an unconfirmed publication permits only an identical preserving retry", async () => {
  const sessions = new AccountTemplateSessions<object>();
  const owner = {};
  let canonical: AccountTemplateLibrary = { revision: 0, entries: [] };
  let unconfirmed = true;
  sessions.begin(owner, canonical);
  const persistence = {
    loadLatest: async () => canonical,
    publish: async (library: AccountTemplateLibrary) => {
      canonical = library;
      if (unconfirmed) {
        unconfirmed = false;
        throw new AtomicPublicationUnconfirmedError({ cause: new Error("fsync") });
      }
      return library;
    },
  };

  await assert.rejects(
    sessions.save(owner, [entry("Skills/A.txt", A)], persistence),
    AtomicPublicationUnconfirmedError,
  );
  await assert.rejects(
    sessions.save(owner, [entry("Skills/A.txt", B)], persistence),
    /reload before saving changed templates/,
  );
  canonical = {
    revision: canonical.revision + 1,
    entries: [...canonical.entries, entry("Skills/Other.txt", C)],
  };
  const expected = canonical;
  await sessions.save(owner, [entry("Skills/A.txt", A)], persistence);

  assert.deepEqual(canonical, expected);
});

test("renderer replacement and reload own independent merge generations", async () => {
  const sessions = new AccountTemplateSessions<object>();
  const crashedWindow = {};
  const replacementWindow = {};
  let canonical: AccountTemplateLibrary = { revision: 0, entries: [] };
  const persistence = {
    loadLatest: async () => canonical,
    publish: async (library: AccountTemplateLibrary) => {
      canonical = library;
      return library;
    },
  };
  sessions.begin(crashedWindow, canonical);
  await sessions.save(
    crashedWindow,
    [entry("Skills/BeforeCrash.txt", A)],
    persistence,
  );

  sessions.begin(replacementWindow, canonical);
  await sessions.save(
    replacementWindow,
    [...canonical.entries, entry("Skills/Recovered.txt", B)],
    persistence,
  );
  sessions.begin(replacementWindow, canonical);
  await sessions.save(
    replacementWindow,
    [...canonical.entries, entry("Skills/AfterReload.txt", C)],
    persistence,
  );

  assert.deepEqual(canonical.entries.map(({ path }) => path), [
    "Skills/AfterReload.txt",
    "Skills/BeforeCrash.txt",
    "Skills/Recovered.txt",
  ]);
});
