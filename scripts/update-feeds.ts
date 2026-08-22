import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_UPDATE_FEED_URLS,
  releaseAssetUrl,
} from "../src/shared/project-identity.js";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  isReleaseEligibleForTrack,
  parseReleaseVersion,
  releaseMetadataMatchesStage,
  type ReleaseVersion,
  type UpdateTrack,
} from "../src/shared/release.js";
import {
  parseReleaseManifest,
  type ReleaseManifest,
} from "../src/shared/release-manifest.js";

interface ReleaseCandidate {
  tag: string;
  version: ReleaseVersion;
  assets: unknown[];
}

export interface UpdateFeeds {
  stable: ReleaseManifest;
  beta: ReleaseManifest;
}

const UPDATE_TRACKS = ["stable", "beta"] as const satisfies readonly UpdateTrack[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function releaseCandidate(value: unknown): ReleaseCandidate | null {
  if (!isRecord(value) || value.draft !== false) return null;
  const tag = value.tag_name;
  if (typeof tag !== "string") return null;
  const version = parseReleaseVersion(tag);
  if (!version) return null;
  if (!isReleaseEligibleForTrack(version, "beta")) return null;
  if (
    typeof value.prerelease !== "boolean"
    || !releaseMetadataMatchesStage(version, value.prerelease)
  ) {
    throw new Error(`release ${tag} has inconsistent publication metadata`);
  }
  if (!Array.isArray(value.assets)) {
    throw new Error(`release ${tag} has no readable asset list`);
  }
  return { tag, version, assets: value.assets };
}

function updaterAssets(candidate: ReleaseCandidate): { manifestUrl: string } {
  const canonical = formatReleaseVersion(candidate.version);
  const expectedManifest = releaseAssetUrl(candidate.tag, "RELEASES.json");
  const expectedZip = releaseAssetUrl(
    candidate.tag,
    `Guild-Wars-Reforged-${canonical}-macOS-arm64.zip`,
  );
  let manifests = 0;
  let zips = 0;
  for (const asset of candidate.assets) {
    if (!isRecord(asset)) {
      throw new Error(`release ${candidate.tag} has an unreadable asset`);
    }
    if (
      asset.name === "RELEASES.json"
      && asset.browser_download_url === expectedManifest
    ) manifests += 1;
    if (
      asset.name === `Guild-Wars-Reforged-${canonical}-macOS-arm64.zip`
      && asset.browser_download_url === expectedZip
    ) zips += 1;
  }
  if (manifests !== 1 || zips !== 1) {
    throw new Error(`release ${candidate.tag} lacks its exact updater assets`);
  }
  return { manifestUrl: expectedManifest };
}

export function selectUpdateCandidates(payload: unknown): Record<
  UpdateTrack,
  ReleaseCandidate
> {
  if (!Array.isArray(payload)) throw new Error("GitHub releases are unreadable");
  const candidates: ReleaseCandidate[] = [];
  const versions = new Set<string>();
  for (const value of payload) {
    const candidate = releaseCandidate(value);
    if (!candidate) continue;
    const version = formatReleaseVersion(candidate.version);
    if (versions.has(version)) {
      throw new Error(`duplicate published release version ${version}`);
    }
    versions.add(version);
    candidates.push(candidate);
  }
  candidates.sort((a, b) => compareReleaseVersions(b.version, a.version));
  const stable = candidates.find(({ version }) =>
    isReleaseEligibleForTrack(version, "stable")
  );
  const beta = candidates.find(({ version }) =>
    isReleaseEligibleForTrack(version, "beta")
  );
  if (!stable || !beta) {
    throw new Error("both Stable and Beta update channels require a release");
  }
  return { stable, beta };
}

async function readCandidateManifest(
  candidate: ReleaseCandidate,
  fetchImpl: typeof fetch,
): Promise<ReleaseManifest> {
  const { manifestUrl } = updaterAssets(candidate);
  const response = await fetchImpl(manifestUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `release manifest ${candidate.tag} returned HTTP ${response.status}`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`release manifest ${candidate.tag} is not JSON`);
  }
  const parsed = parseReleaseManifest(value);
  if (
    !parsed
    || parsed.manifest.tag !== candidate.tag
    || compareReleaseVersions(parsed.releaseVersion, candidate.version) !== 0
    || parsed.immutableFeedUrl !== manifestUrl
  ) {
    throw new Error(`release manifest ${candidate.tag} is inconsistent`);
  }
  return parsed.manifest;
}

export async function buildUpdateFeeds(
  payload: unknown,
  fetchImpl: typeof fetch,
): Promise<UpdateFeeds> {
  const selected = selectUpdateCandidates(payload);
  const manifests = new Map<string, Promise<ReleaseManifest>>();
  const read = (candidate: ReleaseCandidate) => {
    const { manifestUrl } = updaterAssets(candidate);
    const existing = manifests.get(manifestUrl);
    if (existing) return existing;
    const pending = readCandidateManifest(candidate, fetchImpl);
    manifests.set(manifestUrl, pending);
    return pending;
  };
  const [stable, beta] = await Promise.all([
    read(selected.stable),
    read(selected.beta),
  ]);
  return { stable, beta };
}

export function assertFeedsDoNotMoveBackward(
  next: UpdateFeeds,
  previous: UpdateFeeds,
): void {
  for (const track of UPDATE_TRACKS) {
    const nextManifest = parseReleaseManifest(next[track]);
    const previousManifest = parseReleaseManifest(previous[track]);
    if (!nextManifest || !previousManifest) {
      throw new Error(`${track} channel comparison received an invalid manifest`);
    }
    if (
      !isReleaseEligibleForTrack(previousManifest.releaseVersion, track)
      || compareReleaseVersions(
        nextManifest.releaseVersion,
        previousManifest.releaseVersion,
      ) < 0
    ) {
      throw new Error(`${track} update channel would move backward`);
    }
  }
}

async function readPublishedFeeds(
  fetchImpl: typeof fetch,
): Promise<UpdateFeeds | null> {
  const responses = await Promise.all(UPDATE_TRACKS.map(async (track) => {
    const response = await fetchImpl(APP_UPDATE_FEED_URLS[track], {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`${track} channel returned HTTP ${response.status}`);
    }
    const value: unknown = await response.json();
    const parsed = parseReleaseManifest(value);
    if (
      !parsed
      || !isReleaseEligibleForTrack(parsed.releaseVersion, track)
    ) {
      throw new Error(`${track} published channel is invalid`);
    }
    return parsed.manifest;
  }));
  const [stable, beta] = responses;
  if (stable === null && beta === null) return null;
  if (!stable || !beta) {
    throw new Error("published update channels are not an atomic pair");
  }
  return { stable, beta };
}

async function writeUpdateFeeds(outputDirectory: string, feeds: UpdateFeeds) {
  await Promise.all(UPDATE_TRACKS.map(
    async (track) => {
      const directory = path.join(
        outputDirectory,
        "updates",
        track,
        "darwin",
        "arm64",
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "RELEASES.json"),
        `${JSON.stringify(feeds[track], null, 2)}\n`,
        { encoding: "utf8", mode: 0o644 },
      );
    },
  ));
  await writeFile(path.join(outputDirectory, ".nojekyll"), "", {
    encoding: "utf8",
    mode: 0o644,
  });
}

async function main(): Promise<void> {
  const [releasesFile, outputDirectory] = process.argv.slice(2);
  if (!releasesFile || !outputDirectory) {
    throw new Error("usage: update-feeds <releases-json> <output-directory>");
  }
  const payload: unknown = JSON.parse(await readFile(releasesFile, "utf8"));
  const feeds = await buildUpdateFeeds(payload, globalThis.fetch);
  const previous = await readPublishedFeeds(globalThis.fetch);
  if (previous) assertFeedsDoNotMoveBackward(feeds, previous);
  await writeUpdateFeeds(outputDirectory, feeds);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
