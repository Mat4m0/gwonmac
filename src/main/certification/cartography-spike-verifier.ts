/**
 * Isolated semantic qualification for the Cartography transform.
 *
 * Cartography is not tied to a whole-client hash. Instead, the verifier proves
 * the exact frame, game-context, area-table, and agent-array layout consumed by
 * the transform and sealed reachability kernel. The main process receives only
 * this bounded certificate and independently reproduces its exact output.
 */
import { createHash } from "node:crypto";
import { derivePreGameControls } from "./enhancement-pre-game-proof.js";
import {
  deriveObservationLayout,
  derivePlayRegionLayout,
} from "./enhancement-target-proof.js";
import {
  CARTOGRAPHY_MEMORY_LAYOUTS,
} from "./cartography-transform-internals.js";
import {
  CARTOGRAPHY_SPIKE_TRANSFORM_ABI,
  transformCartographySpikeWasm,
  type CartographyMemoryLayoutId,
} from "./pathing-spike-transform.js";
import { enhancementProofContext } from "./wasm-evidence.js";

const SHA256 = /^[0-9a-f]{64}$/;
const MEMORY_LAYOUT_IDS: readonly CartographyMemoryLayoutId[] = [
  "official",
  "relocated",
];

export interface CartographySpikeBuild {
  readonly inputSha256: string;
  readonly transformAbi: typeof CARTOGRAPHY_SPIKE_TRANSFORM_ABI;
  readonly memoryLayout: CartographyMemoryLayoutId;
  readonly outputSha256: string;
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function matchingMemoryLayout(input: Uint8Array): CartographyMemoryLayoutId | null {
  const context = enhancementProofContext(input);
  if (!context) return null;
  const module = context.moduleView();
  const playRegion = derivePlayRegionLayout(module);
  const observation = deriveObservationLayout(module);
  if (!playRegion || !observation) return null;
  const preGame = derivePreGameControls(context, playRegion);
  if (!preGame) return null;

  const matches = MEMORY_LAYOUT_IDS.filter((memoryLayout) => {
    const layout = CARTOGRAPHY_MEMORY_LAYOUTS[memoryLayout];
    return (
      layout.frameArray === preGame.layout.frameArray
      && layout.frameCount === preGame.layout.frameCount
      && layout.contextRoot === playRegion.contextRoot
      && layout.areaInfo === playRegion.areaInfo
      && layout.agentArray === observation.agentArray
    );
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

/** Derive one exact Cartography transaction from semantically unchanged input. */
export function deriveCartographySpikeBuild(
  input: Uint8Array,
): CartographySpikeBuild | null {
  try {
    const memoryLayout = matchingMemoryLayout(input);
    if (!memoryLayout) return null;
    return Object.freeze({
      inputSha256: sha256(input),
      transformAbi: CARTOGRAPHY_SPIKE_TRANSFORM_ABI,
      memoryLayout,
      outputSha256: sha256(transformCartographySpikeWasm(input, memoryLayout)),
    });
  } catch {
    return null;
  }
}

/** Validate the small record returned across the utility-process boundary. */
export function isCartographySpikeBuild(
  value: unknown,
  inputSha256: string,
): value is CartographySpikeBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<CartographySpikeBuild>;
  return Object.keys(value).length === 4
    && build.inputSha256 === inputSha256
    && SHA256.test(build.inputSha256)
    && build.transformAbi === CARTOGRAPHY_SPIKE_TRANSFORM_ABI
    && (build.memoryLayout === "official" || build.memoryLayout === "relocated")
    && typeof build.outputSha256 === "string"
    && SHA256.test(build.outputSha256);
}
