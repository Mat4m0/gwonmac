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
      outputSha256: "415cb41793e7b08b18a14c2b0ebcdeb5811c003ed350bb517ac49e48f95c28d5",
    },
  ],
  [
    "7db72c8d5b4864fb4526e1455edfee3755887a242f68ec1c2f8447cfb38ad281",
    {
      memoryLayout: "relocated",
      outputSha256: "35035470153136329f0ffddaad2e2be2ab66fb7f8d457deba0f75a731962813e",
    },
  ],
  [
    "9d3383ad41e767570a0b2b8d8e2fec2e52cdcbd25d9c1680b8eb979f4eef6991",
    {
      memoryLayout: "relocated",
      outputSha256: "ac6a0b4ce1f66dcecbabfaa13888aa8262e46dcaf1a319ffbc1d85a4551802fc",
    },
  ],
  [
    "aca501484f766c95c27a47ffbd09bb5f5a162de7106500450295d4e61272efbb",
    {
      memoryLayout: "relocated",
      outputSha256: "8a61e05c24f205d104e3f2950f5834667437a48ee080767080585b428bbc9f31",
    },
  ],
  [
    "1f4a199ea902f839abb3b71861759f956db2aa4e7f31fcabd1970d12d24ca3a0",
    {
      memoryLayout: "relocated",
      outputSha256: "18b177e4678f2ddddc5a817dca1568d20a18ab2118cab0a584a5a78d07eb54e3",
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
