// GET /api/latest — the site's one answer to "what is the newest downloadable
// GWonMac release?".
//
// Mirrors the release policy of the app repo (src/shared/release.ts and the
// previous website's release-download.ts): tags are SemVer-shaped
// `X.Y.Z[-alpha.N|-beta.N|-rc.N]`, optionally `v`-prefixed; drafts are never
// offered; a release only counts if it ships a notarized Apple Silicon DMG
// (an asset ending in `arm64.dmg`) — one carrying only checksums is skipped.
//
// Channels: `?channel=stable` offers stable releases only; `?channel=beta`
// (and the current default) also offers prereleases. Flip
// SITE_RELEASE_CHANNEL to "stable" after the first stable release ships.
//
// The GitHub call is cached for five minutes per channel, which keeps the
// site far inside GitHub's unauthenticated rate limit however many visitors
// hit the page.

const RELEASE_REPO = "Mat4m0/gwonmac";
const RELEASES_FALLBACK_URL = `https://github.com/${RELEASE_REPO}/releases/latest`;
// Snapshot tags are not release versions and fail the pattern below. Fetch the
// API maximum so a page of snapshots cannot hide the latest valid release.
const GITHUB_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=100`;

type SiteReleaseChannel = "stable" | "beta";

const SITE_RELEASE_CHANNEL: SiteReleaseChannel = "beta";

// Same grammar and precedence as the app's src/shared/release.ts: leading
// zeroes are rejected, prereleases order alpha < beta < rc < stable.
const RELEASE_PATTERN =
  /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$/;
const CHANNEL_ORDER = { alpha: 0, beta: 1, rc: 2, stable: 3 } as const;

interface ParsedVersion {
  numbers: [number, number, number, number, number];
  prerelease: boolean;
  text: string;
}

function parseReleaseTag(tag: string): ParsedVersion | null {
  const match = RELEASE_PATTERN.exec(tag);
  if (!match) return null;
  const [major, minor, patch, sequence] = [match[1], match[2], match[3], match[5] ?? "0"].map(Number);
  if (![major, minor, patch, sequence].every(Number.isSafeInteger)) return null;
  const channel = (match[4] ?? "stable") as keyof typeof CHANNEL_ORDER;
  return {
    numbers: [major!, minor!, patch!, CHANNEL_ORDER[channel], sequence!],
    prerelease: channel !== "stable",
    text: `${major}.${minor}.${patch}${channel === "stable" ? "" : `-${channel}.${sequence}`}`,
  };
}

function isNewer(a: ParsedVersion, b: ParsedVersion): boolean {
  for (let i = 0; i < a.numbers.length; i += 1) {
    if (a.numbers[i]! !== b.numbers[i]!) return a.numbers[i]! > b.numbers[i]!;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function appleSiliconDmg(release: Record<string, unknown>): string | null {
  if (!Array.isArray(release.assets)) return null;
  for (const asset of release.assets) {
    if (!isRecord(asset)) continue;
    const { name, browser_download_url: url } = asset;
    if (typeof name === "string" && typeof url === "string" && /arm64\.dmg$/i.test(name)) {
      return url;
    }
  }
  return null;
}

export interface LatestRelease {
  channel: SiteReleaseChannel;
  /** Canonical version text, or null when nothing eligible was found. */
  version: string | null;
  prerelease: boolean | null;
  /** Direct DMG download when found, the releases page otherwise. */
  url: string;
}

export function selectLatestRelease(
  payload: unknown,
  channel: SiteReleaseChannel,
): LatestRelease {
  let selected: { parsed: ParsedVersion; url: string } | null = null;
  if (Array.isArray(payload)) {
    for (const release of payload) {
      if (!isRecord(release) || release.draft === true) continue;
      const parsed = typeof release.tag_name === "string" ? parseReleaseTag(release.tag_name) : null;
      if (!parsed) continue;
      if (channel === "stable" && (release.prerelease === true || parsed.prerelease)) continue;
      const url = appleSiliconDmg(release);
      if (!url) continue;
      if (!selected || isNewer(parsed, selected.parsed)) selected = { parsed, url };
    }
  }
  return selected
    ? {
        channel,
        version: selected.parsed.text,
        prerelease: selected.parsed.prerelease,
        url: selected.url,
      }
    : { channel, version: null, prerelease: null, url: RELEASES_FALLBACK_URL };
}

export default defineCachedEventHandler(
  async (event): Promise<LatestRelease> => {
    const channel: SiteReleaseChannel =
      getQuery(event).channel === "stable" ? "stable" : SITE_RELEASE_CHANNEL;
    // Offline, rate-limited, or unreadable: keep the releases-page fallback.
    const payload = await $fetch(GITHUB_API_URL, {
      headers: { accept: "application/vnd.github+json" },
    }).catch(() => null);
    return selectLatestRelease(payload, channel);
  },
  {
    maxAge: 300,
    swr: true,
    getKey: (event) => `latest-${getQuery(event).channel === "stable" ? "stable" : "beta"}`,
  },
);
