/**
 * Owns the one guard a host-driven native texture swap needs. The swap
 * (1569 -> 1532) asserts `m_renderRefCount == 0` in GrModel.cpp and aborts the
 * client while the renderer still holds the model. Publishers run from the
 * host's animation frame, outside the client's own frame, so they read that
 * same field first and report busy instead of swapping.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";

/** 750 resolves the model handle; 1532 owns the render-reference field. */
export const NATIVE_RENDER_REFERENCE_FUNCTIONS = [
  [750, "f198025ffa70c6a269469f8464953d303a8e1da314d2b86a27fa2e11931c6bbf"],
  [1532, "f77af25d4e59724cd0ed6103fb9fcbe92b035e09ee24456f00fafdc44bfc286a"],
] as const;

// 1569 resolves its handle as 750(handle, *(20 + 1341168)); pinning 1569's
// body pins this address. 1532 asserts on the i32 at model + 152.
const MODEL_TYPE_BASE = 20;
const MODEL_TYPE_OFFSET = 1341168;
const RENDER_REFERENCE_OFFSET = 152;

/**
 * Leaves 1 on the stack when the model behind `handle` is missing or still
 * referenced by the renderer, else 0. `scratch` must be an i32 local.
 */
export function nativeModelBusy(handle: Uint8Array, scratch: number): Uint8Array {
  return concat(
    handle,
    Uint8Array.of(0x41), sleb(MODEL_TYPE_BASE),
    Uint8Array.of(0x28, 2), uleb(MODEL_TYPE_OFFSET),
    Uint8Array.of(0x10), uleb(750),
    Uint8Array.of(0x22), uleb(scratch),
    Uint8Array.of(0x45),
    Uint8Array.of(0x20), uleb(scratch),
    Uint8Array.of(0x28, 2), uleb(RENDER_REFERENCE_OFFSET),
    Uint8Array.of(0x72),
  );
}
