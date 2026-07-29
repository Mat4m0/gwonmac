// The download button's policy, with nothing of Nuxt in it.
//
// This was the top of `app/composables/useLatestRelease.ts`, which mixed the
// selection rules with the composable that renders them. `tests/website-smoke.ts`
// executes these rules directly, and once that test became TypeScript it also
// became an input to `tsconfig.tests.json` — which reached through the import
// into the composable and found `useState` and `onMounted`, globals only Nuxt's
// own generated types describe. Splitting the two halves is what lets each be
// checked by the project that can actually see its dependencies, and it is why
// the extensions below are explicit: this module still loads under plain `node`.
import { EXTERNAL_URLS, RELEASE_REPO } from "../../../../src/shared/contracts.ts";
import releaseTargetsJson from "../../../../release-targets.json" with { type: "json" };
import {
  compareReleaseVersions,
  formatReleaseVersion,
  isPrerelease,
  parseReleaseVersion,
  type ReleaseVersion,
} from "../../../../src/shared/release.ts";
import {
  parseReleaseTargets,
  releaseTargetById,
  releaseTargetFilename,
} from "../../../../src/shared/release-targets.ts";

export const RELEASES_FALLBACK_URL = EXTERNAL_URLS.releases;
// Snapshot tags are not release versions and are ignored below. Fetch the API
// maximum so a temporarily failed snapshot-pruning run cannot hide the latest
// valid versioned release behind a page of snapshots.
const API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=100`;
const RELEASE_TARGETS = parseReleaseTargets(releaseTargetsJson);
const WEBSITE_TARGET = releaseTargetById(RELEASE_TARGETS, "macos-arm64");

type WebsiteReleaseChannel = "stable" | "preview";

// The launch phase offers preview builds. Change this one value to "stable"
// after the first stable release; selection tests cover both channel rules.
export const WEBSITE_RELEASE_CHANNEL: WebsiteReleaseChannel = "preview";

export interface ReleaseDownload {
  url: string;
  version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The one asset this site currently promises comes from the canonical target
 * document. Exact matching refuses checksums, SBOMs, and lookalike filenames.
 */
function targetAsset(
  release: Record<string, unknown>,
  version: string,
): string | null {
  const assets = release.assets;
  if (!Array.isArray(assets)) return null;
  const expectedName = releaseTargetFilename(WEBSITE_TARGET, version);
  let answer: string | null = null;
  for (const asset of assets) {
    if (!isRecord(asset)) continue;
    const { name, browser_download_url: downloadUrl } = asset;
    if (typeof name !== "string" || typeof downloadUrl !== "string") continue;
    if (name !== expectedName) continue;
    if (answer) return null;
    answer = downloadUrl;
  }
  return answer;
}

/**
 * Channel policy: the website currently offers preview releases.
 *
 * During the launch phase, the newest valid release may be a prerelease. Once
 * the first stable release exists, changing `WEBSITE_RELEASE_CHANNEL` to
 * `"stable"` restores the long-term policy without changing this selector.
 * Drafts are never offered.
 *
 * `null` is not an error. It means there is nothing eligible to offer, and the
 * caller keeps the releases-page link.
 */
export function selectWebsiteDownload(
  payload: unknown,
  channel: WebsiteReleaseChannel = WEBSITE_RELEASE_CHANNEL,
): ReleaseDownload | null {
  if (!Array.isArray(payload)) return null;
  let selected:
    | { parsed: ReleaseVersion; url: string }
    | null = null;
  for (const release of payload) {
    if (!isRecord(release)) continue;
    if (release.draft === true) continue;
    const tag = release.tag_name;
    const parsed = typeof tag === "string" ? parseReleaseVersion(tag) : null;
    if (!parsed) continue;
    if (
      channel === "stable"
      && (release.prerelease === true || isPrerelease(parsed))
    ) {
      continue;
    }
    const version = formatReleaseVersion(parsed);
    const url = targetAsset(release, version);
    if (!url) continue;
    if (
      !selected
      || compareReleaseVersions(parsed, selected.parsed) > 0
    ) {
      selected = { parsed, url };
    }
  }
  return selected
    ? {
        url: selected.url,
        version: formatReleaseVersion(selected.parsed),
      }
    : null;
}

/**
 * One request per page load, however many buttons ask.
 *
 * `useState` shares the answer; this shares the *question*. The guard it
 * replaces (`if (version.value) return`) was read before the awaited fetch, so
 * every mounted `DownloadCta` had already started its own GitHub request by the
 * time the first one resolved. `onMounted` never runs on the server, so this
 * module-scope promise belongs to one browser tab and is never shared between
 * SSR requests.
 */
let pending: Promise<ReleaseDownload | null> | null = null;

export function loadWebsiteDownload(): Promise<ReleaseDownload | null> {
  pending ??= fetch(API_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => selectWebsiteDownload(payload))
    // Offline, rate-limited, or unreadable: keep the releases-page fallback.
    .catch(() => null);
  return pending;
}
