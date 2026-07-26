import {
  buildFingerprint,
  type DerivedWasmCache,
  discardDerivedWasm,
  inspectDerivedWasmCache,
  prepareDerivedWasm,
  sha256File,
} from "./derived-wasm.js";
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
}

/**
 * The Toolbox transform consumes whatever module the launch has already
 * settled on — today the template-save client, and the official module only
 * when that build is uncertified. It is never told which of the two it got.
 */
function toolboxCache(
  baseSha256: string,
  build: KnownToolboxBuild,
  cacheRoot: string,
): DerivedWasmCache {
  return {
    inputSha256: baseSha256,
    cacheRoot,
    transformAbi: TOOLBOX_TRANSFORM_ABI,
    buildFingerprint: buildFingerprint(build),
    // The kernel is built from source, so the output hash is not known until
    // the transform runs; the cache records the one it published.
    expectedOutputSha256: null,
  };
}

export async function inspectToolboxCache(
  baseSha256: string,
  build: KnownToolboxBuild,
  cacheRoot: string,
): Promise<"valid" | "missing-or-invalid"> {
  return inspectDerivedWasmCache(toolboxCache(baseSha256, build, cacheRoot));
}

export async function prepareToolboxClient(
  baseWasmPath: string,
  cacheRoot: string,
): Promise<PreparedToolboxClient> {
  const inputSha256 = await sha256File(baseWasmPath);
  const build = findToolboxBuild(inputSha256);
  if (!build) {
    await discardDerivedWasm(cacheRoot);
    return { wasmPath: baseWasmPath, build: null };
  }

  const wasmPath = await prepareDerivedWasm(
    baseWasmPath,
    toolboxCache(inputSha256, build, cacheRoot),
    (base) => transformToolboxWasm(base, build),
  );
  return { wasmPath, build };
}
