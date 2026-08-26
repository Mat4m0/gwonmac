/**
 * Semantic role of the client main-loop hook shared by feature proofs.
 * It grants no feature by itself.
 */
import { mutableSpans } from "./wasm-evidence.js";
import type { SemanticRole } from "./enhancement-evidence-types.js";

export const CLIENT_TICK_ROLE: SemanticRole = Object.freeze({
  bodyLength: 218,
  fingerprint: "55a9bca40e9e16713b0473d83afbe7264cd9578f0077d99075afafb076d5fa66",
  spans: mutableSpans([
    [27, 32, "tick.work-count"],
    [60, 65, "tick.work-list"],
    [146, 151, "tick.quit-flag"],
    [185, 190, "tick.tail-callback"],
  ]),
  params: Object.freeze(["i32"]),
  results: Object.freeze([]),
});
