/**
 * The one closed contract for a published native-updater release manifest.
 * Release construction, static-channel publication, and application discovery
 * all use this reader so none can accept a different tag, asset, or host.
 */
import {
  releaseAssetUrl,
  releaseDownloadRoot,
  releaseUpdateArtifactName,
  type AppUpdateTarget,
} from "./project-identity.js";
import {
  formatReleaseVersion,
  parseReleaseVersion,
  type ReleaseVersion,
} from "./release.js";

export interface ReleaseManifest {
  url: string;
  name: string;
  version: string;
  tag: string;
  pub_date: string;
  notes: string;
}

export interface ParsedReleaseManifest {
  manifest: ReleaseManifest;
  releaseVersion: ReleaseVersion;
  immutableFeedUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the one closed Squirrel.Mac document produced by the release workflow.
 * The update channel is only a mutable copy of this document; every byte it
 * names remains an immutable asset of the matching canonical GitHub release.
 */
export function parseReleaseManifest(
  value: unknown,
  target: AppUpdateTarget,
): ParsedReleaseManifest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "name,notes,pub_date,tag,url,version") return null;
  if (
    typeof value.version !== "string"
    || typeof value.tag !== "string"
    || typeof value.name !== "string"
    || typeof value.url !== "string"
    || typeof value.pub_date !== "string"
    || value.notes !== ""
  ) return null;
  const releaseVersion = parseReleaseVersion(value.version);
  if (
    !releaseVersion
    || formatReleaseVersion(releaseVersion) !== value.version
    || value.tag !== `v${value.version}`
    || value.name !== `Guild Wars Reforged v${value.version}`
  ) return null;
  const publishedAt = new Date(value.pub_date);
  if (
    Number.isNaN(publishedAt.valueOf())
    || publishedAt.toISOString() !== value.pub_date
  ) return null;
  const artifactName = releaseUpdateArtifactName(value.version, target);
  if (value.url !== releaseAssetUrl(value.tag, artifactName)) return null;
  return {
    manifest: {
      url: value.url,
      name: value.name,
      version: value.version,
      tag: value.tag,
      pub_date: value.pub_date,
      notes: "",
    },
    releaseVersion,
    immutableFeedUrl: target === "darwin-arm64"
      ? releaseAssetUrl(value.tag, "RELEASES.json")
      : releaseDownloadRoot(value.tag),
  };
}
