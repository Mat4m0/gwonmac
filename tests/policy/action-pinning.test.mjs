// Supply-chain policy: a GitHub Action referenced by a floating tag can be
// re-pointed by its owner at any time. Every third-party action this repository
// runs must be pinned to a full 40-character commit SHA.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowDirectory = path.join(root, ".github/workflows");
const workflows = readdirSync(workflowDirectory).filter((file) =>
  /\.ya?ml$/.test(file),
);

const pinned = /^[^@\s]+\/[^@\s]+@[0-9a-f]{40}$/;

test("every workflow action is pinned to a full commit SHA", () => {
  assert.deepEqual(
    workflows.sort(),
    ["client-canary.yml", "release.yml", "website.yml"],
    "a workflow was added or removed; confirm it is covered here",
  );

  const unpinned = [];
  let total = 0;
  for (const file of workflows) {
    const text = readFileSync(path.join(workflowDirectory, file), "utf8");
    for (const [, lineNumber, reference] of eachUses(text)) {
      total += 1;
      // Local composite actions live in this repository and need no pin.
      if (reference.startsWith("./")) continue;
      if (!pinned.test(reference)) unpinned.push(`${file}:${lineNumber} ${reference}`);
    }
  }

  assert.ok(total > 0, "no `uses:` references were found; the scan is broken");
  assert.deepEqual(unpinned, []);
});

test("the pinning scan rejects a floating tag", () => {
  const floating = "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n";
  const found = [...eachUses(floating)].map(([, , reference]) => reference);
  assert.deepEqual(found, ["actions/checkout@v4"]);
  assert.equal(pinned.test(found[0]), false);
});

/**
 * Yields [line, lineNumber, reference] for every `uses:` step in a workflow.
 * @param {string} text
 */
function* eachUses(text) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
    if (match) yield [lines[index], index + 1, match[1]];
  }
}
