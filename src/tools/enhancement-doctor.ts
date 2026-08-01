/**
 * `pnpm enhancements:doctor`: reports why Enhancement is or is not running on
 * this machine, before anyone starts guessing.
 *
 * It reads the real profile — the installed client, its published manifest, the
 * derived cache, the settings file — and reports what it found. It repairs
 * nothing, downloads nothing and writes nothing, so running it can never be the
 * reason a subsequent launch behaves differently.
 *
 * Certification is asked of `client-certification.ts` rather than re-derived
 * here, so the doctor and the launch cannot disagree about what state a build
 * is in.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMON_ARTIFACTS,
  JSPI_ARTIFACTS,
} from "../main/core/access-key.js";
import { certifyClientBuild } from "../main/client-certification.js";
import { inspectEnhancementCache } from "../main/core/client-module.js";
import { parseSettings } from "../main/core/settings.js";
import {
  DEFAULT_SETTINGS,
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
 * Read-only on purpose. `loadSettings` moves a corrupt file aside and writes a
 * backup; a doctor must not change the profile it is inspecting, and both of
 * its failure paths end at the defaults anyway.
 */
async function readEnhancementSettings(
  profile: string,
): Promise<Pick<EnhancementDoctorReport, "nativeCursor">> {
  try {
    const text = await readFile(path.join(profile, "settings.json"), "utf8");
    const settings = parseSettings(JSON.parse(text));
    return { nativeCursor: settings.nativeCursor };
  } catch {
    return { nativeCursor: DEFAULT_SETTINGS.nativeCursor };
  }
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

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const profile = argumentValue("--profile") ?? defaultGuildWarsProfile();
  const report = await inspectEnhancementWorkspace(profile);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.readyForCachedLive) process.exitCode = 1;
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
