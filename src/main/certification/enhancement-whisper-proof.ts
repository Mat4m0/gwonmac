/**
 * Binds the whisper observer's bounded grammar to the reviewed incoming
 * producer and native string encoders. Submission reuses the native chat proof.
 */
import type { ModuleShape } from "./enhancement-evidence-types.js";
import { deriveResignAction } from "./enhancement-resign-proof.js";
import { uniqueExactFunction } from "./wasm-evidence.js";

// These complete paths retain the bounded copier, both string encoders, and
// incoming/outgoing producers. The October log message uses the current UI ID.
const WHISPER_PATHS = Object.freeze([
  { sender: 7875,
    functions: [
      [358, "1c87ab4b0831420341935898d106c902d85897a116b4beb7492bf4ab3b1ea9c7", ["i32", "i32", "i32"], []],
      [11733, "e5219c5355c51257a5976823caff07d4f611c50720a03959506e83122b8933cd", ["i32"], []],
      [5865, "41a00c1127d3ccafb0bc721a6ec64b9a755355e73d3d0938cbf51900257ab7b6", ["i32", "i32", "i32"], ["i32"]],
      [5871, "013e7a049e0be2d3e4597d1feee0bad39f0ba1fe1d5ffd82cf35397630264e10", ["i32", "i32", "i32", "i32"], ["i32"]],
      [11731, "a5fc88ce65502cd25f36d42cb9fdf9fb2b43a97fca11cca84fc1ae7683f6c94d", ["i32", "i32"], []],
      [8841, "6694fdf5dc2395af5adab5e60840eba7467316720b57c4e3a64f4526bb027b5c", ["i32"], ["i32"]],
      [5779, "891338b8d47c134f1c659501c6775f5355f596716d6b56f9defddc1f0fbad665", ["i32", "i32", "i32", "i32", "i32"], ["i32"]],
    ] },
  { sender: 7879,
    functions: [
      [358, "1c87ab4b0831420341935898d106c902d85897a116b4beb7492bf4ab3b1ea9c7", ["i32", "i32", "i32"], []],
      [11744, "590a926a7560d5d0c32312b7f9ba9e50315b526aed6b23cf55ebad2421e76d0a", ["i32"], []],
      [5865, "b88229a6b7d411496d322da159d32be90cf2e4a574f893dc4f7ca98c7bf79181", ["i32", "i32", "i32"], ["i32"]],
      [5871, "013e7a049e0be2d3e4597d1feee0bad39f0ba1fe1d5ffd82cf35397630264e10", ["i32", "i32", "i32", "i32"], ["i32"]],
      [11742, "6ee9ac22cdefbad07c81dab6efe7fc60c44c93b00be3e190a28c2e8653f4c8ce", ["i32", "i32"], []],
      [8847, "6694fdf5dc2395af5adab5e60840eba7467316720b57c4e3a64f4526bb027b5c", ["i32"], ["i32"]],
      [5779, "6bbd6f5802d760ba6d72568c07901c0ae989ba290458b8cdeaa5db39da7a0cd4", ["i32", "i32", "i32", "i32", "i32"], ["i32"]],
    ] },
] as const);

export function deriveWhisperChat(module: ModuleShape) {
  const sender = deriveResignAction(module);
  if (!sender) return null;
  return WHISPER_PATHS.some(path => path.sender === sender.functionIndex
    && path.functions.every(([index, hash, params, results]) =>
      uniqueExactFunction(module, hash, params, results) === index)) ? sender : null;
}
