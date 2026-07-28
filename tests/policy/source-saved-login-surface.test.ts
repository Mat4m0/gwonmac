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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** Every source file the application ships, repo-relative. */
function shippedSources(directory = "src"): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return shippedSources(child);
      return /\.(?:ts|mts|cjs|js)$/u.test(entry.name) ? [child] : [];
    });
}

// Every file a credential can pass through: the boundary, the store, the
// shared mechanism underneath it, both path modules, the bridge, the
// contracts, and the renderer that asks for it.
//
// `encrypted-store.ts` is on this list because the encrypt / atomic-write /
// chmod mechanism lives there now — `CredentialsStore` and `SteamSessionStore`
// are both thin instances of it. `steam-session.ts` is here because the Steam
// token is a second secret held to the same invariant, and a scan that only
// looked at credentials would not notice a second store growing a weaker home.
const surface = [
  "src/main/ipc.ts",
  "src/main/core/credentials.ts",
  "src/main/core/encrypted-store.ts",
  "src/main/core/steam-session.ts",
  "src/main/paths.ts",
  "src/main/core/paths.ts",
  "src/preload/preload.body.cjs",
  "src/shared/contracts.ts",
  "src/renderer/harness.ts",
]
  .map(read)
  .join("\n");

test("saved login has one encrypted owner-only persistence surface", () => {
  assert.match(surface, /safeStorage/);
  assert.match(surface, /credentials\.bin/);
  assert.match(surface, /steam-session\.bin/);
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

test("no build seeds the Steam token from the environment", () => {
  // R23 / AE11, and the reason this is a source scan rather than a launch: a
  // test that starts the app with `GW_STEAM_TOKEN` set and observes nothing
  // happen proves only that nothing happened *that time*. The claim is that no
  // code reads it, and absence has no executable form.
  //
  // An earlier design shipped exactly this variable to bootstrap login before
  // acquisition worked, as a documented security deviation. Acquisition is the
  // acquisition path now, so the deviation is gone and this keeps it gone.
  const readers = shippedSources().filter((file) =>
    /GW_STEAM_TOKEN|process\.env\.[A-Za-z_]*STEAM/u.test(read(file)),
  );
  assert.deepEqual(
    readers,
    [],
    "the Steam token has one home, the encrypted store — no environment variable may seed it",
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
