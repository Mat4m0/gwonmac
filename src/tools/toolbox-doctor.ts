import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMON_ARTIFACTS,
  JSPI_ARTIFACTS,
} from "../main/core/access-key.js";
import { findToolboxBuild } from "../main/core/toolbox-builds.js";
import { inspectToolboxCache } from "../main/core/toolbox-client.js";
import {
  readPublishedClientManifest,
  verifyPublishedClientArtifacts,
  type PublishedClientManifest,
} from "../main/core/published-client.js";

export interface ToolboxDoctorReport {
  profile: "ready" | "missing";
  credentials: "saved" | "missing";
  artifacts: {
    ready: boolean;
    missing: string[];
    integrity: "verified" | "invalid" | "unsealed";
  };
  client: {
    sha256: string | null;
    supported: boolean;
    buildId: number | null;
    transformedCache: "valid" | "missing-or-invalid" | "unsupported";
  };
  snapshot: {
    totalBytes: number;
    residentBytes: number;
    totalChunks: number;
    residentChunks: number;
    complete: boolean;
    evidence: "presence-only";
  } | null;
  readyForCachedLive: boolean;
}

export function defaultGuildWarsProfile(): string {
  return process.platform === "darwin"
    ? path.join(homedir(), "Library", "Application Support", "Guild Wars")
    : path.join(homedir(), ".guild-wars");
}

async function isFile(filename: string): Promise<boolean> {
  try {
    const value = await stat(filename);
    return value.isFile() && value.size > 0;
  } catch {
    return false;
  }
}

async function snapshotResidency(
  manifest: PublishedClientManifest,
  chunksPath: string,
): Promise<ToolboxDoctorReport["snapshot"]> {
  try {
    const residentNames = new Set(await readdir(chunksPath));
    const hashes = manifest.chunkHashes;
    let residentChunks = 0;
    let residentBytes = 0;
    for (let index = 0; index < hashes.length; index += 1) {
      if (!residentNames.has(hashes[index]!)) continue;
      residentChunks += 1;
      residentBytes += Math.min(
        manifest.chunkSize,
        manifest.size - index * manifest.chunkSize,
      );
    }
    return {
      totalBytes: manifest.size,
      residentBytes,
      totalChunks: hashes.length,
      residentChunks,
      complete: residentChunks === hashes.length,
      evidence: "presence-only",
    };
  } catch {
    return null;
  }
}

export async function inspectToolboxWorkspace(
  profile: string,
): Promise<ToolboxDoctorReport> {
  const game = path.join(profile, "game");
  const artifactsPath = path.join(game, "artifacts");
  const required = [...JSPI_ARTIFACTS, ...COMMON_ARTIFACTS, "manifest.json"];
  const missing = (
    await Promise.all(
      required.map(async (name) => ({
        name,
        present: await isFile(path.join(artifactsPath, name)),
      })),
    )
  )
    .filter((entry) => !entry.present)
    .map((entry) => entry.name);
  const profileReady = (await isFile(path.join(profile, "settings.json")))
    || (await isFile(path.join(profile, "credentials.bin")))
    || missing.length < required.length;
  const credentials = await isFile(path.join(profile, "credentials.bin"));
  let manifest: PublishedClientManifest | null = null;
  let artifactIntegrity: ToolboxDoctorReport["artifacts"]["integrity"] =
    "invalid";
  try {
    manifest = await readPublishedClientManifest(
      path.join(artifactsPath, "manifest.json"),
    );
    const verified = await verifyPublishedClientArtifacts(
      artifactsPath,
      manifest,
    );
    artifactIntegrity =
      verified === true ? "verified" : verified === null ? "unsealed" : "invalid";
  } catch {
    // Invalid manifests remain unavailable and fail the preflight closed.
  }

  let sha256: string | null = null;
  let build = null;
  let transformedCache: ToolboxDoctorReport["client"]["transformedCache"] =
    "unsupported";
  if (!missing.includes("Gw.jspi.wasm")) {
    const bytes = await readFile(path.join(artifactsPath, "Gw.jspi.wasm"));
    sha256 = createHash("sha256").update(bytes).digest("hex");
    build = findToolboxBuild(sha256);
    if (build) {
      transformedCache = await inspectToolboxCache(
        sha256,
        build,
        path.join(game, "toolbox"),
      );
    }
  }
  const snapshot = manifest
    ? await snapshotResidency(manifest, path.join(game, "chunks"))
    : null;
  const artifactsReady =
    missing.length === 0 && artifactIntegrity === "verified";
  return {
    profile: profileReady ? "ready" : "missing",
    credentials: credentials ? "saved" : "missing",
    artifacts: {
      ready: artifactsReady,
      missing,
      integrity: artifactIntegrity,
    },
    client: {
      sha256,
      supported: build !== null,
      buildId: build?.buildId ?? null,
      transformedCache,
    },
    snapshot,
    readyForCachedLive:
      profileReady
      && artifactsReady
      && build !== null
      && snapshot?.complete === true,
  };
}

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const profile = argumentValue("--profile") ?? defaultGuildWarsProfile();
  const report = await inspectToolboxWorkspace(profile);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.readyForCachedLive) process.exitCode = 1;
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
