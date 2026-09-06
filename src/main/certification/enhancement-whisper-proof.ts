/**
 * Binds the whisper observer's bounded grammar to the reviewed incoming
 * producer and native string encoders. Submission reuses the native chat proof.
 */
import type { ModuleShape } from "./enhancement-evidence-types.js";
import { deriveResignAction } from "./enhancement-resign-proof.js";
import { uniqueExactFunction } from "./wasm-evidence.js";

export function deriveWhisperChat(module: ModuleShape) {
  // Exact call operands preserve the incoming producer -> encoders -> log path.
  // The native copier includes its terminator in the sender's 138-unit bound.
  if (uniqueExactFunction(module,
    "1c87ab4b0831420341935898d106c902d85897a116b4beb7492bf4ab3b1ea9c7",
    ["i32", "i32", "i32"], []) !== 358
    || uniqueExactFunction(module,
      "e5219c5355c51257a5976823caff07d4f611c50720a03959506e83122b8933cd",
      ["i32"], []) !== 11733
    || uniqueExactFunction(module,
      "41a00c1127d3ccafb0bc721a6ec64b9a755355e73d3d0938cbf51900257ab7b6",
      ["i32", "i32", "i32"], ["i32"]) !== 5865
    || uniqueExactFunction(module,
      "013e7a049e0be2d3e4597d1feee0bad39f0ba1fe1d5ffd82cf35397630264e10",
      ["i32", "i32", "i32", "i32"], ["i32"]) !== 5871) return null;
  return deriveResignAction(module);
}
