// Quiet update awareness: at most one GitHub API call per app run, and only
// for real (CalVer-versioned) release builds. Dev builds never phone home.
import { app } from "electron";
import type { UpdateStatus } from "../shared/contracts.js";
import { EXTERNAL_URLS, RELEASE_REPO } from "../shared/contracts.js";

const API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const TIMEOUT_MS = 5000;

function parseVersion(value: string): number[] | null {
  const parts = value
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  return parts;
}

function isNewer(latest: number[], current: number[]): boolean {
  const length = Math.max(latest.length, current.length);
  for (let i = 0; i < length; i += 1) {
    const a = latest[i] ?? 0;
    const b = current[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

let cached: Promise<UpdateStatus | null> | null = null;

export function checkForUpdate(): Promise<UpdateStatus | null> {
  cached ??= fetchStatus();
  return cached;
}

async function fetchStatus(): Promise<UpdateStatus | null> {
  const currentVersion = app.getVersion();
  const current = parseVersion(currentVersion);
  // Releases use CalVer (year.month.run); anything else is a local build.
  if (!current || (current[0] ?? 0) < 2020) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: { accept: "application/vnd.github+json" },
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const release = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
    };
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    const latest = parseVersion(tag);
    if (!latest) return null;
    return {
      currentVersion,
      latestVersion: tag,
      url:
        typeof release.html_url === "string"
          ? release.html_url
          : EXTERNAL_URLS.releases,
      hasUpdate: isNewer(latest, current),
    };
  } catch {
    return null;
  }
}
