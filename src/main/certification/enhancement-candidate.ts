/**
 * Read-only reporting for a possible Enhancement client module. Inspection
 * describes structure for recertification tooling and grants no capability.
 */
import { createHash } from "node:crypto";
import {
  countFunctionImports,
  parseExports,
  parseIndexVector,
  parseTypes,
  sectionById,
  splitSections,
  valueTypeName,
} from "../core/wasm-binary.js";
import { findEnhancementBuild } from "./enhancement-builds.js";
import {
  enhancementTableSlotFunctions,
  parseEnhancementTable,
} from "./enhancement-table.js";

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
  const sections = splitSections(input);
  const types = parseTypes(sectionById(sections, 1));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const mainLoopExport = parseExports(sectionById(sections, 7)).find(
    (entry) => entry.kind === 0 && entry.name === "EmscriptenExeThreadMainLoop",
  );
  let mainLoop: EnhancementCandidateReport["mainLoop"] = null;
  if (mainLoopExport && mainLoopExport.index >= importCount) {
    const localIndex = mainLoopExport.index - importCount;
    const typeIndex = functionTypes[localIndex];
    const type = typeIndex === undefined ? undefined : types[typeIndex];
    if (type) {
      mainLoop = {
        functionIndex: mainLoopExport.index,
        params: type.params.map(valueTypeName),
        results: type.results.map(valueTypeName),
      };
    }
  }
  let table: EnhancementCandidateReport["table"];
  try {
    const { min, max } = parseEnhancementTable(sectionById(sections, 4));
    const occupied = enhancementTableSlotFunctions(sectionById(sections, 9));
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
