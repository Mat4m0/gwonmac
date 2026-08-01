// Repository-contents policy: no ArenaNet binary, generated output, credential,
// diagnostic export or retired runtime is ever tracked in git, and every
// tracked path stays inside the repository.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file && existsSync(path.join(root, file)));

test("no downloaded game artifacts or generated output are tracked", () => {
  const forbidden = [
    /\.key$/i,
    /\.apk$/i,
    /\.wasm$/i,
    /(^|\/)Gw\.js$/i,
    /(^|\/)Gw\.jspi\.js$/i,
    /(^|\/)Gw\.snapshot$/i,
    /(^|\/)(manifest|version)\.json$/i,
    /\.gwdiag$/i,
    /\.dmp$/i,
    /(^|\/)credentials\.bin$/i,
    /^(build|out|node_modules|gwpatch-cache)\//i,
  ];
  const hits = tracked.filter((file) => forbidden.some((pattern) => pattern.test(file)));
  assert.deepEqual(hits, []);
});

test("no tracked symlink resolves outside the repository", () => {
  // A symlink is tracked as its target string, so a target above the root
  // resolves to whatever happens to sit at that path on the machine that wrote
  // it and dangles on every other clone. `tracked` cannot answer this: it drops
  // dangling entries, which is exactly the state such a link is usually in.
  const escaping = execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.startsWith("120000 "))
    .map((line) => line.slice(line.indexOf("\t") + 1))
    .filter((file) => {
      const link = execFileSync("git", ["cat-file", "blob", `:${file}`], {
        cwd: root,
        encoding: "utf8",
      });
      const target = path.resolve(root, path.dirname(file), link);
      return target !== root && !target.startsWith(root + path.sep);
    });
  assert.deepEqual(escaping, []);
});

test("the application does not collect process-memory crash dumps", () => {
  const diagnostics = readFileSync(
    path.join(root, "src/main/diagnostics.ts"),
    "utf8",
  );
  assert.doesNotMatch(diagnostics, /crashReporter|crashDumps|\.dmp/u);
});

test("no second production runtime remains", () => {
  for (const file of [
    "gw.py",
    "gw.command",
    "gwpatch.py",
    "getsnapshot.py",
    "harness/index.html",
  ]) {
    assert.equal(tracked.includes(file), false, `${file} is still tracked`);
  }
});

test("only the public client access key is UUID-shaped", () => {
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  // One entry, the public client access key. The RFC 6455 WebSocket GUID used
  // to sit beside it; it belonged to the retired Python runtime's relay and
  // matches nothing in the tree, so it is gone.
  const allowed = new Set(["2043FE79-F32D-4FD7-8C27-0D47231C4F03"]);
  const hits = [];
  for (const file of tracked) {
    if (file === "tests/policy/forbidden-artifacts.test.ts") continue;
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(uuid)) {
      if (!allowed.has(match[0].toUpperCase())) hits.push(`${file}:${match[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});
