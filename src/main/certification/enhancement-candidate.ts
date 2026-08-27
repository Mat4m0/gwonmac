/**
 * Read-only reporting for a possible Enhancement client module. Inspection
 * describes structure for recertification tooling and grants no capability.
 */
import { createHash } from "node:crypto";
import { findEnhancementBuild } from "./enhancement-builds.js";
import { parseEnhancementTable } from "./enhancement-table.js";
import {
  activeTableEvidence,
  signatureEvidence,
  wasmEvidence,
} from "./wasm-evidence.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export interface EnhancementCandidateReport {
  sha256: string;
  validWasm: boolean;
  certifiedBuildId: number | null;
  mainLoop: {
    functionIndex: number;
    params: string[];
    results: string[];
  } | null;
  table: {
    min: number;
    max: number | null;
    firstEmptySlots: number[];
  } | null;
}

export function inspectEnhancementCandidate(
  input: Uint8Array,
): EnhancementCandidateReport {
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (!WebAssembly.validate(input)) {
    return {
      sha256,
      validWasm: false,
      certifiedBuildId: null,
      mainLoop: null,
      table: null,
    };
  }
  const evidence = wasmEvidence(input);
  if (!evidence) {
    return {
      sha256,
      validWasm: true,
      certifiedBuildId: null,
      mainLoop: null,
      table: null,
    };
  }
  const module = evidence.moduleView();
  const mainLoopExport = module.exports.find(
    (entry) => entry.kind === 0 && entry.name === "EmscriptenExeThreadMainLoop",
  );
  let mainLoop: EnhancementCandidateReport["mainLoop"] = null;
  if (mainLoopExport) {
    const signature = signatureEvidence(module, mainLoopExport.index);
    if (signature) {
      mainLoop = {
        functionIndex: mainLoopExport.index,
        params: [...signature.params],
        results: [...signature.results],
      };
    }
  }
  let table: EnhancementCandidateReport["table"];
  try {
    if (!module.tableSection) throw new Error("missing table section");
    const { min, max } = parseEnhancementTable(module.tableSection);
    const active = activeTableEvidence(module.elementSection);
    if (active.overwrittenSlots.length > 0) throw new Error("overwritten table slot");
    const occupied = new Set([...active.relations.values()].flat());
    const firstEmptySlots: number[] = [];
    for (let slot = 0; slot < min && firstEmptySlots.length < 8; slot += 1) {
      if (!occupied.has(slot)) firstEmptySlots.push(slot);
    }
    table = { min, max, firstEmptySlots };
  } catch {
    table = null;
  }
  return {
    sha256,
    validWasm: true,
    certifiedBuildId: findEnhancementBuild(sha256)?.buildId ?? null,
    mainLoop,
    table,
  };
}
