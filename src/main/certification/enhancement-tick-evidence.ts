/**
 * Feature-owned selection of the ArenaNet main-loop export.
 * It grants no authority to unrelated client capabilities.
 */
import type { ModuleShape } from "./enhancement-evidence-types.js";
import type { TickEvidenceReport } from "./enhancement-evidence-types.js";
import {
  functionBodySha256,
  functionHasSignature,
  signatureEvidence,
} from "./wasm-evidence.js";

export function tickEvidence(module: ModuleShape): TickEvidenceReport {
  const exports = module.exports.filter(
    (entry) => entry.name === "EmscriptenExeThreadMainLoop",
  );
  const considered = exports.map((entry) => ({
    functionIndex: entry.index,
    signature: entry.kind === 0 ? signatureEvidence(module, entry.index) : null,
  }));
  const exact = exports.filter(
    (entry) => entry.kind === 0 && functionHasSignature(module, entry.index, 1),
  );
  if (exports.length === 1 && exact.length === 1) {
    const functionIndex = exact[0]!.index;
    return {
      status: "candidate",
      exportCount: 1,
      considered,
      candidate: {
        functionIndex,
        signature: signatureEvidence(module, functionIndex)!,
        bodySha256: functionBodySha256(module, functionIndex),
      },
    };
  }
  return {
    status: exact.length > 1 ? "ambiguous" : "unavailable",
    exportCount: exports.length,
    considered,
    candidate: null,
  };
}
