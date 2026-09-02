/**
 * Prepares certified native Cartography observers and their derived cache.
 * It refuses a module whose observer transform cannot prove its boundaries.
 */
import {
  buildFingerprint,
  discardDerivedWasm,
  prepareDerivedWasm,
  type DerivedWasmCache,
} from "../core/derived-wasm.js";
import {
  CARTOGRAPHY_SPIKE_TRANSFORM_ABI,
  transformCartographySpikeWasm,
  type CartographyMemoryLayoutId,
} from "./pathing-spike-transform.js";

interface CertifiedCartographyBuild {
  readonly memoryLayout: CartographyMemoryLayoutId;
  readonly outputSha256: string;
}

/**
 * Exact outputs of the finite client chains we ship. A transform change must
 * be independently recertified and update these seals before it can run.
 */
const CERTIFIED_CARTOGRAPHY_BUILDS: ReadonlyMap<string, CertifiedCartographyBuild> = new Map([
  [
    "e00e8368a1d0e1003bf1882dce2d4b3cd8e2e8b6c4acc72474c8b56e2e35c6bb",
    {
      memoryLayout: "official",
      outputSha256: "2d85aaa0ca4deb4e314528d17d17835e2de3648f645dcba15f700eeb829534f3",
    },
  ],
  [
    "7db72c8d5b4864fb4526e1455edfee3755887a242f68ec1c2f8447cfb38ad281",
    {
      memoryLayout: "relocated",
      outputSha256: "5935dbaa890cf53aa515f67d54b3ea1705f94361672dfb99c59ebf86f31cca34",
    },
  ],
]);

export type CartographySpikePreparation = Readonly<{
  wasmPath: string;
  wasmSha256: string;
  error: unknown | null;
}>;

/** Prepare Cartography only for an exact, independently sealed client chain. */
export async function prepareCartographySpike(
  wasmPath: string,
  wasmSha256: string,
  cacheRoot: string,
): Promise<CartographySpikePreparation> {
  const build = CERTIFIED_CARTOGRAPHY_BUILDS.get(wasmSha256);
  if (!build) {
    await discardDerivedWasm(cacheRoot).catch(() => undefined);
    return Object.freeze({
      wasmPath,
      wasmSha256,
      error: new Error(`uncertified Cartography input ${wasmSha256}`),
    });
  }
  const cache: DerivedWasmCache = {
    inputSha256: wasmSha256,
    cacheRoot,
    transformAbi: CARTOGRAPHY_SPIKE_TRANSFORM_ABI,
    buildFingerprint: buildFingerprint({
      loader: 3208,
      converter: 3216,
      callSiteOffset: 0x1b9,
      missionMapLabelHash: 3_378_147_614,
      worldMapDispatcher: 16_223,
      worldMapTableSlot: 4_152,
    }),
    expectedOutputSha256: build.outputSha256,
  };
  try {
    return Object.freeze({
      wasmPath: await prepareDerivedWasm(
        wasmPath,
        cache,
        (input) => transformCartographySpikeWasm(input, build.memoryLayout),
      ),
      wasmSha256: build.outputSha256,
      error: null,
    });
  } catch (error) {
    return Object.freeze({ wasmPath, wasmSha256, error });
  }
}
