import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../shared/errors.js";
import { CLIENT_ARTIFACTS, HASH_ALGOS, SNAPSHOT } from "./access-key.js";
import { writeAtomicJson } from "./atomic-file.js";
import { parseContentHash, verifyChunkHash } from "./chunk-format.js";
import type { CompressionMode } from "./manifest.js";

export interface PublishedClientArtifact {
  name: (typeof CLIENT_ARTIFACTS)[number];
  size: number;
  chunkHashes: string[];
}

export interface PublishedClientManifest {
  clientFingerprint?: string;
  artifacts?: PublishedClientArtifact[];
  compressionMode: CompressionMode;
  chunkSize: number;
  snapshot: typeof SNAPSHOT;
  size: number;
  chunkHashes: string[];
}

export function parsePublishedClientManifest(
  raw: unknown,
): PublishedClientManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("bad_manifest", "published client manifest must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    value.compressionMode !== "none" &&
    value.compressionMode !== "gzip"
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid compression",
    );
  }
  if (value.snapshot !== SNAPSHOT) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid snapshot",
    );
  }
  if (!Number.isSafeInteger(value.chunkSize) || Number(value.chunkSize) <= 0) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid chunk size",
    );
  }
  if (!Number.isSafeInteger(value.size) || Number(value.size) <= 0) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid snapshot size",
    );
  }
  if (
    !Array.isArray(value.chunkHashes) ||
    !value.chunkHashes.every((hash) => typeof hash === "string")
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid chunk hashes",
    );
  }
  const chunkHashes = value.chunkHashes.map(parseContentHash);
  let artifacts: PublishedClientArtifact[] | undefined;
  if (value.artifacts !== undefined) {
    if (!Array.isArray(value.artifacts)) {
      throw new AppError(
        "bad_manifest",
        "published client manifest has invalid artifacts",
      );
    }
    const parsed = value.artifacts.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new AppError(
          "bad_manifest",
          "published client manifest has invalid artifact",
        );
      }
      const record = item as Record<string, unknown>;
      if (
        typeof record.name !== "string" ||
        !CLIENT_ARTIFACTS.includes(
          record.name as (typeof CLIENT_ARTIFACTS)[number],
        ) ||
        !Number.isSafeInteger(record.size) ||
        Number(record.size) <= 0 ||
        !Array.isArray(record.chunkHashes)
      ) {
        throw new AppError(
          "bad_manifest",
          "published client manifest has invalid artifact",
        );
      }
      const hashes = record.chunkHashes.map(parseContentHash);
      if (hashes.length !== Math.ceil(Number(record.size) / Number(value.chunkSize))) {
        throw new AppError(
          "bad_manifest",
          "published client manifest has invalid artifact chunk count",
        );
      }
      return {
        name: record.name as (typeof CLIENT_ARTIFACTS)[number],
        size: Number(record.size),
        chunkHashes: hashes,
      };
    });
    if (
      parsed.length !== CLIENT_ARTIFACTS.length ||
      new Set(parsed.map((item) => item.name)).size !== CLIENT_ARTIFACTS.length
    ) {
      throw new AppError(
        "bad_manifest",
        "published client manifest has incomplete artifacts",
      );
    }
    artifacts = CLIENT_ARTIFACTS.map((name) => parsed.find(
      (item) => item.name === name,
    )!);
  }
  if (
    value.clientFingerprint !== undefined &&
    (typeof value.clientFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.clientFingerprint))
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid client fingerprint",
    );
  }
  if (
    (value.artifacts === undefined) !==
    (value.clientFingerprint === undefined)
  ) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has incomplete integrity metadata",
    );
  }
  const chunkSize = Number(value.chunkSize);
  const size = Number(value.size);
  if (chunkHashes.length !== Math.ceil(size / chunkSize)) {
    throw new AppError(
      "bad_manifest",
      "published client manifest has invalid chunk count",
    );
  }
  return {
    ...(typeof value.clientFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(value.clientFingerprint)
      ? { clientFingerprint: value.clientFingerprint }
      : {}),
    ...(artifacts ? { artifacts } : {}),
    compressionMode: value.compressionMode,
    chunkSize,
    snapshot: SNAPSHOT,
    size,
    chunkHashes,
  };
}

function publishedClientFingerprint(
  manifest: PublishedClientManifest & {
    artifacts: PublishedClientArtifact[];
  },
): string {
  const files = [
    ...manifest.artifacts,
    {
      name: SNAPSHOT,
      size: manifest.size,
      chunkHashes: manifest.chunkHashes,
    },
  ]
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .map(({ name, size, chunkHashes }) => ({ name, size, chunkHashes }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        compression: manifest.compressionMode,
        chunkSize: manifest.chunkSize,
        files,
      }),
    )
    .digest("hex");
}

async function describeArtifact(
  artifactsDir: string,
  name: PublishedClientArtifact["name"],
  chunkSize: number,
  hashAlgorithm: "md5" | "sha1" | "sha256",
): Promise<PublishedClientArtifact> {
  const file = await open(path.join(artifactsDir, name), "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0) {
      throw new AppError("bad_manifest", `published client is missing ${name}`);
    }
    const chunkHashes: string[] = [];
    for (let offset = 0; offset < metadata.size; offset += chunkSize) {
      const size = Math.min(chunkSize, metadata.size - offset);
      const data = Buffer.allocUnsafe(size);
      const { bytesRead } = await file.read(data, 0, size, offset);
      if (bytesRead !== size) {
        throw new AppError("bad_manifest", `published client is truncated ${name}`);
      }
      chunkHashes.push(createHash(hashAlgorithm).update(data).digest("hex"));
    }
    return { name, size: metadata.size, chunkHashes };
  } finally {
    await file.close();
  }
}

/**
 * Origin/main published snapshot-only manifests. Seal that already-installed
 * generation once before checking for a replacement so the first host upgrade
 * has a verifiable rollback target. New manifests always use the strict shape.
 */
export async function migrateLegacyPublishedClientManifest(
  artifactsDir: string,
): Promise<PublishedClientManifest | null> {
  const manifestPath = path.join(artifactsDir, "manifest.json");
  let manifest: PublishedClientManifest;
  try {
    manifest = await readPublishedClientManifest(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (manifest.artifacts && manifest.clientFingerprint) return manifest;

  const hashAlgorithm = HASH_ALGOS[manifest.chunkHashes[0]?.length ?? 0];
  if (!hashAlgorithm) {
    throw new AppError(
      "bad_manifest",
      "legacy client manifest has an unsupported hash algorithm",
    );
  }
  const artifacts = await Promise.all(
    CLIENT_ARTIFACTS.map((name) =>
      describeArtifact(
        artifactsDir,
        name,
        manifest.chunkSize,
        hashAlgorithm,
      ),
    ),
  );
  const strict: PublishedClientManifest = {
    ...manifest,
    artifacts,
    clientFingerprint: publishedClientFingerprint({
      ...manifest,
      artifacts,
    }),
  };
  await writeAtomicJson(manifestPath, strict, 0o600);
  return strict;
}

export async function verifyPublishedClientArtifacts(
  artifactsDir: string,
  manifest: PublishedClientManifest,
): Promise<boolean | null> {
  if (!manifest.artifacts) return null;
  for (const artifact of manifest.artifacts) {
    let file;
    try {
      file = await open(path.join(artifactsDir, artifact.name), "r");
      const metadata = await file.stat();
      if (!metadata.isFile() || metadata.size !== artifact.size) return false;
      for (let index = 0; index < artifact.chunkHashes.length; index++) {
        const offset = index * manifest.chunkSize;
        const size = Math.min(manifest.chunkSize, artifact.size - offset);
        const data = Buffer.allocUnsafe(size);
        const { bytesRead } = await file.read(data, 0, size, offset);
        if (bytesRead !== size) return false;
        verifyChunkHash(artifact.chunkHashes[index]!, data);
      }
    } catch {
      return false;
    } finally {
      await file?.close();
    }
  }
  return true;
}

export async function readPublishedClientManifest(
  path: string,
): Promise<PublishedClientManifest> {
  return parsePublishedClientManifest(JSON.parse(await readFile(path, "utf8")));
}
