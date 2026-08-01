// Reads repository text, and says so in its filename. A module that opens on
// its import block tells a reader what it uses and never what it owns, so the
// first question about any file — what is mine, and what do I refuse? — could
// only be answered by reading the whole file and inferring. That inference is
// how two modules end up owning the same invariant.
//
// The rule is deliberately about presence, not content: a test cannot tell a
// truthful header from a plausible one. What it can do is make the absence of
// one a build failure rather than something a reviewer has to notice.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SOURCE = /^src\/.+\.(?:m|c)?ts$/u;

// Files that genuinely cannot carry a header, each with the reason. It is
// empty, and the staleness assertion below keeps it that way: an entry that
// stops being needed fails rather than lingering as permission nobody rechecks.
//
// `src/preload/preload.body.cjs` is not here because it is not in scope. It is
// CommonJS — the sandbox loader executes no ESM preload graph — and it does
// carry its own header; `scripts/generate-preload.ts`, which splices the
// canonical constants above it, carries the header for the generated file.
const KNOWN_UNHEADERED: { reason: string; files: string[] }[] = [];

const excused = new Map(
  KNOWN_UNHEADERED.flatMap(({ reason, files }) => files.map((file) => [file, reason])),
);

// Enumerated from git rather than from a literal list, because the file added
// tomorrow is the one this test exists to catch. Untracked files that are not
// ignored count too, so an escape is caught in the working tree that created it
// rather than one commit later.
const sources = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => SOURCE.test(file))
  .filter((file) => existsSync(path.join(root, file)));

const MINIMUM_HEADER_LINES = 2;

/**
 * The leading block doc comment's content lines, or `null` when the file does
 * not open with one.
 *
 * Anchored at offset zero: a header below the imports is not a header, because
 * a reader who has already read the imports has stopped asking. `/*` is not
 * accepted either — the doc form is what an editor surfaces and what the rest
 * of the repository uses, and two spellings would be two conventions.
 */
function headerLines(text: string): string[] | null {
  if (!text.startsWith("/**")) return null;
  const end = text.indexOf("*/");
  if (end < 0) return null;
  return text
    .slice("/**".length, end)
    .split("\n")
    .map((line) => line.replace(/^\s*\*?/u, "").trim())
    .filter((line) => line.length > 0);
}

test("every source module opens with a block doc comment", () => {
  const bare = sources
    .filter((file) => !excused.has(file))
    .filter((file) => {
      const lines = headerLines(readFileSync(path.join(root, file), "utf8"));
      return lines === null || lines.length < MINIMUM_HEADER_LINES;
    });
  assert.deepEqual(
    bare,
    [],
    `${bare.length} module(s) start with no leading doc comment of at least ` +
      `${MINIMUM_HEADER_LINES} lines saying what they own: ${bare.join(", ")}`,
  );
});

test("every KNOWN_UNHEADERED entry still names a file that still lacks one", () => {
  const stale = [...excused.keys()].filter((file) => {
    if (!sources.includes(file)) return true;
    const lines = headerLines(readFileSync(path.join(root, file), "utf8"));
    return lines !== null && lines.length >= MINIMUM_HEADER_LINES;
  });
  assert.deepEqual(
    stale,
    [],
    `KNOWN_UNHEADERED is out of date; delete these entries: ${stale.join(", ")}`,
  );
});
