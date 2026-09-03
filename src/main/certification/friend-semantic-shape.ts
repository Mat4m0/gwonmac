/**
 * Relocation-aware body identity shared by the friend record and lifecycle proofs.
 * Function indices and static addresses change without weakening exact body checks.
 */
import type { DecodedFunction, ModuleShape } from "./enhancement-evidence-types.js";
import { relocationAwareFingerprint, type RelocationSpan } from "./semantic-proof.js";
import type { WasmDataEvidence } from "./wasm-data-evidence.js";

export function friendSignatureRole(module: ModuleShape, functionIndex: number): string {
  const type = module.types[module.functionTypeIndices[functionIndex] ?? -1];
  return type ? `${type.params.join(",")}->${type.results.join(",")}` : "missing";
}

export function friendSemanticBodyShape(
  module: ModuleShape,
  data: WasmDataEvidence,
  fn: DecodedFunction,
): string | null {
  const body = module.bodies[fn.functionIndex - module.functionImportCount];
  if (!body) return null;
  const spans: RelocationSpan[] = [];
  const calleeRoles = new Map<number, number>();
  const calls = [...fn.callSites].flatMap(([target, sites]) =>
    sites.map((site) => ({ target, site }))).sort((left, right) => left.site.offset - right.site.offset);
  for (const { target, site } of calls) {
    if (!calleeRoles.has(target)) calleeRoles.set(target, calleeRoles.size);
    spans.push({
      start: site.offset + 1, end: site.operandEnd,
      addressClass: "function-index",
      role: `callee-${calleeRoles.get(target)}:${friendSignatureRole(module, target)}`,
    });
  }
  const operands = [...fn.constantSites, ...fn.memorySites];
  const mutableRoles = new Map<number, number>();
  for (const site of operands) {
    if (site.value >= data.zeroInitializedBase && site.value < data.initialMemoryBytes) {
      if (!mutableRoles.has(site.value)) mutableRoles.set(site.value, mutableRoles.size);
      spans.push({
        start: site.operandStart, end: site.operandEnd,
        addressClass: "mutable-static", role: `state-${mutableRoles.get(site.value)}`,
      });
    } else if (data.contains(site.value)) {
      const text = data.readCString(site.value);
      if (text) {
        spans.push({
          start: site.operandStart, end: site.operandEnd,
          addressClass: "immutable-data", role: text,
        });
      }
    }
  }
  return relocationAwareFingerprint(body, spans);
}
