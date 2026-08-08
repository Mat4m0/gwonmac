/**
 * Coordinates the certified companion installation for one renderer.
 * Verification, allocation, observation, and cleanup stay in the private installer.
 */
import type {
  EnhancementProgram,
  EnhancementSelection,
} from "../shared/enhancement-contracts.js";
import { installCertifiedCompanion } from "./certified-companion-installation.js";
export function installEnhancements(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  selection: EnhancementSelection,
  program: EnhancementProgram = "none",
) {
  return installCertifiedCompanion(instance, module, selection, program);
}
