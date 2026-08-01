/**
 * The three provisioned distribution channels and what each is allowed to do.
 *
 * Their distinct bundle IDs are what give them mutually isolated Data
 * Protection Keychain groups, so this table decides which secrets an
 * installation can even reach. The marker is configuration and not
 * authorization: the host bundle ID, the application-identifier entitlement and
 * the provisioning profile are what actually grant access, and
 * `parseDistributionMarker` refuses anything that is not exactly one of the
 * three — a marker with an extra key, a foreign repository, or an unknown
 * channel yields `null`, and `null` means volatile secrets and no automatic
 * updates.
 *
 * There is no fourth channel and no way to synthesise one. Adding a channel
 * means provisioning a bundle ID, not editing a string here.
 */
import { APPLE_TEAM_ID, RELEASE_REPO } from "./project-identity.js";

export { APPLE_TEAM_ID } from "./project-identity.js";

export const DISTRIBUTION_CHANNELS = [
  "release",
  "preview",
  "development",
] as const;

export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

export interface DistributionChannelConfig {
  readonly productName: string;
  readonly bundleId: string;
  readonly signingKind: "developer-id" | "development";
}

export const DISTRIBUTION_CHANNEL_CONFIG: Readonly<
  Record<DistributionChannel, DistributionChannelConfig>
> = {
  release: {
    productName: "Guild Wars Reforged",
    bundleId: "io.github.mat4m0.gwonmac",
    signingKind: "developer-id",
  },
  preview: {
    productName: "Guild Wars Reforged Preview",
    bundleId: "io.github.mat4m0.gwonmac.preview",
    signingKind: "developer-id",
  },
  development: {
    productName: "Guild Wars Reforged Dev",
    bundleId: "io.github.mat4m0.gwonmac.dev",
    signingKind: "development",
  },
};

export interface DistributionMarker {
  readonly schema: 1;
  readonly repository: typeof RELEASE_REPO;
  readonly channel: DistributionChannel;
}

export interface DistributionCapabilities {
  readonly persistentSecrets: boolean;
  readonly cleanupLegacySecrets: boolean;
  readonly automaticUpdates: boolean;
}

export function isDistributionChannel(
  value: unknown,
): value is DistributionChannel {
  return DISTRIBUTION_CHANNELS.some((channel) => channel === value);
}

export function distributionMarker(
  channel: DistributionChannel,
): DistributionMarker {
  return { schema: 1, repository: RELEASE_REPO, channel };
}

export function applicationIdentifier(channel: DistributionChannel): string {
  return `${APPLE_TEAM_ID}.${DISTRIBUTION_CHANNEL_CONFIG[channel].bundleId}`;
}

export function parseDistributionMarker(
  value: unknown,
): DistributionMarker | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const marker = value as Record<string, unknown>;
  if (
    Object.keys(marker).length !== 3
    || marker.schema !== 1
    || marker.repository !== RELEASE_REPO
    || !isDistributionChannel(marker.channel)
  ) {
    return null;
  }
  return distributionMarker(marker.channel);
}

export function distributionCapabilities(
  channel: DistributionChannel | null,
): DistributionCapabilities {
  return {
    persistentSecrets: channel !== null,
    cleanupLegacySecrets: channel === "release",
    automaticUpdates: channel === "release",
  };
}
