/**
 * Shared refusal vocabulary for bounded WASM evidence collection.
 * Feature locators translate these failures into their own verdicts.
 */
import type { EnhancementEvidenceFailure } from "./enhancement-evidence-types.js";

export class EvidenceError extends Error {
  readonly code: EnhancementEvidenceFailure;

  constructor(code: EnhancementEvidenceFailure) {
    super(code);
    this.code = code;
  }
}
