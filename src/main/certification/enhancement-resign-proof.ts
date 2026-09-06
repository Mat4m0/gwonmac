/**
 * Proves the reviewed native chat submission path for the fixed Resign action.
 * Exact bodies bind the editor, history owner, and native sender together;
 * a changed client withdraws only this action until it is reviewed again.
 */
import type { KnownEnhancementBuild } from "./enhancement-build-model.js";
import type { ModuleShape } from "./enhancement-evidence-types.js";
import { uniqueExactFunction } from "./wasm-evidence.js";

const SENDER_SHA256 = "ee40947fd46b4a8b408fc7e1647729dd989a77599f4f637280cc7ca27d56390f";

export const RESIGN_NATIVE_SENDER = Object.freeze({
  functionIndex: 7875,
  params: Object.freeze(["i32", "i32"] as const),
  results: Object.freeze([] as const),
  bodySha256: SENDER_SHA256,
});

export function deriveResignAction(module: ModuleShape): KnownEnhancementBuild["resignAction"] | null {
  // These exact bodies include their call operands. The editor submits through
  // history #7883, which calls sender #7875 with the UTF-16 line and agent ID.
  if (uniqueExactFunction(module,
    "0a140a3dd416fa6256572baa07fc601b4c2516197086ef88e828c01102c63cc2",
    ["i32"], []) !== 13720
    || uniqueExactFunction(module,
      "b09d619996a57afd40ad95e28042913dd12933681343488cb26c24ac5f4902ff",
      ["i32", "i32"], []) !== 7883
    || uniqueExactFunction(module, SENDER_SHA256, ["i32", "i32"], []) !== 7875) {
    return null;
  }
  return RESIGN_NATIVE_SENDER;
}
