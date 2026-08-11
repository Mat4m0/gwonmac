// GET /download — the site's one direct download link, usable from plain
// markdown. Redirects to the newest downloadable DMG, or to the releases page
// when nothing is eligible, reusing the cached /api/latest answer.
import type { LatestRelease } from "../utils/release-select";

export default defineEventHandler(async (event) => {
  const channel = new URL(event.path, "http://localhost").searchParams.get("channel");
  const latest = await $fetch<LatestRelease>(
    channel === "beta" ? "/api/latest?channel=beta" : "/api/latest",
  );
  return sendRedirect(event, latest.url, 302);
});
