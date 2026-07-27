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
    [
      "client-canary.yml",
      "macos-verify.yml",
      "publish-snapshot.yml",
      "release.yml",
      "tester-build.yml",
      "website.yml",
    ],
    "a workflow was added or removed; confirm it is covered here",
  );

  const unpinned: string[] = [];
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
  assert.deepEqual(
    found.filter((reference) => pinned.test(reference)),
    [],
    "a floating tag must not read as pinned",
  );
});

/** Yields [line, lineNumber, reference] for every `uses:` step in a workflow. */
function* eachUses(
  text: string,
): Generator<[line: string, lineNumber: number, reference: string]> {
  for (const [index, line] of text.split("\n").entries()) {
    const reference = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/)?.[1];
    if (reference !== undefined) yield [line, index + 1, reference];
  }
}
