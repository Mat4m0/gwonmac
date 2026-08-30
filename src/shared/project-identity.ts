/**
 * The identifiers that name this project to services outside it — the GitHub
 * repository releases are read from and the Apple Team ID its bundles are
 * signed under — and the one address shape a published release asset is
 * downloaded from.
 *
 * They live alone, with no imports, because build scripts, the packaging
 * configuration, updater, release scripts, and distribution channels all need
 * them and none of those may become the place the others read them from.
 * Changing any of them changes which releases an installation trusts, which
 * Keychain group its secrets belongs to, or where it goes for bytes.
 *
 * This module refuses to own what is downloaded, when, or whether the answer
 * may be believed. It builds an address and makes no request.
 */
const GITHUB_OWNER = "Mat4m0";
const GITHUB_REPOSITORY = "gwonmac";
export const RELEASE_REPO = `${GITHUB_OWNER}/${GITHUB_REPOSITORY}`;
export const APPLE_TEAM_ID = "9NN976MFZ4";
const UPDATE_FEED_ROOT =
  `https://${GITHUB_OWNER.toLowerCase()}.github.io/${GITHUB_REPOSITORY}/updates`;

export const APP_UPDATE_TARGETS = ["darwin-arm64", "win32-x64"] as const;
export type AppUpdateTarget = (typeof APP_UPDATE_TARGETS)[number];

export function appUpdateTarget(
  platform: string,
  architecture: string,
): AppUpdateTarget | null {
  if (platform === "darwin" && architecture === "arm64") return "darwin-arm64";
  if (platform === "win32" && architecture === "x64") return "win32-x64";
  return null;
}

export function appUpdateFeedUrls(target: AppUpdateTarget): Readonly<{
  stable: string;
  beta: string;
}> {
  if (target === "darwin-arm64") {
    return Object.freeze({
      stable: `${UPDATE_FEED_ROOT}/stable/darwin/arm64/RELEASES.json`,
      beta: `${UPDATE_FEED_ROOT}/beta/darwin/arm64/RELEASES.json`,
    });
  }
  return Object.freeze({
    stable: `${UPDATE_FEED_ROOT}/stable/win32/x64/RELEASES.json`,
    beta: `${UPDATE_FEED_ROOT}/beta/win32/x64/RELEASES.json`,
  });
}

export function releaseUpdateArtifactName(
  version: string,
  target: AppUpdateTarget,
): string {
  return target === "darwin-arm64"
    ? `Guild-Wars-Reforged-${version}-macOS-arm64.zip`
    : `Guild-Wars-Reforged-${version}-Windows-x64-Setup.exe`;
}

/** One published release's asset, addressed by the tag it was published under. */
export function releaseAssetUrl(tag: string, name: string): string {
  return `${releaseDownloadRoot(tag)}/${encodeURIComponent(name)}`;
}

export function releaseDownloadRoot(tag: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}`;
}
