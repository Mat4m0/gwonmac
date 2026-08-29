import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  APPLE_TEAM_ID,
  applicationIdentifier,
  DISTRIBUTION_CHANNEL_CONFIG,
  type DistributionChannel,
} from "../src/shared/distribution-channel.js";

interface ProvisioningProfile {
  readonly DeveloperCertificates?: unknown;
  readonly Entitlements?: unknown;
  readonly ExpirationDate?: unknown;
  readonly TeamIdentifier?: unknown;
}

export interface SigningCertificateEvidence {
  readonly subject: string;
  readonly validTo: number;
  readonly fingerprint: string;
}

export interface AppleSigningEvidence {
  readonly entitlements: unknown;
  readonly profileApplicationIdentifier: unknown;
  readonly profileDeveloperTeamIdentifier: unknown;
  readonly profileTeamIdentifiers: unknown;
  readonly profileExpiresAt: number;
  readonly certificates: readonly SigningCertificateEvidence[];
  readonly availableIdentityFingerprints: readonly string[];
}

const require = createRequire(import.meta.url);
const { parse: parsePlist } = require("plist") as {
  parse(source: string): unknown;
};

function fail(message: string): never {
  throw new Error(`Apple signing preflight failed: ${message}`);
}

function plistJson(file: string): unknown {
  const output = execFileSync(
    "plutil",
    ["-convert", "json", "-o", "-", "--", file],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as unknown;
}

function decodedProfile(file: string): ProvisioningProfile {
  const xml = execFileSync("security", ["cms", "-D", "-i", file]);
  const value = parsePlist(xml.toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("provisioning profile is not a dictionary");
  }
  return value as ProvisioningProfile;
}

function dictionary(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${description} is not a dictionary`);
  }
  return value as Record<string, unknown>;
}

function normalizedFingerprint(value: string): string {
  return value.replaceAll(":", "").toUpperCase();
}

export interface AppleSigningPreflight {
  readonly channel: DistributionChannel;
  readonly identity: string;
  readonly keychain?: string;
  readonly profile: string;
  readonly entitlements: string;
}

export function distributionSigningOptions(input: AppleSigningPreflight) {
  verifyAppleSigningConfiguration(input);
  return {
    identity: input.identity,
    ...(input.keychain ? { keychain: input.keychain } : {}),
    provisioningProfile: input.profile,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: true,
    ignore: ignoreRedundantSigningTarget,
    hardenedRuntime: true as const,
    timestamp: "http://timestamp.apple.com/ts01",
    optionsForFile: (filePath: string) =>
      distributionOptionsForFile(input.channel, filePath),
  };
}

export function distributionEntitlementsPath(
  channel: DistributionChannel,
): string {
  return path.resolve(
    import.meta.dirname,
    `../packaging/entitlements.${channel}.plist`,
  );
}

export function ignoreRedundantSigningTarget(filePath: string): boolean {
  return (
    /Electron Framework\.framework\/(?:Versions\/(?:A|Current)\/)?Resources\//u.test(
      filePath,
    ) || /\/Versions\/Current(?:\/|$)/u.test(filePath)
  );
}

/**
 * The exact entitlement set the top-level application of `channel` may carry.
 *
 * The preflight holds the entitlements *file* to it and
 * `scripts/verify-signed-app.ts` holds the *signed application* to it, so the
 * two can never disagree about what was approved.
 */
export function approvedDistributionEntitlements(
  channel: DistributionChannel,
): Readonly<Record<string, unknown>> {
  return {
    "com.apple.security.cs.allow-jit": true,
    "com.apple.security.device.audio-input": true,
    "com.apple.application-identifier": applicationIdentifier(channel),
    "com.apple.developer.team-identifier": APPLE_TEAM_ID,
  };
}

/**
 * Whether `actual` is exactly `expected` — an extra key is a mismatch, which is
 * the whole point of an allowlist.
 */
export function matchesExactEntitlements(
  actual: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return false;
  }
  const value = actual as Record<string, unknown>;
  return (
    Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, entitlement]) => value[key] === entitlement)
  );
}

/** The certificate common name, and so the signature Authority, `channel` signs with. */
export function distributionAuthorityName(channel: DistributionChannel): string {
  return DISTRIBUTION_CHANNEL_CONFIG[channel].signingKind === "developer-id"
    ? "Developer ID Application:"
    : "Apple Development:";
}

export function distributionOptionsForFile(
  channel: DistributionChannel,
  filePath: string,
): {
  entitlements: string | string[];
  hardenedRuntime: true;
  timestamp: string;
} {
  const productName = DISTRIBUTION_CHANNEL_CONFIG[channel].productName;
  return {
    entitlements:
      path.basename(filePath) === `${productName}.app`
        ? distributionEntitlementsPath(channel)
        : filePath.includes("Helper (Plugin).app")
          ? [
              "com.apple.security.cs.allow-jit",
              "com.apple.security.cs.allow-unsigned-executable-memory",
              "com.apple.security.cs.disable-library-validation",
            ]
          : filePath.endsWith(".app")
            ? ["com.apple.security.cs.allow-jit"]
            : [],
    hardenedRuntime: true,
    timestamp: "http://timestamp.apple.com/ts01",
  };
}

export function validateAppleSigningEvidence(
  channel: DistributionChannel,
  identity: string,
  evidence: AppleSigningEvidence,
  now = Date.now(),
): void {
  if (!/^[0-9A-F]{40}$/u.test(identity)) {
    fail("signing identity must be its unique uppercase SHA-1 fingerprint");
  }
  const expectedApplicationIdentifier = applicationIdentifier(channel);
  if (
    !matchesExactEntitlements(
      evidence.entitlements,
      approvedDistributionEntitlements(channel),
    )
  ) {
    fail(`${channel} entitlements are not the exact approved allowlist`);
  }
  if (
    evidence.profileApplicationIdentifier !== expectedApplicationIdentifier
    || evidence.profileDeveloperTeamIdentifier !== APPLE_TEAM_ID
  ) {
    fail(`profile does not authorize ${expectedApplicationIdentifier}`);
  }
  if (
    !Array.isArray(evidence.profileTeamIdentifiers)
    || evidence.profileTeamIdentifiers.length !== 1
    || evidence.profileTeamIdentifiers[0] !== APPLE_TEAM_ID
  ) {
    fail(`profile Team ID is not ${APPLE_TEAM_ID}`);
  }
  if (
    !Number.isFinite(evidence.profileExpiresAt)
    || evidence.profileExpiresAt <= now
  ) {
    fail("provisioning profile is expired or has no valid expiry");
  }

  const expectedCertificateName = distributionAuthorityName(channel);
  const authorizedFingerprints = new Set(
    evidence.certificates
      .filter(({ subject }) => subject.includes(`CN=${expectedCertificateName}`))
      .filter(({ validTo }) => Number.isFinite(validTo) && validTo > now)
      .map(({ fingerprint }) => normalizedFingerprint(fingerprint)),
  );
  if (authorizedFingerprints.size === 0) {
    fail(`profile has no valid ${expectedCertificateName} certificate`);
  }
  const availableIdentities = new Set(
    evidence.availableIdentityFingerprints.map(normalizedFingerprint),
  );
  if (!availableIdentities.has(identity)) {
    fail(`signing identity ${identity} is unavailable`);
  }
  if (!authorizedFingerprints.has(identity)) {
    fail("selected signing identity is not authorized by the profile");
  }
}

export function verifyAppleSigningConfiguration(
  input: AppleSigningPreflight,
): void {
  for (const file of [input.profile, input.entitlements]) {
    if (!path.isAbsolute(file)) fail(`${file} must be an absolute path`);
    readFileSync(file);
  }

  const profile = decodedProfile(input.profile);
  const profileEntitlements = dictionary(
    profile.Entitlements,
    "profile entitlements",
  );
  const expiresAt = profile.ExpirationDate instanceof Date
    ? profile.ExpirationDate.getTime()
    : Date.parse(String(profile.ExpirationDate));
  if (!Array.isArray(profile.DeveloperCertificates)) {
    fail("profile has no DeveloperCertificates array");
  }
  const certificates = profile.DeveloperCertificates.map((encoded) => {
    if (!Buffer.isBuffer(encoded)) fail("profile certificate is malformed");
    return new X509Certificate(encoded);
  });
  const identityArguments = ["find-identity", "-v", "-p", "codesigning"];
  if (input.keychain) identityArguments.push(input.keychain);
  const identities = execFileSync("security", identityArguments, {
    encoding: "utf8",
  });
  validateAppleSigningEvidence(input.channel, input.identity, {
    entitlements: plistJson(input.entitlements),
    profileApplicationIdentifier:
      profileEntitlements["com.apple.application-identifier"],
    profileDeveloperTeamIdentifier:
      profileEntitlements["com.apple.developer.team-identifier"],
    profileTeamIdentifiers: profile.TeamIdentifier,
    profileExpiresAt: expiresAt,
    certificates: certificates.map((certificate) => ({
      subject: certificate.subject,
      validTo: Date.parse(certificate.validTo),
      fingerprint: certificate.fingerprint,
    })),
    availableIdentityFingerprints: [
      ...identities.matchAll(/\b[0-9A-F]{40}\b/gu),
    ].map((match) => match[0]),
  });
}
