/**
 * Crash-loop protection across an ArenaNet client update: the marker files and
 * the directory swap that let a launch tell "this generation has never survived
 * a run" from "this generation works".
 *
 * A candidate is marked before it is served and confirmed only after the client
 * has actually run. An ordinary restart leaves that marker in place so an
 * update that was downloaded but never tried remains the active candidate.
 * Renderer-crash recovery rolls the candidate back and records the rejected
 * fingerprint, so the same broken download is not served in a crash loop.
 *
 * Rejection is scoped to the host version that recorded it, so a fixed app is
 * allowed to try a generation an older one refused.
 */
import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isDigest } from "../../shared/digest.js";
import { writeAtomicJson } from "./atomic-file.js";
import {
  COMMON_ARTIFACTS,
  JSPI_ARTIFACTS,
  SNAPSHOT,
} from "./access-key.js";
import { fingerprintClientGeneration } from "./client-fingerprint.js";
import type { Manifest } from "./manifest.js";

const CANDIDATE_MARKER = ".candidate.json";

export function clientGenerationPaths(artifacts: string): {
  stage: string;
  previous: string;
  failed: string;
  marker: string;
} {
  return {
    stage: `${artifacts}.next`,
    previous: `${artifacts}.previous`,
    failed: `${artifacts}.failed`,
    marker: path.join(artifacts, CANDIDATE_MARKER),
  };
}

interface CandidateMarker {
  formatVersion: 1;
  fingerprint: string;
}

interface RejectedClient {
  formatVersion: 1;
  fingerprint: string;
  hostVersion: string;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

function parseFingerprint(value: unknown): string | null {
  return isDigest(value) ? value : null;
}

function parseCandidateMarker(value: unknown): CandidateMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fingerprint = parseFingerprint(record.fingerprint);
  return record.formatVersion === 1 && fingerprint
    ? { formatVersion: 1, fingerprint }
    : null;
}

function parseRejectedClient(value: unknown): RejectedClient | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fingerprint = parseFingerprint(record.fingerprint);
  return record.formatVersion === 1 &&
    fingerprint &&
    typeof record.hostVersion === "string"
    ? { formatVersion: 1, fingerprint, hostVersion: record.hostVersion }
    : null;
}

export type ClientCandidate =
  | { status: "none" }
  | { status: "pending"; fingerprint: string }
  | { status: "invalid" };

export async function readClientCandidate(
  artifacts: string,
): Promise<ClientCandidate> {
  const markerPath = clientGenerationPaths(artifacts).marker;
  let raw: string;
  try {
    raw = await readFile(markerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "none" };
    }
    return { status: "invalid" };
  }
  try {
    const marker = parseCandidateMarker(JSON.parse(raw));
    return marker
      ? { status: "pending", fingerprint: marker.fingerprint }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

export function clientFingerprint(manifest: Manifest): string {
  const files = [...JSPI_ARTIFACTS, ...COMMON_ARTIFACTS, SNAPSHOT]
    .map((name) => {
      const entry = manifest.entry(name);
      if (!entry) throw new Error(`manifest is missing ${name}`);
      return {
        name,
        size: entry.size,
        chunkHashes: entry.chunkHashes,
      };
    });
  return fingerprintClientGeneration({
    compression: manifest.compression,
    chunkSize: manifest.chunkSize,
    files,
  });
}

export async function markClientCandidate(
  artifacts: string,
  fingerprint: string,
): Promise<void> {
  const marker: CandidateMarker = {
    formatVersion: 1,
    fingerprint,
  };
  await writeAtomicJson(clientGenerationPaths(artifacts).marker, marker);
}

export async function readRejectedClient(
  rejectedPath: string,
  hostVersion: string,
): Promise<string | null> {
  try {
    const value = parseRejectedClient(
      JSON.parse(await readFile(rejectedPath, "utf8")),
    );
    return value?.hostVersion === hostVersion ? value.fingerprint : null;
  } catch {
    return null;
  }
}

export async function clearRejectedClient(rejectedPath: string): Promise<void> {
  await rm(rejectedPath, { force: true });
}

async function rollbackClientCandidate(options: {
  artifacts: string;
  rejectedPath: string;
  hostVersion: string;
}, reject: boolean): Promise<{ fingerprint: string | null } | null> {
  const paths = clientGenerationPaths(options.artifacts);
  const markerPath = paths.marker;
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    try {
      await stat(markerPath);
      marker = null;
    } catch {
      return null;
    }
  }
  const fingerprint = parseCandidateMarker(marker)?.fingerprint ?? null;
  if (
    !(await exists(options.artifacts)) ||
    !(await exists(paths.previous))
  ) {
    return null;
  }

  if (fingerprint && reject) {
    const rejected: RejectedClient = {
      formatVersion: 1,
      fingerprint,
      hostVersion: options.hostVersion,
    };
    // Make rejection durable before moving either generation. A crash can
    // safely repeat the swap; it must not re-try the same crashing candidate.
    await writeAtomicJson(options.rejectedPath, rejected);
  }
  const failed = paths.failed;
  await rm(failed, { recursive: true, force: true });
  await rename(options.artifacts, failed);
  try {
    await rename(paths.previous, options.artifacts);
  } catch (error) {
    await rename(failed, options.artifacts);
    throw error;
  }
  await rm(failed, { recursive: true, force: true });
  return { fingerprint };
}

/** Roll back a candidate that caused a proven renderer failure. */
export function rejectClientCandidate(options: {
  artifacts: string;
  rejectedPath: string;
  hostVersion: string;
}): Promise<{ fingerprint: string | null } | null> {
  return rollbackClientCandidate(options, true);
}

/** Prefer the verified previous generation when the candidate marker is torn. */
export async function restoreInvalidClientCandidate(options: {
  artifacts: string;
  rejectedPath: string;
  hostVersion: string;
}): Promise<{ fingerprint: string | null } | null> {
  if ((await readClientCandidate(options.artifacts)).status !== "invalid") {
    return null;
  }
  return rollbackClientCandidate(options, false);
}

export async function confirmClientCandidate(options: {
  artifacts: string;
  rejectedPath: string;
  expectedFingerprint: string;
}): Promise<string | null> {
  const markerPath = clientGenerationPaths(options.artifacts).marker;
  let fingerprint: string | null;
  try {
    fingerprint =
      parseCandidateMarker(JSON.parse(await readFile(markerPath, "utf8")))
        ?.fingerprint ?? null;
  } catch {
    return null;
  }
  if (!fingerprint || fingerprint !== options.expectedFingerprint) return null;
  await rm(markerPath, { force: true });
  await rm(clientGenerationPaths(options.artifacts).previous, {
    recursive: true,
    force: true,
  });
  await rm(options.rejectedPath, { force: true });
  return fingerprint;
}
