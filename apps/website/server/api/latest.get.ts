// GET /api/latest — the site's one answer to "what is the newest downloadable
// GWonMac release?". The selection policy lives in server/utils/release-select
// (pure, executed by the repo's website smoke test); this handler only fetches
// and caches.
//
// The GitHub call is cached for five minutes per channel, which keeps the
// site far inside GitHub's unauthenticated rate limit however many visitors
// hit the page.

import {
  GITHUB_API_URL,
  SITE_RELEASE_CHANNEL,
  selectLatestRelease,
  type LatestRelease,
  type SiteReleaseChannel,
} from "../utils/release-select";

// The dependency tree carries both h3 v1 and v2 typings, whose H3Event types
// conflict under `getQuery` — read the channel from the event path instead.
function requestedChannel(event: { path: string }): SiteReleaseChannel {
  const channel = new URL(event.path, "http://localhost").searchParams.get("channel");
  return channel === "beta" ? "beta" : SITE_RELEASE_CHANNEL;
}

export default defineCachedEventHandler(
  async (event): Promise<LatestRelease> => {
    // Offline, rate-limited, or unreadable: keep the releases-page fallback.
    const payload = await $fetch(GITHUB_API_URL, {
      headers: { accept: "application/vnd.github+json" },
    }).catch(() => null);
    return selectLatestRelease(payload, requestedChannel(event));
  },
  {
    maxAge: 300,
    swr: true,
    getKey: (event) => `latest-${requestedChannel(event)}`,
  },
);
