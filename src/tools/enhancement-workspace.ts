/**
 * The workspace report behind `certification doctor`: why Enhancement is or is
 * not running on this machine, before anyone starts guessing.
 *
 * It reads the real profile — the installed client, its published manifest, the
 * derived cache, the settings file — and reports what it found. It repairs
 * nothing, downloads nothing and writes nothing, so running it can never be the
 * reason a subsequent launch behaves differently.
 *
 * Certification is asked of `client-certification.ts` rather than re-derived
 * here, so the doctor and the launch cannot disagree about what state a build
 * is in. Argument parsing, printing and the exit code belong to
 * `certification.ts`; this module owns no command line.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  COMMON_ARTIFACTS,
  JSPI_ARTIFACTS,
} from "../main/core/access-key.js";
import { certifyClientBuild } from "../main/certification/client-certification.js";
import { inspectEnhancementCache } from "../main/certification/client-module.js";
import {
  ENHANCEMENT_PROGRAMS,
  enhancementCapabilitiesFor,
  enhancementCapabilitiesRequested,
  type EnhancementProgram,
} from "../shared/contracts.js";
import {
  readPublishedClientManifest,
  verifyPublishedClientArtifacts,
  type PublishedClientManifest,
} from "../main/core/published-client.js";

export interface EnhancementDoctorReport {
  profile: "ready" | "missing";
  /**
   * The profile's own player-facing setting. Fixed developer programs do not
   * mutate or depend on it.
   */
  nativeCursor: boolean;
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

/**
 * Core is required and therefore independent of the profile's settings file.
 */
async function readEnhancementSettings(
  _profile: string,
): Promise<Pick<EnhancementDoctorReport, "nativeCursor">> {
  return { nativeCursor: true };
}

async function snapshotResidency(
  manifest: PublishedClientManifest,
  chunksPath: string,
): Promise<EnhancementDoctorReport["snapshot"]> {
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

export async function inspectEnhancementWorkspace(
  profile: string,
  program: EnhancementProgram = ENHANCEMENT_PROGRAMS.some(
    (candidate) => candidate === process.env.GW_ENHANCEMENT_PROGRAM,
  )
    ? process.env.GW_ENHANCEMENT_PROGRAM as EnhancementProgram
    : "none",
): Promise<EnhancementDoctorReport> {
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
    || missing.length < required.length;
  const { nativeCursor } = await readEnhancementSettings(profile);
  const enhancementCapabilities = enhancementCapabilitiesFor(
    { nativeCursor },
    program,
  );
  let manifest: PublishedClientManifest | null = null;
  let artifactIntegrity: EnhancementDoctorReport["artifacts"]["integrity"] =
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
  let transformedCache: EnhancementDoctorReport["client"]["transformedCache"] =
    "unsupported";
  if (!missing.includes("Gw.jspi.wasm")) {
    const bytes = await readFile(path.join(artifactsPath, "Gw.jspi.wasm"));
    sha256 = createHash("sha256").update(bytes).digest("hex");
    // The Enhancement transform consumes the template-save client, so the chain is
    // resolved by the one module that owns it rather than repeated here.
    const certification = certifyClientBuild(sha256);
    if (certification.state === "certified") {
      build = certification.enhancementBuild;
      if (enhancementCapabilitiesRequested(enhancementCapabilities)) {
        transformedCache = await inspectEnhancementCache(
          build,
          enhancementCapabilities,
          path.join(game, "enhancements"),
        );
      }
    }
  }
  const snapshot = manifest
    ? await snapshotResidency(manifest, path.join(game, "chunks"))
    : null;
  const artifactsReady =
    missing.length === 0 && artifactIntegrity === "verified";
  return {
    profile: profileReady ? "ready" : "missing",
    nativeCursor,
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
