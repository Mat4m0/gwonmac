// Source proof for the negative half of secret persistence: the two native
// Keychain items are the only persistent surface, and no browser/file fallback
// can silently become a second home.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  DISTRIBUTION_CHANNELS,
} from "../../src/shared/distribution-channel.ts";

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
// Geometry is the sole Core browser-storage owner. Remove only these exact calls
// from the secret-surface check; any new key, argument or storage API still fails.
const hubPlacement = read("src/renderer/hub-window.ts");
const placementCalls = /localStorage\.(?:getItem\(storageKey\)|setItem\(storageKey, value\)|removeItem\(storageKey\))/gu;
const withoutPlacementStorage = shippedSources().map(file => file === "src/renderer/hub-window.ts"
  ? read(file).replace(placementCalls, "approvedPlacementCall") : read(file)).join("\n");
const legacyFilenameOwners = shippedSources().filter((file) =>
  /credentials\.bin|steam-session\.bin/u.test(read(file)),
);
const main = read("src/main/main.ts");
const profileStorage = read("src/main/core/profile-storage.ts");
const native = read("src/native/host/host.mm");
const legacyCleanup = read("src/main/core/legacy-secret-cleanup.ts");

test("saved login has exactly two Data Protection Keychain items", () => {
  assert.match(native, /kSecUseDataProtectionKeychain/);
  assert.match(native, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  for (const channel of DISTRIBUTION_CHANNELS) {
    const bundleId = DISTRIBUTION_CHANNEL_CONFIG[channel].bundleId;
    assert.equal(
      (native.match(new RegExp(`@"${bundleId.replaceAll(".", "\\.")}"`, "gu")) ?? [])
        .length,
      1,
    );
  }
  assert.equal((native.match(/@"arena-net-credentials"/gu) ?? []).length, 1);
  assert.equal((native.match(/@"steam-session"/gu) ?? []).length, 1);
  assert.doesNotMatch(shippedApplication, /safeStorage|encryptString|decryptString/);
  assert.deepEqual(legacyFilenameOwners, [
    "src/main/core/legacy-secret-cleanup.ts",
  ]);
  assert.doesNotMatch(legacyCleanup, /recursive\s*:|clearStorageData|IndexedDB|IDBFS/);
  assert.match(legacyCleanup, /remove\(path\.join\(userData, filename\), \{ force: true \}\)/);
  assert.doesNotMatch(withoutPlacementStorage, /localStorage|sessionStorage/);
  assert.doesNotMatch(shippedApplication, /plaintext|fallbackKey|masterPassword/);
});

test("only provisioned distribution channels enable persistent secrets", () => {
  assert.match(main, /const distributionChannel = packagedDistributionChannel\(\)/);
  assert.match(main, /distributionCapabilities\(distributionChannel\)/);
  assert.match(
    main,
    /const persistentSecrets =\s*app\.isPackaged\s*&& distribution\.persistentSecrets\s*&& !app\.commandLine\.hasSwitch\("gw-volatile-secrets"\)/,
  );
  assert.match(
    main,
    /const adoptedStorage = resolveAdoptedProfileStorage\(accountWorkspace, paths\)/,
  );
  assert.match(
    main,
    /if \(\s*adoptedStorage\s*&& persistentSecrets\s*&& distribution\.cleanupLegacySecrets\s*\) \{[\s\S]{0,200}cleanupLegacySecretFiles/,
  );
  assert.match(profileStorage, /workspace\.legacyPrimaryProfileId/);
  assert.doesNotMatch(main, /accountWorkspace\.legacyPrimaryProfileId/);
  assert.match(main, /capable: distribution\.automaticUpdates/);
  assert.match(main, /persistentSecrets\s*\? nativeHost/);
  assert.match(main, /: new VolatileNativeKeychain\(\)/);
  assert.doesNotMatch(shippedApplication, /use-mock-keychain/);
});

test("no build seeds the Steam token from the environment", () => {
  const readers = shippedSources().filter((file) =>
    /GW_STEAM_TOKEN|process\.env\.[A-Za-z_]*STEAM/u.test(read(file)),
  );
  assert.deepEqual(readers, []);
});


test("Core browser persistence is limited to validated Hub geometry", () => {
  assert.match(hubPlacement, /const storageKey = 'gwonmac\.hub-window-placement';/);
  assert.equal([...hubPlacement.matchAll(placementCalls)].length, 3);
  assert.match(hubPlacement, /const value = serializeFloatingWindowPlacement\(panel\.getBoundingClientRect\(\), viewport\(\)\);/);
  assert.match(hubPlacement, /restoreFloatingWindowPlacement\(localStorage\.getItem\(storageKey\), viewport\(\), \{ width: 340, height: 300 \}\)/);
  assert.doesNotMatch(read("src/shared/ui/window-placement.ts"), /password|credential|sessionStorage|localStorage/iu);
});
