/**
 * Exercises the real Windows Credential Manager addon with synthetic values.
 * It is deliberately restricted to a fresh GitHub-hosted runner: the addon's
 * closed production namespaces make a local runtime probe unsafe for a player.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { multiSecretSlot, SINGLE_SECRET_SLOTS, type SecretSlot } from "../src/main/core/native-keychain.js";
import { loadWindowsNativeHost, WindowsCredentialKeychain } from "../src/main/windows-native-host.js";
import { DISTRIBUTION_CHANNELS } from "../src/shared/distribution-channel.js";
import { parseProfileId } from "../src/shared/multiple-accounts.js";

if (
  process.platform !== "win32"
  || process.env.GITHUB_ACTIONS !== "true"
  || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
) {
  throw new Error(
    "The Windows credential probe runs only on a fresh GitHub-hosted Windows runner",
  );
}

const host = loadWindowsNativeHost({
  packaged: false,
  appPath: process.cwd(),
  resourcesPath: "unused",
});
const profile = parseProfileId("917e78f3-2d6a-46ad-9142-51ba6c50ccf4");
const peerProfile = parseProfileId("8d4644cf-9535-4307-8049-388351d40716");
const isolationSlot: SecretSlot = "arenaNetCredentials";
const profileIsolationSlot = multiSecretSlot(profile, "arenaNetCredentials");
const peerProfileSlot = multiSecretSlot(peerProfile, "arenaNetCredentials");
const slots: readonly SecretSlot[] = [
  ...SINGLE_SECRET_SLOTS,
  profileIsolationSlot,
  multiSecretSlot(profile, "steamSession"),
  peerProfileSlot,
  multiSecretSlot(peerProfile, "steamSession"),
];
const touched: Array<{
  keychain: WindowsCredentialKeychain;
  slot: SecretSlot;
}> = [];

try {
  assert.match(host.localAppData(), /^[A-Za-z]:\\/u);

  for (const channel of DISTRIBUTION_CHANNELS) {
    const keychain = new WindowsCredentialKeychain(host, channel);
    for (const slot of slots) {
      assert.equal(
        await keychain.load(slot),
        null,
        `refusing to overwrite an occupied ${channel}/${slot} credential`,
      );
    }
  }

  for (const channel of DISTRIBUTION_CHANNELS) {
    const keychain = new WindowsCredentialKeychain(host, channel);
    for (const slot of slots) {
      const initial = randomBytes(48);
      const replacement = randomBytes(64);
      await keychain.save(slot, initial);
      touched.push({ keychain, slot });
      assert.deepEqual(await keychain.load(slot), initial);
      await keychain.save(slot, replacement);
      assert.deepEqual(await keychain.load(slot), replacement);
      initial.fill(0);
      replacement.fill(0);
    }
  }

  const release = new WindowsCredentialKeychain(host, "release");
  const development = new WindowsCredentialKeychain(host, "development");
  await release.clear(isolationSlot);
  assert.notEqual(
    await development.load(isolationSlot),
    null,
    "clearing Release must not clear Development",
  );
  await release.clear(profileIsolationSlot);
  assert.notEqual(
    await release.load(peerProfileSlot),
    null,
    "clearing one profile must not clear another",
  );

  globalThis.console.log(JSON.stringify({
    platform: process.platform,
    localAppData: "resolved",
    channels: DISTRIBUTION_CHANNELS.length,
    slotsPerChannel: slots.length,
    results: {
      emptyNamespaceGuard: "passed",
      roundTrip: "passed",
      replacement: "passed",
      channelIsolation: "passed",
      profileIsolation: "passed",
    },
    unproven: [
      "signed installer replacement",
      "installed application identity",
      "credential persistence across reboot",
    ],
  }, null, 2));
} finally {
  // Keep cleanup deterministic and surface the first Credential Manager error.
  // Promise.allSettled hid failed deletions and made the later assertion look
  // like a persistence bug instead of reporting the operation that failed.
  for (const { keychain, slot } of touched) {
    await keychain.clear(slot);
  }
  for (const channel of DISTRIBUTION_CHANNELS) {
    const keychain = new WindowsCredentialKeychain(host, channel);
    for (const slot of slots) {
      assert.equal(await keychain.load(slot), null, `${channel}/${slot} was not cleared`);
    }
  }
}
