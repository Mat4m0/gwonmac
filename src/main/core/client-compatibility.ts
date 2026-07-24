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
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fingerprint = (value as Record<string, unknown>).fingerprint;
  return typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint)
    ? fingerprint
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
  await writeAtomicJson(path.join(artifacts, CANDIDATE_MARKER), marker);
}

export async function readRejectedClient(
  rejectedPath: string,
  hostVersion: string,
): Promise<string | null> {
  try {
    const value = JSON.parse(
      await readFile(rejectedPath, "utf8"),
    ) as Record<string, unknown>;
    return value.hostVersion === hostVersion ? parseFingerprint(value) : null;
  } catch {
    return null;
  }
}

export async function restoreUnconfirmedClient(options: {
  artifacts: string;
  previousArtifacts: string;
  rejectedPath: string;
  hostVersion: string;
}): Promise<{ fingerprint: string | null } | null> {
  const markerPath = path.join(options.artifacts, CANDIDATE_MARKER);
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
  const fingerprint = parseFingerprint(marker);
  if (
    !(await exists(options.artifacts)) ||
    !(await exists(options.previousArtifacts))
  ) {
    return null;
  }

  const failed = `${options.artifacts}.failed`;
  await rm(failed, { recursive: true, force: true });
  await rename(options.artifacts, failed);
  try {
    await rename(options.previousArtifacts, options.artifacts);
  } catch (error) {
    await rename(failed, options.artifacts);
    throw error;
  }
  await rm(failed, { recursive: true, force: true });
  if (fingerprint) {
    const rejected: RejectedClient = {
      formatVersion: 1,
      fingerprint,
      hostVersion: options.hostVersion,
    };
    await writeAtomicJson(options.rejectedPath, rejected);
  }
  return { fingerprint };
}

export async function confirmClientCandidate(options: {
  artifacts: string;
  previousArtifacts: string;
  rejectedPath: string;
}): Promise<string | null> {
  const markerPath = path.join(options.artifacts, CANDIDATE_MARKER);
  let fingerprint: string | null;
  try {
    fingerprint = parseFingerprint(
      JSON.parse(await readFile(markerPath, "utf8")),
    );
  } catch {
    return null;
  }
  if (!fingerprint) return null;
  await rm(markerPath, { force: true });
  await rm(options.previousArtifacts, { recursive: true, force: true });
  await rm(options.rejectedPath, { force: true });
  return fingerprint;
}
