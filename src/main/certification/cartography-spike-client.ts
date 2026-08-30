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
      outputSha256: "4018c8a174fffa626c4fb02d26e605d19d161dd7ed1079bb160d41360953f9d9",
    },
  ],
  [
    "7db72c8d5b4864fb4526e1455edfee3755887a242f68ec1c2f8447cfb38ad281",
    {
      memoryLayout: "relocated",
      outputSha256: "82d44183288d531fd09598b89e95bffd4dbcd843d5d0803d2ed6f0dfd8baac8a",
    },
  ],
  [
    "9d3383ad41e767570a0b2b8d8e2fec2e52cdcbd25d9c1680b8eb979f4eef6991",
    {
      memoryLayout: "relocated",
      outputSha256: "af80daa05c1886c451b3cb5a707508bb81cedc68dac18663c92498019319efaa",
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
      outputSha256: "3016b231dc47236360598f58f5dc35066595028c2a3aae39e2a9ca9580a2a656",
    },
  ],
  [
    "87469f9cd8b93bd36e5b401bf0450d47b7856322de6e001c9c9d7dd996cd98d4",
    {
      memoryLayout: "official",
      outputSha256: "393b23f080f10491d209031570fdfe7e80063dbb48f8fcb8c33fc662a2067a6b",
    },
  ],
  [
    "81a2ceb81db4e8ae35f561a20b3c76dbb0b692a1e5ab4de7ff2879e0e8720d53",
    {
      memoryLayout: "official",
      outputSha256: "5ca898031b871a71f8ada41c81cfeb1150261998b866cbfb315fb4607c0fd594",
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
