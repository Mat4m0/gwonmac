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
  compareReleaseVersions,
  formatReleaseVersion,
  isOfferedUpgrade,
  isPrerelease,
  parseReleaseVersion,
  type ReleaseVersion,
} from "../shared/release.js";

const API_URL =
  `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=100`;
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1_000;

// In-memory only: a relaunch may check again. Every answer is held for the same
// ten minutes, including failures. Without that rule an offline or broken
// endpoint lets repeated clicks bypass the request ceiling precisely when the
// request is least likely to help.
let cached: ReleaseNotice | null = null;
let inFlight: Promise<ReleaseNotice> | null = null;

export function checkForNewerRelease(
  currentVersion: string,
): Promise<ReleaseNotice> {
  if (
    cached
    && cached.currentVersion === currentVersion
    && Date.now() - cached.checkedAt < CACHE_TTL_MS
  ) {
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
    cached = notice;
    return notice;
  } finally {
    inFlight = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * GitHub orders releases by publication activity, not by SemVer precedence.
 * Parse every bounded candidate and choose the greatest one this install's
 * channel permits: stable installs stay on stable; prerelease installs may
 * advance through prerelease channels or onto a stable release.
 */
function latestAllowedRelease(
  body: unknown,
  current: ReleaseVersion,
): ReleaseVersion | null {
  if (!Array.isArray(body)) return null;
  const allowPrerelease = isPrerelease(current);
  let latest: ReleaseVersion | null = null;
  for (const release of body) {
    if (!isRecord(release) || release.draft === true) continue;
    const tag = release.tag_name;
    const candidate = typeof tag === "string" ? parseReleaseVersion(tag) : null;
    if (
      !candidate
      || (
        !allowPrerelease
        && (release.prerelease === true || isPrerelease(candidate))
      )
    ) {
      continue;
    }
    if (!latest || compareReleaseVersions(candidate, latest) > 0) {
      latest = candidate;
    }
  }
  return latest;
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  // A plain 403 is a server/permission refusal. GitHub identifies primary
  // exhaustion with zero remaining requests and secondary limits with
  // Retry-After; only those are safe to describe as rate limiting.
  return (
    response.headers.get("x-ratelimit-remaining") === "0"
    || response.headers.has("retry-after")
  );
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
    if (isRateLimited(response)) return failed("rate-limited");
    if (!response.ok) return failed("server");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failed(controller.signal.aborted ? "timeout" : "unreadable");
    }
    const latest = latestAllowedRelease(body, current);
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
