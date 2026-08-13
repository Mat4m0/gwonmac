/** Shared template reconciliation preserves concurrent work and applies edits. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileAccountTemplates } from "../../src/main/core/account-template-library.js";

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
