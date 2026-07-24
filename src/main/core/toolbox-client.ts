import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeAtomic, writeAtomicJson } from "./atomic-file.js";
import {
  findToolboxBuild,
  type KnownToolboxBuild,
} from "./toolbox-builds.js";
import {
  TOOLBOX_TRANSFORM_ABI,
  transformToolboxWasm,
} from "./toolbox-transform.js";

export interface PreparedToolboxClient {
  wasmPath: string;
  build: KnownToolboxBuild | null;
  transformed: boolean;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function buildFingerprint(build: KnownToolboxBuild): string {
  return createHash("sha256").update(JSON.stringify(build)).digest("hex");
}

async function isUsableCache(
  wasmPath: string,
  metadataPath: string,
  inputHash: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      inputSha256?: unknown;
      transformAbi?: unknown;
      outputSha256?: unknown;
      buildFingerprint?: unknown;
    };
    if (
      metadata.inputSha256 !== inputHash
      || metadata.transformAbi !== TOOLBOX_TRANSFORM_ABI
      || metadata.buildFingerprint !== fingerprint
      || typeof metadata.outputSha256 !== "string"
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

export async function inspectToolboxCache(
  officialSha256: string,
  build: KnownToolboxBuild,
  cacheRoot: string,
): Promise<"valid" | "missing-or-invalid"> {
  const cacheDir = path.join(
    cacheRoot,
    officialSha256,
    String(TOOLBOX_TRANSFORM_ABI),
  );
  return (await isUsableCache(
    path.join(cacheDir, "Gw.jspi.wasm"),
    path.join(cacheDir, "metadata.json"),
    officialSha256,
    buildFingerprint(build),
  ))
    ? "valid"
    : "missing-or-invalid";
}

export async function prepareToolboxClient(
  officialWasmPath: string,
  cacheRoot: string,
): Promise<PreparedToolboxClient> {
  const inputHash = await sha256File(officialWasmPath);
  const build = findToolboxBuild(inputHash);
  if (!build) {
    return { wasmPath: officialWasmPath, build: null, transformed: false };
  }
  const cacheDir = path.join(cacheRoot, inputHash, String(TOOLBOX_TRANSFORM_ABI));
  const wasmPath = path.join(cacheDir, "Gw.jspi.wasm");
  const metadataPath = path.join(cacheDir, "metadata.json");
  const fingerprint = buildFingerprint(build);
  if (await isUsableCache(wasmPath, metadataPath, inputHash, fingerprint)) {
    return { wasmPath, build, transformed: true };
  }

  await mkdir(cacheDir, { recursive: true });
  const official = await readFile(officialWasmPath);
  const transformed = transformToolboxWasm(official, build);
  const outputHash = createHash("sha256").update(transformed).digest("hex");
  await writeAtomic(wasmPath, transformed);
  await writeAtomicJson(metadataPath, {
    inputSha256: inputHash,
    transformAbi: TOOLBOX_TRANSFORM_ABI,
    buildFingerprint: fingerprint,
    outputSha256: outputHash,
  });
  const file = await stat(wasmPath);
  if (!file.isFile() || file.size !== transformed.byteLength) {
    throw new Error("published derived Toolbox module is incomplete");
  }
  return { wasmPath, build, transformed: true };
}
