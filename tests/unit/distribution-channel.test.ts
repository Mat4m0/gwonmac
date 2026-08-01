import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLE_TEAM_ID,
  applicationIdentifier,
  DISTRIBUTION_CHANNEL_CONFIG,
  DISTRIBUTION_CHANNELS,
  distributionCapabilities,
  distributionMarker,
  parseDistributionMarker,
} from "../../src/shared/distribution-channel.ts";
import { RELEASE_REPO } from "../../src/shared/project-identity.ts";

test("distribution channels derive the complete capability matrix", () => {
  assert.deepEqual(distributionCapabilities("release"), {
    persistentSecrets: true,
    cleanupLegacySecrets: true,
    automaticUpdates: true,
  });
  for (const channel of ["preview", "development"] as const) {
    assert.deepEqual(distributionCapabilities(channel), {
      persistentSecrets: true,
      cleanupLegacySecrets: false,
      automaticUpdates: false,
    });
  }
  assert.deepEqual(distributionCapabilities(null), {
    persistentSecrets: false,
    cleanupLegacySecrets: false,
    automaticUpdates: false,
  });
});

test("distribution markers accept only the closed canonical shape", () => {
  assert.deepEqual(
    parseDistributionMarker(distributionMarker("preview")),
    {
      schema: 1,
      repository: RELEASE_REPO,
      channel: "preview",
    },
  );
  for (const malformed of [
    null,
    [],
    {},
    { schema: 2, repository: RELEASE_REPO, channel: "release" },
    { schema: 1, repository: "someone/else", channel: "release" },
    { schema: 1, repository: RELEASE_REPO, channel: "nightly" },
    {
      schema: 1,
      repository: RELEASE_REPO,
      channel: "release",
      persistentSecrets: true,
    },
  ]) {
    assert.equal(parseDistributionMarker(malformed), null);
  }
});

test("provisioned channels have distinct application identities", () => {
  const configs = DISTRIBUTION_CHANNELS.map(
    (channel) => DISTRIBUTION_CHANNEL_CONFIG[channel],
  );
  assert.equal(new Set(configs.map(({ bundleId }) => bundleId)).size, 3);
  assert.equal(
    new Set(DISTRIBUTION_CHANNELS.map(applicationIdentifier)).size,
    3,
  );
  for (const channel of DISTRIBUTION_CHANNELS) {
    const config = DISTRIBUTION_CHANNEL_CONFIG[channel];
    assert.equal(
      applicationIdentifier(channel),
      `${APPLE_TEAM_ID}.${config.bundleId}`,
    );
  }
});
