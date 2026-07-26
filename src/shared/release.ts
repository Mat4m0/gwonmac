// One parse, one comparison, one channel policy for this project's releases.
//
// Three places currently answer "is that version newer than this one, and may
// it be offered?" and they disagree: the update/mismatch check in main, the
// website's download resolver, and the release workflow's own tag validation.
// A disagreement here is user-visible — an install told it is up to date when
// it is not, or a download button pointing at a prerelease.
//
// SemVer only. The versioning *scheme* (CalVer semantics in SemVer syntax) is a
// product decision owned by scripts/macos-version.mjs and the release workflow;
// nothing in this file knows what a year or a month is. It knows the shapes
// .github/workflows/release.yml actually publishes: `X.Y.Z`, optionally
// `-alpha.N` / `-beta.N` / `-rc.N`, optionally tag-prefixed with `v`.

export type ReleaseChannel = "alpha" | "beta" | "rc" | "stable";

export interface ReleaseVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly channel: ReleaseChannel;
  /** Prerelease sequence. Always 0 on a stable release, which has none. */
  readonly sequence: number;
}

// Numeric identifiers reject leading zeroes, as SemVer requires. That is what
// makes `2026.07.01` fail here rather than inside npm or a comparison that
// silently reads it as 2026.7.1.
const RELEASE_PATTERN =
  /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$/;

// Precedence within one X.Y.Z: every prerelease comes before the release it
// leads to, and the channels run in the order they are published.
const CHANNEL_ORDER: Record<ReleaseChannel, number> = {
  alpha: 0,
  beta: 1,
  rc: 2,
  stable: 3,
};

function isPrereleaseChannel(
  value: string | undefined,
): value is Exclude<ReleaseChannel, "stable"> {
  return value === "alpha" || value === "beta" || value === "rc";
}

/** Returns `null` for any string this project would not publish as a release. */
export function parseReleaseVersion(value: string): ReleaseVersion | null {
  const match = RELEASE_PATTERN.exec(value);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const sequence = Number(match[5] ?? "0");
  // A long enough digit run parses to a finite but inexact number, and two
  // distinct versions would then compare equal.
  if (![major, minor, patch, sequence].every(Number.isSafeInteger)) return null;
  return {
    major,
    minor,
    patch,
    channel: isPrereleaseChannel(match[4]) ? match[4] : "stable",
    sequence,
  };
}

/** Negative, zero or positive, following the `Array.prototype.sort` contract. */
export function compareReleaseVersions(
  a: ReleaseVersion,
  b: ReleaseVersion,
): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel] ||
    a.sequence - b.sequence
  );
}

export function isPrerelease(version: ReleaseVersion): boolean {
  return version.channel !== "stable";
}

/**
 * Channel policy: a prerelease is only ever offered to an install already
 * running one. Someone on a stable build asked for stable builds, and an
 * update notice is not the place to decide otherwise for them.
 */
export function isOfferedUpgrade(
  current: ReleaseVersion,
  candidate: ReleaseVersion,
): boolean {
  if (isPrerelease(candidate) && !isPrerelease(current)) return false;
  return compareReleaseVersions(candidate, current) > 0;
}

/** Canonical text: no `v`, and the prerelease only when there is one. */
export function formatReleaseVersion(version: ReleaseVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.channel === "stable"
    ? core
    : `${core}-${version.channel}.${version.sequence}`;
}
