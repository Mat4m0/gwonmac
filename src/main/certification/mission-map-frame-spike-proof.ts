/**
 * Development-only authority for the exact MapWindow label and its closed
 * geometry layout. The zero-reference label is accepted only with the retained
 * open, move, resize, and close lifecycle proof documented by this spike.
 */
import type { EnhancementProofContext } from "./wasm-evidence.js";
import { deriveCertifiedFrameLabel } from "./enhancement-pre-game-proof.js";
import { deriveSkillSlotGeometry } from "./enhancement-skill-slot-geometry-proof.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";

type PreGameProof = NonNullable<KnownEnhancementBuild["preGameControls"]>;
type SkillFrameProof = NonNullable<KnownEnhancementBuild["skillSlotGeometry"]>;

export type MissionMapFrameSpikeProof = Readonly<{
  labelAddress: number;
  labelHash: number;
  layout: Readonly<{
    frameArray: number;
    frameCount: number;
    frameBytes: number;
    frameId: number;
    frameHashId: number;
    frameViewportWidth: number;
    frameViewportHeight: number;
    frameScreenLeft: number;
    frameScreenBottom: number;
    frameScreenRight: number;
    frameScreenTop: number;
    frameState: number;
  }>;
}>;

export function deriveMissionMapFrameSpikeProof(
  context: EnhancementProofContext,
  preGame: PreGameProof,
  skillFrame: SkillFrameProof,
): MissionMapFrameSpikeProof | null {
  const named = deriveCertifiedFrameLabel(context, "MapWindow", 0);
  const currentGeometry = deriveSkillSlotGeometry(context);
  if (named === null || currentGeometry === null) return null;
  const shared = preGame.layout;
  const retained = skillFrame.layout;
  const geometry = currentGeometry.layout;
  if (
    shared.frameBytes !== geometry.frameBytes
    || shared.frameId !== geometry.frameId
    || shared.frameState !== geometry.frameState
    || retained.frameBytes !== geometry.frameBytes
    || retained.frameId !== geometry.frameId
    || retained.frameState !== geometry.frameState
  ) return null;
  return Object.freeze({
    labelAddress: named.labelAddress,
    labelHash: named.labelHash,
    layout: Object.freeze({
      frameArray: geometry.frameArray,
      frameCount: geometry.frameCount,
      frameBytes: geometry.frameBytes,
      frameId: geometry.frameId,
      frameHashId: shared.frameHashId,
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
