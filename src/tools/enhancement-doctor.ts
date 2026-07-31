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
import { DEFAULT_SETTINGS } from "../shared/contracts.js";
import {
  readPublishedClientManifest,
  verifyPublishedClientArtifacts,
  type PublishedClientManifest,
} from "../main/core/published-client.js";

export interface EnhancementDoctorReport {
  profile: "ready" | "missing";
  /**
   * The profile's own setting. An observation-tier live run enables nothing, so
   * this is the only thing that installs the Enhancement for it (P4.7); an
   * automation run forces it on through GW_ENHANCEMENT_AUTOMATION and ignores this.
   */
  nativeCursor: boolean;
  /**
   * The target-readout scenario exercises the player-facing surface, not only
   * automation's forced core observer, so it refuses a profile where this
   * player choice is off.
   */
  targetReadout: boolean;
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
): Promise<Pick<EnhancementDoctorReport, "nativeCursor" | "targetReadout">> {
  try {
    const text = await readFile(path.join(profile, "settings.json"), "utf8");
    const settings = parseSettings(JSON.parse(text));
    return {
      nativeCursor: settings.nativeCursor,
      targetReadout: settings.targetReadout,
    };
  } catch {
    return {
      nativeCursor: DEFAULT_SETTINGS.nativeCursor,
      targetReadout: DEFAULT_SETTINGS.targetReadout,
    };
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
  const { nativeCursor, targetReadout } = await readEnhancementSettings(profile);
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
      transformedCache = await inspectEnhancementCache(
        build,
        path.join(game, "enhancements"),
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
    nativeCursor,
    targetReadout,
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
