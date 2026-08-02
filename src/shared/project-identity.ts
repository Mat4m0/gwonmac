/**
 * The identifiers that name this project to services outside it — the GitHub
 * repository releases are read from and the Apple Team ID its bundles are
 * signed under — and the one address shape a published release asset is
 * downloaded from.
 *
 * They live alone, with no imports, because build scripts, the packaging
 * configuration, the updater, the certificate feed and the distribution
 * channels all need them and none of those may become the place the others
 * read them from. Changing any of them changes which releases an installation
 * trusts, which Keychain group its secrets belong to, or where it goes for
 * bytes.
 *
 * This module refuses to own what is downloaded, when, or whether the answer
 * may be believed. It builds an address and makes no request.
 */
export const RELEASE_REPO = "Mat4m0/gwonmac";
export const APPLE_TEAM_ID = "9NN976MFZ4";

/** One published release's asset, addressed by the tag it was published under. */
export function releaseAssetUrl(tag: string, name: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/`
    + `${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

/**
 * The same asset on whichever release is current, with GitHub resolving which
 * that is. It is how a document attached to a release can be replaced without
 * shipping an application, and it is the same host, the same path prefix and
 * the same redirect chain as `releaseAssetUrl` — one egress destination, not
 * two.
 */
export function latestReleaseAssetUrl(name: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/latest/download/`
    + `${encodeURIComponent(name)}`;
}
