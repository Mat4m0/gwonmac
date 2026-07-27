// Reads repository text, and says so in its filename. P5.6 made the preload's
// channel constants generated from src/shared/contracts.ts; this is the one
// assertion that keeps them generated. A `"gw:…"` literal back in the body
// would be a reintroduced copy — the generator would still splice the canonical
// `IPC`, the copy would shadow or shadow-compete with it, and nothing else
// would notice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the hand-written preload body contains no channel literal", () => {
  const body = readFileSync(
    path.join(root, "src/preload/preload.body.cjs"),
    "utf8",
  );
  const copied = [...body.matchAll(/(["'`])(gw:[^"'`]*)\1/gu)].map(
    ([, , literal]) => literal,
  );
  assert.deepEqual(
    copied,
    [],
    "channel names belong in src/shared/contracts.ts; the generator splices them in",
  );
});

test("the body declares nothing the generator is meant to supply", async () => {
  const { PRELOAD_CONSTANTS } = await import(
    "../../scripts/generate-preload.mjs"
  );
  const body = readFileSync(
    path.join(root, "src/preload/preload.body.cjs"),
    "utf8",
  );
  for (const name of PRELOAD_CONSTANTS) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, "u"),
      `${name} is declared in the body and spliced in as well`,
    );
    assert.match(body, new RegExp(`\\b${name}\\b`, "u"), `${name} is spliced in but unused`);
  }
});
