/**
 * Selects the certified companion implementation from the immutable launch
 * capability. The optional implementation has no static edge from Core.
 */
import type {
  EnhancementCapabilities,
  EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import { installCoreCertifiedCompanion } from "./certified-companion-core-installation.js";

export async function installCertifiedCompanion(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  capabilities: EnhancementCapabilities,
  program: EnhancementProgram = "none",
) {
  if (!window.gwNative.init.enhancementSelection.tools) {
    return installCoreCertifiedCompanion(instance, module, capabilities, program);
  }
  const { prepareToolsCompanionExtension } = await import(
    "./certified-companion-tools-installation.js"
  );
  return installCoreCertifiedCompanion(
    instance,
    module,
    capabilities,
    program,
    prepareToolsCompanionExtension,
  );
}
