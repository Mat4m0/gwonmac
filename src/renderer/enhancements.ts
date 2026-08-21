/**
 * Coordinates the certified companion installation for one renderer.
 * Verification, allocation, observation, and cleanup stay in the private installer.
 */
import {
  ENHANCEMENT_CAPABILITY_FIELDS,
  type EnhancementProgram,
} from "../shared/enhancement-contracts.js";
import type { EnhancementRuntimeFeature } from "../shared/contracts.js";
import { installCertifiedCompanion } from "./certified-companion-installation.js";
import { effectiveCapabilities } from "./effective-enhancement-capabilities.js";

const COMPATIBILITY_CHANGED_EVENT = "gwonmac:client-compatibility-changed";

async function reportFeatureFailure(
  features: readonly EnhancementRuntimeFeature[],
): Promise<void> {
  await window.gwNative.client.featureFailure(features);
  window.dispatchEvent(new Event(COMPATIBILITY_CHANGED_EVENT));
}

export async function installEnhancements(
  instance: WebAssembly.Instance,
  module: WebAssembly.Module,
  program: EnhancementProgram = "none",
) {
  const capabilities = effectiveCapabilities(await window.gwNative.client.session());
  if (capabilities === null) return null;
  const features = ENHANCEMENT_CAPABILITY_FIELDS.filter(
    (feature) => capabilities[feature],
  );
  try {
    const installation = await installCertifiedCompanion(
      instance,
      module,
      capabilities,
      program,
    );
    if (installation === null && features.length > 0) {
      await reportFeatureFailure(features);
    }
    return installation;
  } catch (error) {
    if (features.length > 0) {
      await reportFeatureFailure(features).catch(() => undefined);
    }
    throw error;
  }
}
