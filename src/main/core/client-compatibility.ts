import { createHash } from "node:crypto";
import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeAtomicJson } from "./atomic-file.js";
import {
  COMMON_ARTIFACTS,
  JSPI_ARTIFACTS,
  SNAPSHOT,
} from "./access-key.js";
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
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
    ? value
    : null;
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

export function clientFingerprint(manifest: Manifest): string {
  const files = [...JSPI_ARTIFACTS, ...COMMON_ARTIFACTS, SNAPSHOT]
    .sort()
    .map((name) => {
      const entry = manifest.entry(name);
      if (!entry) throw new Error(`manifest is missing ${name}`);
      return {
        name,
        size: entry.size,
        chunkHashes: entry.chunkHashes,
      };
    });
  return createHash("sha256")
    .update(
      JSON.stringify({
        compression: manifest.compression,
        chunkSize: manifest.chunkSize,
        files,
      }),
    )
    .digest("hex");
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

export async function restoreUnconfirmedClient(options: {
  artifacts: string;
  rejectedPath: string;
  hostVersion: string;
}): Promise<{ fingerprint: string | null } | null> {
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

  if (fingerprint) {
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

export async function confirmClientCandidate(options: {
  artifacts: string;
  rejectedPath: string;
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
  if (!fingerprint) return null;
  await rm(markerPath, { force: true });
  await rm(clientGenerationPaths(options.artifacts).previous, {
    recursive: true,
    force: true,
  });
  await rm(options.rejectedPath, { force: true });
  return fingerprint;
}
