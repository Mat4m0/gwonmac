/**
 * Proves the native producer of the alcohol post-processing notification.
 * Only its UI-dispatch relocation may vary; the level / 5 conversion and
 * eight-byte tint/intensity payload must retain their reviewed meaning.
 */
import type { ModuleShape } from "./enhancement-evidence-types.js";
import type { KnownEnhancementBuild } from "./enhancement-build-model.js";
import { functionBody, functionBodySha256, semanticRole, soleValue,
  uniqueRoleFunction, valuesForRole } from "./wasm-evidence.js";

export const ALCOHOL_PRODUCER_ROLE = semanticRole(72,
  "cf1a45dde7bff3edb7a2b16c9a074f2d8e86e15e32560f0d9efc4395046f4649",
  [{ start: 55, end: 60, role: "alcohol.ui", addressClass: "function-index" }],
  ["i32", "i32"], []);
type Proof = NonNullable<KnownEnhancementBuild["alcoholObservation"]>;
export function deriveAlcoholObservation(module: ModuleShape, dispatcher: number): Proof | null {
  const index = uniqueRoleFunction(module, ALCOHOL_PRODUCER_ROLE);
  if (index === null || soleValue(valuesForRole(functionBody(module, index),
    ALCOHOL_PRODUCER_ROLE), "alcohol.ui") !== dispatcher) return null;
  return Object.freeze({ functionIndex: index, params: ["i32", "i32"] as const,
    results: [] as const, bodySha256: functionBodySha256(module, index) });
}
export function isAlcoholObservationProof(value: unknown): value is Proof {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<Proof>;
  return Object.keys(value).sort().join(",") === "bodySha256,functionIndex,params,results"
    && Number.isSafeInteger(p.functionIndex) && Number(p.functionIndex) >= 0
    && Array.isArray(p.params) && p.params.length === 2 && p.params.every(v => v === "i32")
    && Array.isArray(p.results) && p.results.length === 0
    && typeof p.bodySha256 === "string" && /^[0-9a-f]{64}$/u.test(p.bodySha256);
}
