/**
 * Certifies the native World Map display flag at the start of its close path.
 * The frame can survive the fade, so frame destruction cannot own visibility.
 */
import { readUleb } from "../core/wasm-binary.js";
import { relocationAwareFingerprint } from "./semantic-proof.js";
import { functionBody, signatureEvidence, type WasmEvidence } from "./wasm-evidence.js";

const DISPLAY_STATE_OPERANDS = [220, 232] as const;

export function worldMapDisplayStateAddress(evidence: WasmEvidence): number | null {
  const module = evidence.moduleView();
  // This owner creates World Map table slot 4152. Its close branch clears
  // 0x80000 before starting the native 1 -> 0 opacity animation (function 6834).
  const body = functionBody(module, 15_919);
  const signature = signatureEvidence(module, 15_919);
  if (body.byteLength !== 302 || signature === null
    || signature.params.join() !== "i32,i32" || signature.results.length !== 0
    || relocationAwareFingerprint(body, DISPLAY_STATE_OPERANDS.map((start) => ({
      start, end: start + 5, role: "world-map.display-state", addressClass: "mutable-static",
    }))) !== "23f59ceb29627fbbe1cddf258d6f1051ebb6690a52f7519603d0ec659890ed16") return null;
  const addresses = DISPLAY_STATE_OPERANDS.map((offset) => readUleb(body, { offset }));
  const address = addresses[0];
  return address !== undefined && address > 0 && address <= 0x7fff_fffc
    && address % 4 === 0 && addresses.every((value) => value === address)
    ? address : null;
}
