// Single source of truth for project links lives in the app's shared contracts.
// The extension is explicit so this module also loads under plain `node`, which
// is how tests/website-smoke.mjs executes the selection policy below.
import { EXTERNAL_URLS, RELEASE_REPO } from "../../../../src/shared/contracts.ts";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  isPrerelease,
  parseReleaseVersion,
  type ReleaseVersion,
} from "../../../../src/shared/release.ts";

const FALLBACK_URL = EXTERNAL_URLS.releases;
// Enough entries to see past a run of prereleases. `per_page=1` returned the
// newest release of any channel, which is regularly a prerelease.
const API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=20`;

export interface ReleaseDownload {
  url: string;
  version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The one asset this site promises: a zipped Apple Silicon build. An asset that
 * does not name the architecture is not one the download button can claim, so a
 * release carrying only checksums and an SBOM is skipped rather than offered.
 */
function appleSiliconZip(release: Record<string, unknown>): string | null {
  const assets = release.assets;
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!isRecord(asset)) continue;
    const { name, browser_download_url: downloadUrl } = asset;
    if (typeof name !== "string" || typeof downloadUrl !== "string") continue;
    if (/arm64.*\.zip$/i.test(name)) return downloadUrl;
  }
  return null;
}

/**
 * Channel policy: **the website offers stable releases only.**
 *
 * The release workflow publishes prereleases with `--prerelease --latest=false`
 * (`.github/workflows/release.yml`), so the newest release in the repository is
 * regularly one a first-time visitor must not be handed. Drafts and prereleases
 * are filtered here rather than trusted to GitHub's "latest" pointer. A
 * prerelease stays one click away on the releases page, where choosing it is
 * deliberate — the same policy the app applies to update notices
 * (`src/shared/release.ts`, `isOfferedUpgrade`).
 *
 * `null` is not an error. It means there is nothing stable to offer yet, and
 * the caller keeps the releases-page link.
 */
export function selectStableDownload(payload: unknown): ReleaseDownload | null {
  if (!Array.isArray(payload)) return null;
  let selected:
    | { parsed: ReleaseVersion; url: string }
    | null = null;
  for (const release of payload) {
    if (!isRecord(release)) continue;
    if (release.draft === true || release.prerelease === true) continue;
    const tag = release.tag_name;
    const parsed = typeof tag === "string" ? parseReleaseVersion(tag) : null;
    if (!parsed || isPrerelease(parsed)) continue;
    const url = appleSiliconZip(release);
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

export function loadStableDownload(): Promise<ReleaseDownload | null> {
  pending ??= fetch(API_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then(selectStableDownload)
    // Offline, rate-limited, or unreadable: keep the releases-page fallback.
    .catch(() => null);
  return pending;
}

export function useLatestRelease() {
  const url = useState("release-url", () => FALLBACK_URL);
  const version = useState<string | null>("release-version", () => null);

  onMounted(async () => {
    const download = await loadStableDownload();
    if (!download) return;
    url.value = download.url;
    version.value = download.version;
  });

  return { url, version };
}
