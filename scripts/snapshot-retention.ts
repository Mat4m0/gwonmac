import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SNAPSHOT_TAG = /^snapshot-[1-9][0-9]*-[0-9a-f]{7,40}$/;
const MAX_SNAPSHOTS = 3;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

export interface SnapshotRelease {
  readonly id: number;
  readonly tagName: string;
  readonly publishedAt: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
}

export interface SnapshotRemoval {
  readonly release: SnapshotRelease;
  readonly reason: "expired" | "overflow";
}

export interface SnapshotRetentionPlan {
  readonly keep: readonly SnapshotRelease[];
  readonly remove: readonly SnapshotRemoval[];
}

function publishedTime(release: SnapshotRelease): number | null {
  const value = Date.parse(release.publishedAt);
  return Number.isFinite(value) ? value : null;
}

/**
 * Plans deletion only for the exact immutable snapshot namespace. Versioned
 * releases, drafts, ordinary prereleases, and malformed snapshot-like tags are
 * outside this function's authority and can never appear in `remove`.
 */
export function planSnapshotRetention(
  releases: readonly SnapshotRelease[],
  now = Date.now(),
): SnapshotRetentionPlan {
  const snapshots = releases
    .filter(
      (release) =>
        !release.draft
        && release.prerelease
        && SNAPSHOT_TAG.test(release.tagName)
        && publishedTime(release) !== null,
    )
    .sort((left, right) => {
      const byTime = publishedTime(right)! - publishedTime(left)!;
      return byTime || right.tagName.localeCompare(left.tagName);
    });

  const keep: SnapshotRelease[] = [];
  const remove: SnapshotRemoval[] = [];
  for (const [index, release] of snapshots.entries()) {
    const age = Math.max(0, now - publishedTime(release)!);
    if (index >= MAX_SNAPSHOTS) {
      remove.push({ release, reason: "overflow" });
    } else if (index > 0 && age > MAX_AGE_MS) {
      remove.push({ release, reason: "expired" });
    } else {
      // The newest snapshot is retained even after fourteen quiet days.
      keep.push(release);
    }
  }
  return { keep, remove };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function releaseFromApi(value: unknown): SnapshotRelease | null {
  if (!isRecord(value)) return null;
  const {
    id,
    tag_name: tagName,
    published_at: publishedAt,
    draft,
    prerelease,
  } = value;
  return typeof id === "number"
    && Number.isSafeInteger(id)
    && typeof tagName === "string"
    && typeof publishedAt === "string"
    && typeof draft === "boolean"
    && typeof prerelease === "boolean"
    ? { id, tagName, publishedAt, draft, prerelease }
    : null;
}

function repositoryArgument(args: readonly string[]): string {
  const index = args.indexOf("--repo");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("--repo must be an owner/repository name");
  }
  return value;
}

function github(args: readonly string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function listReleases(repository: string): SnapshotRelease[] {
  const pages: unknown = JSON.parse(
    github([
      "api",
      `repos/${repository}/releases?per_page=100`,
      "--paginate",
      "--slurp",
    ]),
  );
  if (!Array.isArray(pages)) throw new Error("GitHub returned no release pages");
  return pages.flatMap((page) =>
    Array.isArray(page)
      ? page.map(releaseFromApi).filter((release) => release !== null)
      : [],
  );
}

function removeRelease(repository: string, release: SnapshotRelease): void {
  github([
    "api",
    "--method",
    "DELETE",
    `repos/${repository}/releases/${release.id}`,
  ]);
  github([
    "api",
    "--method",
    "DELETE",
    `repos/${repository}/git/refs/tags/${release.tagName}`,
  ]);
}

function main(args: readonly string[]): void {
  const repository = repositoryArgument(args);
  const apply = args.includes("--apply");
  const plan = planSnapshotRetention(listReleases(repository));
  for (const removal of plan.remove) {
    console.log(
      `${apply ? "delete" : "would delete"} ${removal.release.tagName} (${removal.reason})`,
    );
    if (apply) removeRelease(repository, removal.release);
  }
  console.log(
    `${apply ? "retained" : "would retain"} ${plan.keep.length} snapshot(s)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "snapshot cleanup failed");
    process.exitCode = 1;
  }
}
