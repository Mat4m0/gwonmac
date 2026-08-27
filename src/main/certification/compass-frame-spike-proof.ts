/**
 * Development-only authority for the named Compass frame locator and its
 * closed geometry layout. It composes existing frame-table proofs and never
 * grants a production capability or publishes locator values to the renderer.
 */
import {
  decodeFunctions,
  functionBodySha256,
  signatureMatches,
  type EnhancementProofContext,
} from "./wasm-evidence.js";
import {
  deriveCertifiedFrameLabel,
} from "./enhancement-pre-game-proof.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";

const COMPASS_OWNER_BODY_SHA256 =
  "e4ae212b84a9b2270784ed4fe46a24b6a3b757f80e16ed341388f449e342d29f";

type PreGameProof = NonNullable<KnownEnhancementBuild["preGameControls"]>;
type SkillFrameProof = NonNullable<KnownEnhancementBuild["skillSlotGeometry"]>;

export type CompassFrameSpikeProof = Readonly<{
  labelAddress: number;
  labelHash: number;
  ownerFunction: number;
  ownerBodySha256: string;
  layout: Readonly<{
    frameArray: number;
    frameCount: number;
    frameBytes: number;
    frameId: number;
    frameHashId: number;
    framePositionFlags: number;
    frameViewportWidth: number;
    frameViewportHeight: number;
    frameScreenLeft: number;
    frameScreenBottom: number;
    frameScreenRight: number;
    frameScreenTop: number;
    frameState: number;
  }>;
}>;

/** Refuse unless both existing frame proofs describe one exact frame table. */
export function deriveCompassFrameSpikeProof(
  context: EnhancementProofContext,
  preGame: PreGameProof,
  skillFrame: SkillFrameProof,
): CompassFrameSpikeProof | null {
  const named = deriveCertifiedFrameLabel(context, "Compass", 2);
  if (named === null) return null;
  const module = context.moduleView();
  const owners = decodeFunctions(module, [named.labelAddress]).filter(
    (candidate) => candidate.constantSites.filter(
      (site) => site.value === named.labelAddress,
    ).length === 2,
  );
  if (owners.length !== 1) return null;
  const owner = owners[0]!;
  if (
    !signatureMatches(module, owner.functionIndex, ["i32", "i32"], [])
    || functionBodySha256(module, owner.functionIndex)
      !== COMPASS_OWNER_BODY_SHA256
  ) return null;
  const shared = preGame.layout;
  const geometry = skillFrame.layout;
  if (
    shared.frameArray !== geometry.frameArray
    || shared.frameCount !== geometry.frameCount
    || shared.frameBytes !== geometry.frameBytes
    || shared.frameId !== geometry.frameId
    || shared.frameState !== geometry.frameState
  ) return null;
  return Object.freeze({
    labelAddress: named.labelAddress,
    labelHash: named.labelHash,
    ownerFunction: owner.functionIndex,
    ownerBodySha256: COMPASS_OWNER_BODY_SHA256,
    layout: Object.freeze({
      frameArray: shared.frameArray,
      frameCount: shared.frameCount,
      frameBytes: shared.frameBytes,
      frameId: shared.frameId,
      frameHashId: shared.frameHashId,
      framePositionFlags: geometry.framePositionFlags,
      frameViewportWidth: geometry.frameViewportWidth,
      frameViewportHeight: geometry.frameViewportHeight,
      frameScreenLeft: geometry.frameScreenLeft,
      frameScreenBottom: geometry.frameScreenBottom,
      frameScreenRight: geometry.frameScreenRight,
      frameScreenTop: geometry.frameScreenTop,
      frameState: shared.frameState,
    }),
  });
}
