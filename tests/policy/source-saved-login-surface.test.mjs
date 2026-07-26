// Reads repository text, and says so in its filename.
//
// AGENTS.md makes a negative claim about saved login: it lives in one encrypted
// owner-only file and nowhere else. `CredentialsStore` is executed in
// tests/unit/credentials.test.ts, and what it does with the file it is given is
// proved there. What no test can execute is the *absence* of a second store —
// a `localStorage.setItem` added to the renderer would break no test, because
// there is no test that a line of code was never written. This scan is that
// test, and it is honest about being one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// Every file a credential can pass through: the boundary, the store, both path
// modules, the bridge, the contracts, and the renderer that asks for it.
const surface = [
  "src/main/ipc.ts",
  "src/main/core/credentials.ts",
  "src/main/paths.ts",
  "src/main/core/paths.ts",
  "src/preload/preload.body.cjs",
  "src/shared/contracts.ts",
  "src/renderer/harness.js",
]
  .map(read)
  .join("\n");

test("saved login has one encrypted owner-only persistence surface", () => {
  assert.match(surface, /safeStorage/);
  assert.match(surface, /credentials\.bin/);
  assert.match(surface, /encryptString/);
  assert.match(surface, /writeAtomic\(this\.path, ciphertext, 0o600\)/);
  assert.doesNotMatch(surface, /localStorage|sessionStorage/);
  assert.doesNotMatch(surface, /plaintext|fallbackKey|masterPassword/);
  // The three game-facing methods reach the one store, and no fourth path.
  assert.match(
    surface,
    /secureStorage:[\s\S]*getCredentials[\s\S]*storeCredentials[\s\S]*clearCredentials/,
  );
});

test("the ad-hoc build's mock keychain is installed before Electron is ready", () => {
  // Ordering, not existence: `appendSwitch` after `whenReady` is a silent
  // no-op, and the symptom is an OS keychain prompt on a user's machine.
  const main = read("src/main/main.ts");
  assert.match(main, /appendSwitch\("use-mock-keychain"\)/);
  assert.match(main, /clearStorageData\(\{ storages: \["cookies"\] \}\)/);
  assert.ok(
    main.indexOf('appendSwitch("use-mock-keychain")') <
      main.indexOf("app.whenReady()"),
    "mock keychain switch must be installed before Electron becomes ready",
  );
});
