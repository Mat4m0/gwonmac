// Source proof for the negative half of secret persistence: the two native
// Keychain items are the only persistent surface, and no browser/file fallback
// can silently become a second home.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function shippedSources(directory = "src"): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return shippedSources(child);
      return /\.(?:ts|mts|mjs|tsx|cjs|js|jsx|mm)$/u.test(entry.name) ? [child] : [];
    });
}

const shippedApplication = shippedSources().map(read).join("\n");
const main = read("src/main/main.ts");
const native = read("src/native/keychain/keychain.mm");

test("saved login has exactly two Data Protection Keychain items", () => {
  assert.match(native, /kSecUseDataProtectionKeychain/);
  assert.match(native, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(native, /@"io\.github\.mat4m0\.gwonmac"/);
  assert.equal((native.match(/@"arena-net-credentials"/gu) ?? []).length, 1);
  assert.equal((native.match(/@"steam-session"/gu) ?? []).length, 1);
  assert.doesNotMatch(shippedApplication, /safeStorage|encryptString|decryptString/);
  assert.doesNotMatch(shippedApplication, /credentials\.bin|steam-session\.bin/);
  assert.doesNotMatch(shippedApplication, /localStorage|sessionStorage/);
  assert.doesNotMatch(shippedApplication, /plaintext|fallbackKey|masterPassword/);
});

test("only the official release capability enables persistent secrets", () => {
  assert.match(main, /const officialUpdaterCapability = officialUpdaterCapable\(\)/);
  assert.match(
    main,
    /const persistentSecrets =\s*app\.isPackaged\s*&& officialUpdaterCapability\s*&& !app\.commandLine\.hasSwitch\("gw-adhoc-test-keychain"\)/,
  );
  assert.match(main, /persistentSecrets\s*\? loadNativeKeychain/);
  assert.match(main, /: new VolatileNativeKeychain\(\)/);
  assert.doesNotMatch(shippedApplication, /use-mock-keychain/);
});

test("no build seeds the Steam token from the environment", () => {
  const readers = shippedSources().filter((file) =>
    /GW_STEAM_TOKEN|process\.env\.[A-Za-z_]*STEAM/u.test(read(file)),
  );
  assert.deepEqual(readers, []);
});
