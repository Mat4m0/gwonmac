/**
 * Owns native graphics guards for host-driven texture publishing. The host can
 * run while the client's frame is suspended. Publishers must neither reenter
 * a graphics queue flush nor change a model the renderer still references.
 */
import { concat, sleb, uleb } from "../core/wasm-binary.js";

/** Exact owners of the device pointer, queue phase and model reference field. */
export const NATIVE_RENDER_REFERENCE_FUNCTIONS = [
  [2922, "b56cac8d3790761a7949b5d3a626d67522e26635a7d8e8e618186beccab6addd"],
  [2902, "bc88b58d8f433ac8068c56980741e4dd10791b42e915eb077def9812053b9872"],
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

/**
 * Leaves 1 when no graphics device exists or its queue is flushing. 2922 reads
 * the current device at 2734712; 2902 asserts device + 460 == GR_QUEUES (3)
 * before a flush, uses 0/1/2 while flushing, then restores 3. Check this even
 * for a first upload: model creation can validate a material and flush too.
 */
export function nativeGraphicsBusy(scratch: number): Uint8Array {
  return concat(
    Uint8Array.of(0x41), sleb(2734712),
    Uint8Array.of(0x28, 2, 0, 0x22), uleb(scratch),
    Uint8Array.of(0x45, 0x04, 0x7f, 0x41, 1, 0x05, 0x20), uleb(scratch),
    Uint8Array.of(0x28, 2), uleb(460),
    Uint8Array.of(0x41, 3, 0x47, 0x0b),
  );
}
