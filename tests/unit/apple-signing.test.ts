import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  distributionOptionsForFile,
  ignoreRedundantSigningTarget,
  type AppleSigningEvidence,
  validateAppleSigningEvidence,
} from "../../scripts/apple-signing.ts";
import {
  APPLE_TEAM_ID,
  applicationIdentifier,
  DISTRIBUTION_CHANNEL_CONFIG,
  DISTRIBUTION_CHANNELS,
  type DistributionChannel,
} from "../../src/shared/distribution-channel.ts";

const IDENTITY = "0123456789ABCDEF0123456789ABCDEF01234567";
const NOW = Date.UTC(2026, 7, 1);

function evidence(
  channel: DistributionChannel,
  overrides: Partial<AppleSigningEvidence> = {},
): AppleSigningEvidence {
  const certificateName =
    DISTRIBUTION_CHANNEL_CONFIG[channel].signingKind === "developer-id"
      ? "Developer ID Application: Example"
      : "Apple Development: Example";
  return {
    entitlements: {
      "com.apple.security.cs.allow-jit": true,
      "com.apple.security.device.audio-input": true,
      "com.apple.application-identifier": applicationIdentifier(channel),
      "com.apple.developer.team-identifier": APPLE_TEAM_ID,
    },
    profileApplicationIdentifier: applicationIdentifier(channel),
    profileDeveloperTeamIdentifier: APPLE_TEAM_ID,
    profileTeamIdentifiers: [APPLE_TEAM_ID],
    profileExpiresAt: NOW + 86_400_000,
    certificates: [
      {
        subject: `CN=${certificateName}`,
        validTo: NOW + 86_400_000,
        fingerprint: IDENTITY,
      },
    ],
    availableIdentityFingerprints: [IDENTITY],
    ...overrides,
  };
}

test("signing evidence accepts each channel's exact Apple identity", () => {
  for (const channel of DISTRIBUTION_CHANNELS) {
    assert.doesNotThrow(() =>
      validateAppleSigningEvidence(channel, IDENTITY, evidence(channel), NOW),
    );
  }
});

test("signing evidence fails closed on every identity boundary", () => {
  const channel = "preview";
  const cases: readonly [Partial<AppleSigningEvidence>, RegExp][] = [
    [
      { entitlements: { "com.apple.security.cs.allow-jit": true } },
      /exact approved allowlist/u,
    ],
    [
      {
        entitlements: {
          ...(evidence(channel).entitlements as Record<string, unknown>),
          "get-task-allow": true,
        },
      },
      /exact approved allowlist/u,
    ],
    [{ profileApplicationIdentifier: "wrong.app" }, /does not authorize/u],
    [{ profileDeveloperTeamIdentifier: "WRONGTEAM" }, /does not authorize/u],
    [{ profileTeamIdentifiers: [APPLE_TEAM_ID, "OTHER"] }, /profile Team ID/u],
    [{ profileExpiresAt: NOW }, /profile is expired/u],
    [
      {
        certificates: [{
          subject: "CN=Apple Development: Wrong kind",
          validTo: NOW + 86_400_000,
          fingerprint: IDENTITY,
        }],
      },
      /no valid Developer ID Application/u,
    ],
    [
      { availableIdentityFingerprints: [] },
      /signing identity .* is unavailable/u,
    ],
    [
      { certificates: evidence(channel).certificates.map((certificate) => ({
        ...certificate,
        fingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      })) },
      /not authorized by the profile/u,
    ],
  ];
  for (const [overrides, expected] of cases) {
    assert.throws(
      () => validateAppleSigningEvidence(
        channel,
        IDENTITY,
        evidence(channel, overrides),
        NOW,
      ),
      expected,
    );
  }
  assert.throws(
    () => validateAppleSigningEvidence(
      channel,
      IDENTITY.toLowerCase(),
      evidence(channel),
      NOW,
    ),
    /uppercase SHA-1 fingerprint/u,
  );
});

test("signing target classification applies only the required entitlements", () => {
  const channel = "preview";
  const productName = DISTRIBUTION_CHANNEL_CONFIG[channel].productName;
  assert.equal(
    distributionOptionsForFile(channel, `/tmp/${productName}.app`).entitlements,
    expectTopLevel(channel),
  );
  assert.deepEqual(
    distributionOptionsForFile(
      channel,
      `/tmp/${productName}.app/Contents/Frameworks/${productName} Helper (Plugin).app`,
    ).entitlements,
    [
      "com.apple.security.cs.allow-jit",
      "com.apple.security.cs.allow-unsigned-executable-memory",
      "com.apple.security.cs.disable-library-validation",
    ],
  );
  assert.deepEqual(
    distributionOptionsForFile(
      channel,
      `/tmp/${productName}.app/Contents/Frameworks/${productName} Helper.app`,
    ).entitlements,
    ["com.apple.security.cs.allow-jit"],
  );
  assert.deepEqual(
    distributionOptionsForFile(channel, "/tmp/libEGL.dylib").entitlements,
    [],
  );
});

function expectTopLevel(channel: DistributionChannel): string {
  return path.resolve(
    import.meta.dirname,
    `../../packaging/entitlements.${channel}.plist`,
  );
}

test("redundant framework resources are the only ignored signing targets", () => {
  assert.equal(
    ignoreRedundantSigningTarget(
      "/Electron Framework.framework/Versions/A/Resources/en.lproj",
    ),
    true,
  );
  assert.equal(
    ignoreRedundantSigningTarget(
      "/Electron Framework.framework/Versions/Current/Resources/en.lproj",
    ),
    true,
  );
  assert.equal(
    ignoreRedundantSigningTarget("/Electron Framework.framework/Versions/A/Electron Framework"),
    false,
  );
  assert.equal(ignoreRedundantSigningTarget("/Frameworks/Currentish/tool"), false);
});
