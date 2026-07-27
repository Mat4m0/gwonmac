// P0.4: every Markdown link in this repository resolves to a file that exists.
// These tests run the checker itself, not a regex over its source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  extractLocalTargets,
  findBrokenLinks,
  listMarkdownFiles,
} from "../../scripts/check-markdown-links.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const checker = path.join(root, "scripts/check-markdown-links.ts");

// The checker is TypeScript, and a spawned child inherits none of this
// process's flags, so the loader `pnpm check:links` uses is spelled out here.
// As a file URL rather than the package.json script's relative path: the child
// resolves `--import` against its own working directory, which is the caller's.
const LOADER = [
  "--import",
  pathToFileURL(path.join(root, "scripts/ts-hook.mjs")).href,
  "--experimental-strip-types",
];

const fixtures: string[] = [];
after(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>, { git = false } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-md-links-"));
  fixtures.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  if (git) spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** Runs the entry point `pnpm check` runs, against a fixture repository. */
function runChecker(dir: string) {
  const result = spawnSync(process.execPath, [...LOADER, checker, dir], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

test("no Markdown link in this repository points at a missing file", () => {
  assert.deepEqual(findBrokenLinks(root), []);
});

test("a link to NOPE.md in README.md exits non-zero and names the line", () => {
  const dir = fixture({ "README.md": "# Title\n\nSee [nope](NOPE.md).\n" }, { git: true });

  const { status, stderr } = runChecker(dir);

  assert.equal(status, 1, "a broken README link must fail the check");
  assert.match(stderr, /^README\.md:3: missing link target NOPE\.md$/m);
});

test("a repository whose links all resolve exits zero and says nothing", () => {
  const dir = fixture(
    { "README.md": "See [the guide](docs/guide.md).\n", "docs/guide.md": "" },
    { git: true },
  );

  assert.deepEqual(runChecker(dir), { status: 0, stderr: "" });
});

test("targets are resolved relative to the file that contains them", () => {
  const dir = fixture({
    "docs/guide.md": "[up](../README.md) [here](sibling.md) [rooted](/README.md) [gone](../TOP.md)",
    "docs/sibling.md": "",
    "README.md": "",
  });

  assert.deepEqual(
    findBrokenLinks(dir, ["docs/guide.md"]),
    [{ file: "docs/guide.md", line: 1, target: "../TOP.md" }],
  );
});

test("percent-encoded, titled and fragment-suffixed targets resolve to the real path", () => {
  const dir = fixture({
    "index.md": '[a](my%20doc.md#top) [b](other.md?v=1) [c](other.md "Title")',
    "my doc.md": "",
    "other.md": "",
  });

  assert.deepEqual(findBrokenLinks(dir, ["index.md"]), []);
});

test("an unbracketed destination containing a space is not a link", () => {
  // `[b](my doc.md)` is not a CommonMark link; reporting `my` as missing would
  // be a false positive that forces prose to be rewritten around the checker.
  assert.deepEqual(extractLocalTargets("[b](my doc.md)"), []);
});

test("link syntaxes that carry a target are all extracted", () => {
  const targets = extractLocalTargets(
    [
      "[inline](a.md)",
      "![image](img/b.png)",
      "[ref]: c.md",
      '<a href="d.md">x</a> <img src="e.png">',
      "<a href='single.md'>x</a>",
      "[angled](<f g.md>)",
      "[![badge](img/shield.svg)](setup.md)",
    ].join("\n"),
  ).map((found) => found.target);

  assert.deepEqual(targets, [
    "a.md",
    "img/b.png",
    "c.md",
    "d.md",
    "e.png",
    "single.md",
    "f g.md",
    "img/shield.svg",
    "setup.md",
  ]);
});

test("a badge link reports the outer destination, not only the image it wraps", () => {
  // The common README shape. Extracting the image alone would let the document's
  // front-door link rot silently.
  const dir = fixture({
    "README.md": "[![build](docs/badge.svg)](docs/MISSING.md)\n",
    "docs/badge.svg": "",
  });

  assert.deepEqual(findBrokenLinks(dir, ["README.md"]), [
    { file: "README.md", line: 1, target: "docs/MISSING.md" },
  ]);
});

test("a tracked file deleted from the working tree is skipped, not fatal", () => {
  // `git ls-files --cached` still lists it between `rm` and `git add`. Reading
  // it would throw ENOENT and bury the broken links the deletion just created.
  const dir = fixture({ "README.md": "See [gone](docs/gone.md).\n" }, { git: true });
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "docs/gone.md"), "");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  fs.rmSync(path.join(dir, "docs/gone.md"));

  const { status, stderr } = runChecker(dir);

  assert.equal(status, 1);
  assert.match(stderr, /^README\.md:1: missing link target docs\/gone\.md$/m);
});

test("an existing target outside the repository is broken", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "gw-md-parent-"));
  fixtures.push(parent);
  const dir = path.join(parent, "repo");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(parent, "outside.md"), "");
  fs.writeFileSync(path.join(dir, "README.md"), "[outside](../outside.md)\n");
  spawnSync("git", ["init", "-q"], { cwd: dir });

  assert.deepEqual(findBrokenLinks(dir), [
    { file: "README.md", line: 1, target: "../outside.md" },
  ]);
});

test("an ignored target is broken even while it exists locally", () => {
  const dir = fixture(
    {
      ".gitignore": "private/\n",
      "README.md": "[private](private/note.md)\n",
      "private/note.md": "",
    },
    { git: true },
  );

  assert.deepEqual(findBrokenLinks(dir), [
    { file: "README.md", line: 1, target: "private/note.md" },
  ]);
});

test("a repository directory target has at least one durable child", () => {
  const dir = fixture(
    {
      "README.md": "[docs](docs)\n[empty](empty)\n",
      "docs/guide.md": "",
      "empty/.gitignore": "*\n",
    },
    { git: true },
  );

  assert.deepEqual(findBrokenLinks(dir), [
    { file: "README.md", line: 2, target: "empty" },
  ]);
});

test("code blocks, code spans, URLs and bare anchors are not treated as links", () => {
  const targets = extractLocalTargets(
    [
      "```md",
      "[fenced](nope.md)",
      "```",
      "`[span](nope.md)`",
      "[url](https://example.com/nope.md)",
      "[mail](mailto:someone@example.com)",
      "[anchor](#section)",
      "[protocol-relative](//example.com/nope.md)",
      "[real](yes.md)",
    ].join("\n"),
  ).map((found) => found.target);

  assert.deepEqual(targets, ["yes.md"]);
});

test("the file list covers tracked docs and excludes gitignored scratch", () => {
  const files = listMarkdownFiles(root);

  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("PRODUCT.md"));
  assert.ok(files.includes("docs/internals.md"));
  assert.ok(
    files.every((file) => !file.startsWith("plans/") && !file.startsWith("node_modules/")),
    "gitignored paths must not be scanned",
  );
});
