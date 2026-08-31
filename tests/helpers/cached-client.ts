/**
 * The smallest complete published-client generation used by offline tests.
 *
 * A test that only needs the shell should not call this helper: launching with
 * `GW_REQUIRE_CACHED_CLIENT=1` and no generation proves the pre-ready failure
 * path without touching the network. Tests that need a session, snapshot
 * metadata or the generated-glue boundary seed this generation explicitly.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { migrateLegacyPublishedClientManifest } from "../../src/main/core/published-client.js";

export const TEST_CLIENT_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

export const TEST_CLIENT_SHA256 = createHash("sha256")
  .update(TEST_CLIENT_WASM)
  .digest("hex");

export const TEST_CLIENT_GLUE = [
  "Module.instantiateWasm({ env: {} }, function () {",
  "  Module.onRuntimeInitialized();",
  "});",
].join("\n");

const TEST_SNAPSHOT = Uint8Array.of(0);
const MAX_TEST_CHUNK_SIZE = 16 * 1024 * 1024;

export interface CachedClientPaths {
  readonly artifacts: string;
  readonly userData: string;
  /**
   * Global content-addressed chunk root. Released macOS fixtures can omit it
   * because their stores remain colocated beneath `userData`; Windows and
   * Flatpak fixtures must name the separate cache root explicitly.
   */
  readonly chunks?: string;
}

export interface CachedClientOptions {
  /** Total advertised game-data size; omit for the one-byte runtime fixture. */
  readonly snapshotSize?: number;
  /** Deterministic generated-client glue for renderer lifecycle tests. */
  readonly glue?: string;
  /** Customize the generation or sibling profile data before it is sealed. */
  readonly beforeSeal?: () => Promise<void>;
}

/**
 * Seed and seal one integrity-checked cached client without contacting
 * ArenaNet. Larger advertised snapshots intentionally have no resident chunks;
 * launcher tests need truthful totals, not fabricated game data.
 */
export async function seedCachedClient(
  paths: CachedClientPaths,
  {
    snapshotSize = TEST_SNAPSHOT.byteLength,
    glue = TEST_CLIENT_GLUE,
    beforeSeal = async () => undefined,
  }: CachedClientOptions = {},
): Promise<void> {
  const { artifacts, userData } = paths;
  if (!Number.isSafeInteger(snapshotSize) || snapshotSize <= 0) {
    throw new TypeError("test snapshot size must be a positive safe integer");
  }
  const chunks = paths.chunks ?? path.join(userData, "game", "chunks");
  await Promise.all([
    mkdir(artifacts, { recursive: true }),
    mkdir(chunks, { recursive: true }),
  ]);

  const chunkSize = Math.min(snapshotSize, MAX_TEST_CHUNK_SIZE);
  const chunkHashes = Array.from(
    { length: Math.ceil(snapshotSize / chunkSize) },
    (_unused, index) => {
      const bytes = Math.min(chunkSize, snapshotSize - index * chunkSize);
      return snapshotSize === TEST_SNAPSHOT.byteLength
        ? createHash("md5").update(TEST_SNAPSHOT).digest("hex")
        : createHash("md5")
            .update(`unresident-test-chunk:${index}:${bytes}`)
            .digest("hex");
    },
  );

  await Promise.all([
    writeFile(path.join(artifacts, "Gw.jspi.js"), glue),
    writeFile(path.join(artifacts, "Gw.jspi.wasm"), TEST_CLIENT_WASM),
    writeFile(path.join(artifacts, "version.json"), "{}"),
    writeFile(
      path.join(artifacts, "manifest.json"),
      JSON.stringify({
        compressionMode: "none",
        chunkSize,
        snapshot: "Gw.snapshot",
        size: snapshotSize,
        chunkHashes,
      }),
    ),
    ...(snapshotSize === TEST_SNAPSHOT.byteLength
      ? [writeFile(path.join(chunks, chunkHashes[0]!), TEST_SNAPSHOT)]
      : []),
  ]);

  await beforeSeal();

  // The runtime refuses a published generation whose three artifacts are not
  // sealed into its fingerprint. Seal here so every consumer gets the strict
  // fixture; no test relies on the alpha-era migration as an accidental setup
  // step.
  await migrateLegacyPublishedClientManifest(artifacts);
}
