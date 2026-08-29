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
    /(^|\/)guild-wars-diagnostics[^/]*\.zip$/i,
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
  // The whole subsystem, enumerated from git: its entry point composes the
  // modules beneath it, and a crash-dump API reached from any of them would
  // ship just as surely as one written in the entry point itself.
  const subsystem = tracked.filter(
    (file) =>
      file === "src/main/diagnostics.ts" ||
      file.startsWith("src/main/diagnostics/"),
  );
  assert.ok(subsystem.length > 1, "the diagnostics subsystem is not tracked");
  for (const file of subsystem) {
    assert.doesNotMatch(
      readFileSync(path.join(root, file), "utf8"),
      /crashReporter|crashDumps|\.dmp/u,
      file,
    );
  }
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

test("no private key material is tracked", () => {
  // Signing credentials live outside the tree. Tests need no private-key
  // fixture, so any encoded private key is a mistake rather than a special
  // case.
  const material = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
  const hits = tracked.filter((file) => {
    if (file === "tests/policy/forbidden-artifacts.test.ts") return false;
    try {
      return material.test(readFileSync(path.join(root, file), "utf8"));
    } catch {
      return false;
    }
  });
  assert.deepEqual(hits, []);
});

test("only public identifiers and explicit profile-id fixtures are UUID-shaped", () => {
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  // One entry, the public client access key. The RFC 6455 WebSocket GUID used
  // to sit beside it; it belonged to the retired Python runtime's relay and
  // matches nothing in the tree, so it is gone.
  const allowed = new Set([
    "2043FE79-F32D-4FD7-8C27-0D47231C4F03",
    // Public reserved identity for the released default-session owner.
    "9E1BD41C-CFC0-4CA8-A57F-2F0CA159C72D",
  ]);
  const profileIdFixtures = new Set([
    "tests/electron/multiple-accounts.spec.ts",
    "tests/electron/profile-close.spec.ts",
    "tests/helpers/launcher-profile-fixtures.ts",
    "tests/release/preload-behaviour.test.ts",
    "tests/unit/account-profile-creation.test.ts",
    "tests/unit/account-workspace-bootstrap.test.ts",
    "tests/unit/credentials.test.ts",
    "tests/unit/launcher-orchestrator.test.ts",
    "tests/unit/launcher-state.test.ts",
    "tests/unit/multiple-accounts.test.ts",
    "tests/unit/native-keychain.test.ts",
    "tests/unit/paths.test.ts",
    "tests/unit/profile-storage.test.ts",
    "tests/unit/window-registry.test.ts",
    "tests/unit/window-coordinator.test.ts",
  ]);
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
      if (
        !allowed.has(match[0].toUpperCase())
        && !profileIdFixtures.has(file)
      ) hits.push(`${file}:${match[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});
