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
    "62267d95b30752823aa364c289bdc84f2c025dac4caeda86a76a432001667acb",
    {
      memoryLayout: "relocated",
      outputSha256: "946a12cac572ba93149cc5d1e12c7e9976aad93b29fe771f9d82c001ddab38ef",
    },
  ],
  [
    "e22c2c0876f1381a133fbb0c739f73f9fc6a7d8988da5ce0d9789481ab7f0c9e",
    {
      memoryLayout: "relocated",
      outputSha256: "250007f511c495047661736b50cc12cee1f86a317d9698de09fa8beb6ced16c0",
    },
  ],
  [
    "e00e8368a1d0e1003bf1882dce2d4b3cd8e2e8b6c4acc72474c8b56e2e35c6bb",
    {
      memoryLayout: "official",
      outputSha256: "6f546f13bdb2ef6ec4118a5b1550b2523f178fc0a61061896037a44f3ac89659",
    },
  ],
  [
    "7db72c8d5b4864fb4526e1455edfee3755887a242f68ec1c2f8447cfb38ad281",
    {
      memoryLayout: "relocated",
      outputSha256: "1892f597d53988b5b541a7ca7997da8fc6758f0793e464293ba5f619152e6583",
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
