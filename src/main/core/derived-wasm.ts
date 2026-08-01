/**
 * The shared lifecycle behind every derived WebAssembly module we publish: hash
 * the base, reuse a cache entry only when it still describes exactly this
 * input, transform, and republish. The two transforms differ in what they
 * rewrite, not in how the result is cached, so they share this and nothing
 * else — a transform registry would be a framework for two callers.
 *
 * The cache root belongs to one transform outright. A rebuild empties it, so a
 * client update or an ABI bump cannot leave ~8 MB of dead derived modules
 * behind for every build the machine has ever seen.
 *
 * Nothing here returns a module it has not just hashed. An entry that fails any
 * part of its own description is a miss rather than a repair, and a transform
 * that throws leaves the last good publication where it is.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeAtomic, writeAtomicJson } from "./atomic-file.js";

export interface DerivedWasmCache {
  /** sha256 of the module the transform consumes. Keys the cache entry. */
  inputSha256: string;
  /** Directory this transform owns outright. A rebuild empties it. */
  cacheRoot: string;
  /** Bumped whenever the transform's output stops being interchangeable. */
  transformAbi: number;
  /** Identity of the certified build; any change to it is a cache miss. */
  buildFingerprint: string;
  /**
   * The output hash pinned in the source. A cache entry must match this
   * constant and not merely its own metadata, so a writer of the cache cannot
   * certify a replacement module by writing its hash beside it.
   */
  expectedOutputSha256: string;
}

interface DerivedWasmMetadata {
  inputSha256?: unknown;
  transformAbi?: unknown;
  buildFingerprint?: unknown;
  outputSha256?: unknown;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

/** Stable identity of a certified build entry. Any field change is a miss. */
export function buildFingerprint(build: unknown): string {
  return createHash("sha256").update(JSON.stringify(build)).digest("hex");
}

function entryPaths(cache: DerivedWasmCache): {
  wasmPath: string;
  metadataPath: string;
  cacheDir: string;
} {
  const cacheDir = path.join(
    cache.cacheRoot,
    cache.inputSha256,
    String(cache.transformAbi),
  );
  return {
    cacheDir,
    wasmPath: path.join(cacheDir, "Gw.jspi.wasm"),
    metadataPath: path.join(cacheDir, "metadata.json"),
  };
}

async function isUsable(cache: DerivedWasmCache): Promise<boolean> {
  const { wasmPath, metadataPath } = entryPaths(cache);
  try {
    const metadata = JSON.parse(
      await readFile(metadataPath, "utf8"),
    ) as DerivedWasmMetadata;
    if (
      metadata.inputSha256 !== cache.inputSha256
      || metadata.transformAbi !== cache.transformAbi
      || metadata.buildFingerprint !== cache.buildFingerprint
      || typeof metadata.outputSha256 !== "string"
      || metadata.outputSha256 !== cache.expectedOutputSha256
    ) {
      return false;
    }
    const file = await stat(wasmPath);
    return file.isFile()
      && file.size > 0
      && await sha256File(wasmPath) === metadata.outputSha256;
  } catch {
    return false;
  }
}

export async function inspectDerivedWasmCache(
  cache: DerivedWasmCache,
): Promise<"valid" | "missing-or-invalid"> {
  return (await isUsable(cache)) ? "valid" : "missing-or-invalid";
}

/**
 * Returns the path of the derived module, building it if the cache cannot
 * prove it already holds exactly this output. Throws rather than returning an
 * unverified module; callers fall back to the module they passed in.
 */
export async function prepareDerivedWasm(
  baseWasmPath: string,
  cache: DerivedWasmCache,
  transform: (base: Uint8Array) => Uint8Array,
): Promise<string> {
  const { cacheDir, wasmPath, metadataPath } = entryPaths(cache);
  if (await isUsable(cache)) return wasmPath;

  const transformed = transform(await readFile(baseWasmPath));
  const outputSha256 = createHash("sha256")
    .update(transformed)
    .digest("hex");
  if (outputSha256 !== cache.expectedOutputSha256) {
    throw new Error(`derived module has unexpected output ${outputSha256}`);
  }

  // Only after a successful transform: a failing transform must leave the
  // module the last good build published exactly where it is.
  await rm(cache.cacheRoot, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });
  await writeAtomic(wasmPath, transformed);
  await writeAtomicJson(metadataPath, {
    inputSha256: cache.inputSha256,
    transformAbi: cache.transformAbi,
    buildFingerprint: cache.buildFingerprint,
    outputSha256,
  });
  if (await sha256File(wasmPath) !== outputSha256) {
    throw new Error("published derived module failed verification");
  }
  return wasmPath;
}

/** Drops everything a transform has cached, for inputs it cannot serve. */
export async function discardDerivedWasm(cacheRoot: string): Promise<void> {
  await rm(cacheRoot, { recursive: true, force: true });
}
