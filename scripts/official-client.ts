// Which ArenaNet client generation is published right now, and — on demand —
// its code artifacts on disk. This is what the recertification workflow asks
// before it decides whether anything needs deriving.
//
// It is not part of the certification chain and deliberately not a
// `certification` subcommand: `pnpm certification` builds the companion kernel
// first, because the Enhancement transform embeds it. Detection must cost a
// manifest fetch and nothing else, so this runs straight off the TypeScript
// loader with no build, no installed packages, and no client bytes.
//
// The identity it compares is the JSPI code generation — `Gw.jspi.js` and
// `Gw.jspi.wasm` — and not `clientFingerprint`, which additionally covers
// `Gw.snapshot` and `version.json` because it answers a different question:
// whether an *installed* generation may be rolled back to. Game content is
// republished on schedules that have nothing to do with the WASM, and folding
// it in here would send every content patch through a full derivation that
// concludes nothing changed. Both identities go through
// `fingerprintClientGeneration`, so there is one hashing policy and two scopes.
//
// The recorded identity carries no authority. It decides only whether the
// deriver runs; a wrong value costs a redundant derivation or a late one, and
// what a build may actually be transformed for is still decided by the
// certified tables and the local structural proof. It must still be the
// generation that was certified rather than the one published a minute later,
// which is why `--record` is given its digest and fetches nothing.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  JSPI_ARTIFACTS,
  PATCH_REQUEST_TIMEOUT_MS,
} from "../src/main/core/access-key.js";
import { fingerprintClientGeneration } from "../src/main/core/client-fingerprint.js";
import type { Manifest } from "../src/main/core/manifest.js";
import { PatchClient } from "../src/main/core/patch-client.js";
import { clientArtifactPath } from "../src/main/core/paths.js";
import { createBoundedPatchFetch } from "../src/main/core/patch-transport.js";
import { isDigest, type Digest } from "../src/shared/digest.js";
import { SEMANTIC_VERIFIER_ABI } from "../src/main/certification/semantic-proof.js";

export const RECORD = "certificates/certified-client.json";

export interface CertifiedClientRecord {
  readonly formatVersion: 1;
  readonly codeGeneration: Digest;
}

/** The identity of the published code artifacts, independent of game content. */
export function officialCodeGeneration(manifest: Manifest): Digest {
  return fingerprintClientGeneration({
    compression: manifest.compression,
    chunkSize: manifest.chunkSize,
    files: JSPI_ARTIFACTS.map((name) => {
      const entry = manifest.entry(name);
      if (!entry) throw new Error(`the published manifest is missing ${name}`);
      return { name, size: entry.size, chunkHashes: entry.chunkHashes };
    }),
  });
}

/**
 * A record this file cannot read is a failure, never a mismatch: reporting it
 * as changed would send the deriver after a client that may be the certified
 * one, and reporting it as unchanged would hide a patch forever.
 */
export function parseCertifiedClientRecord(raw: unknown): CertifiedClientRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${RECORD} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  if (value.formatVersion !== 1) {
    throw new Error(`${RECORD} has an unreadable format version`);
  }
  if (!isDigest(value.codeGeneration)) {
    throw new Error(`${RECORD} has no 64-hex codeGeneration`);
  }
  const unknown = Object.keys(value).filter(
    (key) => key !== "formatVersion" && key !== "codeGeneration",
  );
  if (unknown.length > 0) {
    throw new Error(`${RECORD} has unknown fields: ${unknown.join(", ")}`);
  }
  return { formatVersion: 1, codeGeneration: value.codeGeneration };
}

export function serializeCertifiedClientRecord(codeGeneration: Digest): string {
  return `${JSON.stringify({ formatVersion: 1, codeGeneration }, null, 2)}\n`;
}

/**
 * The three things this script does, as one closed choice.
 *
 * Recording takes the generation to write as an argument and reaches no
 * network. A derivation is three commands over as many minutes, and ArenaNet
 * may republish inside that window: a record that refetched would name whatever
 * is published at record time rather than the bytes the certification command
 * line just succeeded against, and the detector would then read published ==
 * recorded and hide the new build until the patch after it.
 */
export type OfficialClientCommand =
  | { readonly kind: "detect" }
  | { readonly kind: "download"; readonly directory: string }
  | { readonly kind: "record"; readonly generation: Digest };

export function parseCommand(argv: readonly string[]): OfficialClientCommand {
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] ?? null : null;
  };
  const downloading = argv.includes("--download");
  const recording = argv.includes("--record");
  if (downloading && recording) {
    throw new Error("--download fetches and --record writes; run them apart");
  }
  if (recording) {
    const generation = value("--record");
    if (!isDigest(generation)) {
      throw new Error("--record needs the 64-hex generation that was certified");
    }
    return { kind: "record", generation };
  }
  if (downloading) {
    const directory = value("--download");
    if (!directory) throw new Error("--download needs a directory");
    return { kind: "download", directory };
  }
  return { kind: "detect" };
}

/**
 * Steps report through `$GITHUB_OUTPUT` when a workflow supplies one; the same
 * JSON goes to stdout either way, so a local run sees exactly what CI branches
 * on. Every value is one line — a digest, a boolean or a path this run chose —
 * so no heredoc delimiter is needed and none may be introduced without one.
 */
async function publishStepOutputs(
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  await writeFile(
    file,
    Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""),
    { flag: "a" },
  );
}

export async function main(argv: readonly string[]): Promise<void> {
  const command = parseCommand(argv);

  if (command.kind === "record") {
    await writeFile(RECORD, serializeCertifiedClientRecord(command.generation));
    process.stdout.write(`${JSON.stringify({ recorded: command.generation })}\n`);
    await publishStepOutputs({ recorded: command.generation });
    return;
  }

  // `fetchManifest` touches neither directory, so detection creates nothing on
  // disk. A download gets the directory it was given; putting client bytes
  // anywhere the caller did not name is not this script's decision to make.
  const download = command.kind === "download" ? command.directory : null;
  const workingDir =
    download ?? (await mkdtemp(path.join(tmpdir(), "gwonmac-official-")));
  const client = new PatchClient({
    artifactsDir: path.join(workingDir, "artifacts"),
    chunksDir: path.join(workingDir, "chunks"),
    fetch: createBoundedPatchFetch(fetch, PATCH_REQUEST_TIMEOUT_MS),
  });

  // A download must name the manifest that produced its bytes. `update()`
  // returns that exact manifest; fetching once before it would create a race
  // where generation A labels bytes downloaded from generation B.
  const manifest = download
    ? (await client.update()).manifest
    : await client.fetchManifest();
  const fingerprint = officialCodeGeneration(manifest);
  const recorded = parseCertifiedClientRecord(
    JSON.parse(await readFile(RECORD, "utf8")),
  ).codeGeneration;

  // The fingerprint travels with the bytes: `--record` takes this value back as
  // an argument, so what gets recorded is the generation this run downloaded.
  const wasm = download
    ? clientArtifactPath(path.join(workingDir, "artifacts"), "Gw.jspi.wasm")
    : "";
  const js = download
    ? clientArtifactPath(path.join(workingDir, "artifacts"), "Gw.jspi.js")
    : "";
  process.stdout.write(`${JSON.stringify({
    fingerprint,
    recorded,
    changed: fingerprint !== recorded,
    wasm: wasm || null,
    js: js || null,
    verifierAbi: SEMANTIC_VERIFIER_ABI,
  })}\n`);
  await publishStepOutputs({
    changed: String(fingerprint !== recorded),
    fingerprint,
    recorded,
    wasm,
    js,
    verifier_abi: String(SEMANTIC_VERIFIER_ABI),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
