/**
 * Public entry point for structural Enhancement evidence and feature proofs.
 *
 * Parsing and proof mechanics live in the capability-free WASM context. Each
 * launch-authority proof is isolated in its owning feature module so changing
 * one feature cannot silently widen another feature's authority.
 */
export { inspectEnhancementStructuralEvidence } from "./enhancement-structural-report.js";
export { locateAutomaticCursor } from "./enhancement-cursor-proof.js";
export {
  inspectTargetRoleCandidates,
  locateAutomaticTarget,
  type TargetRoleCandidateDiagnostic,
} from "./enhancement-target-proof.js";
export { locateAutomaticLocalActions } from "./enhancement-local-actions-proof.js";
export { enhancementProofContext } from "./enhancement-wasm-proof-context.js";
export type { EnhancementProofContext } from "./enhancement-wasm-proof-context.js";

export type {
  AutomaticCursorLocation,
  AutomaticLocalActionsLocation,
  AutomaticTargetLocation,
  CursorConsideration,
  CursorEvidenceReport,
  EnhancementEvidenceFailure,
  EnhancementEvidenceStatus,
  EnhancementStructuralEvidenceReport,
  FunctionSignatureEvidence,
  MessageProducerEvidence,
  PlayerChatMessageAnchors,
  PlayerChatUiConsideration,
  PlayerChatUiEvidenceReport,
  TickEvidenceReport,
} from "./enhancement-evidence-types.js";
