/**
 * Proves the reviewed native chat submission path for the fixed Resign action.
 * Exact bodies bind the editor, history owner, and native sender together;
 * a changed client withdraws only this action until it is reviewed again.
 */
import { isDeepStrictEqual } from "node:util";
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

// Each family keeps the complete editor → history → sender call operands.
// A sender hash alone cannot establish which editor submits through it.
const CHAT_PATHS = Object.freeze([
  { editor: [13720, "0a140a3dd416fa6256572baa07fc601b4c2516197086ef88e828c01102c63cc2"],
    history: [7883, "b09d619996a57afd40ad95e28042913dd12933681343488cb26c24ac5f4902ff"],
    sender: RESIGN_NATIVE_SENDER },
  { editor: [13720, "0a140a3dd416fa6256572baa07fc601b4c2516197086ef88e828c01102c63cc2"],
    history: [7883, "d2a81b247540e55865220ae01278ba0f8b05850644f8ab1f92b854d2bb2b8f70"],
    sender: RESIGN_NATIVE_SENDER },
  { editor: [13731, "76e151311a1e399615edc764373635e462f8794b8b94c8ff04e499aa83b517c4"],
    history: [7887, "a46c498e45784cfacfcd90ca9c7c669a6216ab1aea5843d26ecb355ad1ecfba5"],
    sender: Object.freeze({ functionIndex: 7879,
      params: Object.freeze(["i32", "i32"] as const), results: Object.freeze([] as const),
      bodySha256: "3947df1c888113fe94a12fea2f3d500387b71f2e56b8ddf970d571621248b584" }) },
] as const);

export function isResignNativeSender(value: unknown): boolean {
  return CHAT_PATHS.some(({ sender }) => isDeepStrictEqual(value, sender));
}

export function deriveResignAction(module: ModuleShape): KnownEnhancementBuild["resignAction"] | null {
  const matches = CHAT_PATHS.filter(({ editor, history, sender }) =>
    uniqueExactFunction(module, editor[1], ["i32"], []) === editor[0]
    && uniqueExactFunction(module, history[1], ["i32", "i32"], []) === history[0]
    && uniqueExactFunction(module, sender.bodySha256, sender.params, sender.results)
      === sender.functionIndex);
  return matches.length === 1 ? matches[0]!.sender : null;
}
