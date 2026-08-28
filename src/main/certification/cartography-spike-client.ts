/**
 * Seals the exact-build cartography observation transform and its derived cache.
 * Refuses every client whose certified source evidence does not match exactly.
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
} from "./pathing-spike-transform.js";

const OUTPUT_SHA256 = Object.freeze(new Map<string, string>([
  [
    "e00e8368a1d0e1003bf1882dce2d4b3cd8e2e8b6c4acc72474c8b56e2e35c6bb",
    "0942ca6e16926ade3789c8c3c2f4dfe4ddb88ba5f52a0b4c2fee40d4e88c7b8f",
  ],
  [
    "f489cbd47bfd10642b31012cfde24546b564510cc38512e3d1f1cc072e4ee25c",
    "708c3b3da97b79f182ff1d964d7761fb122b0092b1cab60689f7dd53fb669e5b",
  ],
]));

export type CartographySpikePreparation = Readonly<{
  wasmPath: string;
  wasmSha256: string;
  error: unknown | null;
}>;

/** Prepare the sealed development client without leaking spike policy into the chain. */
export async function prepareCartographySpike(
  wasmPath: string,
  wasmSha256: string,
  cacheRoot: string,
): Promise<CartographySpikePreparation> {
  const expectedOutputSha256 = OUTPUT_SHA256.get(wasmSha256);
  if (!expectedOutputSha256) {
    await discardDerivedWasm(cacheRoot).catch(() => undefined);
    return Object.freeze({
      wasmPath,
      wasmSha256,
      error: new Error("cartography spike certificate does not match the served client"),
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
    expectedOutputSha256,
  };
  try {
    return Object.freeze({
      wasmPath: await prepareDerivedWasm(wasmPath, cache, transformCartographySpikeWasm),
      wasmSha256: expectedOutputSha256,
      error: null,
    });
  } catch (error) {
    return Object.freeze({ wasmPath, wasmSha256, error });
  }
}
