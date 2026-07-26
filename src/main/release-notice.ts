// "Is there a newer release of this app?" — asked, never volunteered.
//
// This module makes exactly one network call per ten minutes and only when a
// caller asks. It has three callers and no others: the manual button, the
// opt-in automatic check, and the client-build mismatch notice. There is no
// per-launch call; the app does not poll.
//
// It returns three states. Conflating "we could not tell" with "you are up to
// date" is the class of quiet lie this codebase is being cleaned of, so the
// failure states are a closed vocabulary the renderer must handle by name.
//
// The current version arrives as an argument rather than from `app.getVersion()`
// so that the composition root keeps the one binding to Electron and this file
// stays executable in a unit test.
import type { ReleaseCheckFailure, ReleaseNotice } from "../shared/contracts.js";
import { RELEASE_REPO } from "../shared/contracts.js";
import {
  formatReleaseVersion,
  isOfferedUpgrade,
  parseReleaseVersion,
} from "../shared/release.js";

const API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1_000;

// In-memory only: a relaunch may check again. Holds answers and rate-limit
// refusals — the two results a repeated click cannot improve on. A transient
// failure is deliberately not cached, because the correct response to "you are
// offline" is to try again once you are not.
let cached: ReleaseNotice | null = null;
let inFlight: Promise<ReleaseNotice> | null = null;

export function checkForNewerRelease(
  currentVersion: string,
): Promise<ReleaseNotice> {
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }
  // Concurrent askers (launcher and settings dialog both mounted) share one
  // request rather than racing for the same rate-limit budget.
  inFlight ??= runCheck(currentVersion);
  return inFlight;
}

async function runCheck(currentVersion: string): Promise<ReleaseNotice> {
  try {
    const notice = await fetchNotice(currentVersion);
    if (notice.state !== "unknown" || notice.reason === "rate-limited") {
      cached = notice;
    }
    return notice;
  } finally {
    inFlight = null;
  }
}

async function fetchNotice(currentVersion: string): Promise<ReleaseNotice> {
  const failed = (reason: ReleaseCheckFailure): ReleaseNotice => ({
    state: "unknown",
    currentVersion,
    reason,
    checkedAt: Date.now(),
  });

  const current = parseReleaseVersion(currentVersion);
  // A local build has no place on the release line, so there is nothing to
  // compare it against. That is unknown, not up to date.
  if (!current) return failed("unsupported-build");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(API_URL, {
        signal: controller.signal,
        headers: { accept: "application/vnd.github+json" },
      });
    } catch {
      return failed(controller.signal.aborted ? "timeout" : "offline");
    }
    // GitHub answers an exhausted unauthenticated budget with 403, and a
    // secondary rate limit with 429.
    if (response.status === 403 || response.status === 429) {
      return failed("rate-limited");
    }
    if (!response.ok) return failed("server");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failed(controller.signal.aborted ? "timeout" : "unreadable");
    }
    const tag =
      typeof body === "object" && body !== null && "tag_name" in body
        ? (body as { tag_name: unknown }).tag_name
        : null;
    const latest = typeof tag === "string" ? parseReleaseVersion(tag) : null;
    if (!latest) return failed("unreadable");

    return {
      state: isOfferedUpgrade(current, latest) ? "update-available" : "up-to-date",
      currentVersion,
      // Re-rendered from the parsed version: the tag is network text and the
      // renderer puts this straight on screen.
      latestVersion: formatReleaseVersion(latest),
      checkedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
