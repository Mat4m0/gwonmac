// Pure release-selection policy behind GET /api/latest, kept free of Nitro
// imports so the repo's website smoke test can execute it directly.
//
// The shared release module owns version and track semantics; this website
// module owns only the public payload and its exact downloadable DMG.
//
// Channels: `stable` is the public default and offers stable releases only;
// the explicit `beta` path additionally offers beta and release-candidate
// builds. Alpha and snapshot builds are never public acquisition candidates.

import {
  compareReleaseVersions,
  formatReleaseVersion,
  isReleaseEligibleForTrack,
  parseReleaseVersion,
  releaseMetadataMatchesStage,
  type ReleaseVersion,
  type UpdateTrack,
} from "../../../../src/shared/release.js";
import {
  RELEASE_REPO,
  releaseAssetUrl,
} from "../../../../src/shared/project-identity.js";

export { RELEASE_REPO };
export const RELEASES_FALLBACK_URL = `https://github.com/${RELEASE_REPO}/releases/latest`;
// Snapshot tags are not release versions and fail the pattern below. Fetch the
// API maximum so a page of snapshots cannot hide the latest valid release.
export const GITHUB_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=100`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function appleSiliconDmg(
  release: Record<string, unknown>,
  tag: string,
  version: ReleaseVersion,
): string | null {
  if (!Array.isArray(release.assets)) return null;
  const name =
    `Guild-Wars-Reforged-${formatReleaseVersion(version)}-macOS-arm64.dmg`;
  const expectedUrl = releaseAssetUrl(tag, name);
  for (const asset of release.assets) {
    if (!isRecord(asset)) continue;
    if (asset.name === name && asset.browser_download_url === expectedUrl) return expectedUrl;
  }
  return null;
}

export interface LatestRelease {
  /** Canonical version text, or null when nothing eligible was found. */
  version: string | null;
  /** Direct DMG download when found, the releases page otherwise. */
  url: string;
}

export function selectLatestRelease(
  payload: unknown,
  track: UpdateTrack,
): LatestRelease {
  let selected: { version: ReleaseVersion; url: string } | null = null;
  if (Array.isArray(payload)) {
    for (const release of payload) {
      // Only an explicit public answer is eligible. Missing or malformed
      // metadata must not turn a staged approval draft into a download.
      if (!isRecord(release) || release.draft !== false) continue;
      const tag = release.tag_name;
      const version = typeof tag === "string" ? parseReleaseVersion(tag) : null;
      if (!version || typeof tag !== "string") continue;
      if (typeof release.prerelease !== "boolean") continue;
      if (!releaseMetadataMatchesStage(version, release.prerelease)) continue;
      if (!isReleaseEligibleForTrack(version, track)) continue;
      const url = appleSiliconDmg(release, tag, version);
      if (!url) continue;
      if (!selected || compareReleaseVersions(version, selected.version) > 0) {
        selected = { version, url };
      }
    }
  }
  return selected
    ? {
        version: formatReleaseVersion(selected.version),
        url: selected.url,
      }
    : { version: null, url: RELEASES_FALLBACK_URL };
}
