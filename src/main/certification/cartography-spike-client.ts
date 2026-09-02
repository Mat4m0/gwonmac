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
} from "./pathing-spike-transform.js";
import type { CartographySpikeBuild } from "./cartography-spike-verifier.js";

export type CartographySpikePreparation =
  | Readonly<{
      status: "active";
      wasmPath: string;
      wasmSha256: string;
    }>
  | Readonly<{
      status: "unavailable";
      wasmPath: string;
      wasmSha256: string;
      error: unknown;
    }>;

/** Prepare Cartography only from an isolated semantic certificate. */
export async function prepareCartographySpike(
  wasmPath: string,
  wasmSha256: string,
  cacheRoot: string,
  verifyLocally: (options: {
    wasmPath: string;
    inputSha256: string;
  }) => Promise<CartographySpikeBuild | null> = async () => null,
): Promise<CartographySpikePreparation> {
  const build = await verifyLocally({ wasmPath, inputSha256: wasmSha256 });
  if (!build) {
    await discardDerivedWasm(cacheRoot).catch(() => undefined);
    return Object.freeze({
      status: "unavailable",
      wasmPath,
      wasmSha256,
      error: new Error(`Cartography semantic proof refused input ${wasmSha256}`),
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
      status: "active",
      wasmPath: await prepareDerivedWasm(
        wasmPath,
        cache,
        (input) => transformCartographySpikeWasm(input, build.memoryLayout),
      ),
      wasmSha256: build.outputSha256,
    });
  } catch (error) {
    return Object.freeze({
      status: "unavailable",
      wasmPath,
      wasmSha256,
      error,
    });
  }
}
