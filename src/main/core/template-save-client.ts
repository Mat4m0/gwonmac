import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "./atomic-file.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_TRANSFORM_ABI,
} from "./template-save-compat.js";

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function prepareTemplateSaveClient(
  officialWasmPath: string,
  cacheRoot: string,
): Promise<{ wasmPath: string; compatible: boolean }> {
  const inputHash = await sha256File(officialWasmPath);
  const build = findTemplateSaveBuild(inputHash);
  if (!build) {
    await rm(cacheRoot, { recursive: true, force: true });
    return { wasmPath: officialWasmPath, compatible: false };
  }

  const cacheDir = path.join(
    cacheRoot,
    inputHash,
    String(TEMPLATE_SAVE_TRANSFORM_ABI),
  );
  const wasmPath = path.join(cacheDir, "Gw.jspi.wasm");
  try {
    const file = await stat(wasmPath);
    if (
      file.isFile()
      && file.size > 0
      && await sha256File(wasmPath) === build.outputSha256
    ) {
      return { wasmPath, compatible: true };
    }
  } catch {
    // Missing or stale derived data is rebuilt from the canonical artifact.
  }

  const official = await readFile(officialWasmPath);
  const transformed = rewriteTemplateSaveWasm(official, build);
  await rm(cacheRoot, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });
  await writeAtomic(wasmPath, transformed);
  if (await sha256File(wasmPath) !== build.outputSha256) {
    throw new Error("published template-save module failed verification");
  }
  return { wasmPath, compatible: true };
}
