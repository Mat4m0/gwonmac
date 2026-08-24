/**
 * Coordinates the two presentation-only skill HUDs over their independent
 * certified geometry and recharge feeds. Native ownership stays in the feed
 * installations; this module owns only their shared settings/policy lifecycle.
 */
import { COMPANION_FEATURE_BITS } from "../shared/companion-abi.js";
import type { AppSettings } from "../shared/contracts.js";
import type { EnhancementCapabilities } from "../shared/enhancement-contracts.js";
import { createSkillCooldownOverlayInstallation } from "./skill-cooldown-overlay-installation.js";
import { createSkillCooldownObservationInstallation } from "./skill-cooldown-state-installation.js";
import { createSkillKeyOverlayConsumer } from "./skill-key-overlay-consumer.js";
import { createSkillSlotGeometryInstallation } from "./skill-slot-geometry-installation.js";

type SkillSettings = Pick<AppSettings, "skillKeyBindings" | "skillCooldownColor">;

export function createSkillOverlaysInstallation(
  capabilities: Pick<EnhancementCapabilities, "skillSlotGeometry" | "skillCooldownObservation">,
) {
  const geometry = createSkillSlotGeometryInstallation(capabilities.skillSlotGeometry);
  const cooldowns = createSkillCooldownObservationInstallation(
    capabilities.skillCooldownObservation,
  );
  const cooldownOverlay = createSkillCooldownOverlayInstallation(
    capabilities.skillCooldownObservation && capabilities.skillSlotGeometry,
  );
  let keyConsumer: ReturnType<typeof createSkillKeyOverlayConsumer> | null = null;
  let unsubscribeKeyGeometry: (() => void) | null = null;

  const hasKeyBindings = (settings: SkillSettings) =>
    settings.skillKeyBindings.some((binding) => binding !== null);

  return Object.freeze({
    geometry,
    cooldowns,
    certifiedFeatureFlags:
      (capabilities.skillSlotGeometry ? COMPANION_FEATURE_BITS.skillSlotGeometry : 0)
      | (capabilities.skillCooldownObservation
        ? COMPANION_FEATURE_BITS.skillCooldownObservation
        : 0),
    mount(parent: HTMLElement, settings: SkillSettings) {
      if (capabilities.skillSlotGeometry) {
        const canvas = parent.ownerDocument.getElementById("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("Enhancement skill overlay target is missing");
        }
        keyConsumer = createSkillKeyOverlayConsumer(parent, canvas);
        unsubscribeKeyGeometry = geometry.subscribe(keyConsumer.update);
      }
      cooldownOverlay.mount(
        parent,
        settings.skillCooldownColor,
        false,
        geometry.subscribe,
        cooldowns.subscribe,
      );
    },
    sync(settings: SkillSettings, geometryEnabled: boolean, cooldownEnabled: boolean) {
      keyConsumer?.setBindings(settings.skillKeyBindings);
      keyConsumer?.setEnabled(geometryEnabled && hasKeyBindings(settings));
      cooldownOverlay.sync(settings.skillCooldownColor, cooldownEnabled);
    },
    activeFeatureFlags(
      settings: SkillSettings,
      geometryEnabled: boolean,
      cooldownEnabled: boolean,
    ) {
      return (
        capabilities.skillSlotGeometry
          && geometryEnabled
          && (hasKeyBindings(settings) || cooldownEnabled)
          ? COMPANION_FEATURE_BITS.skillSlotGeometry
          : 0
      ) | (
        capabilities.skillCooldownObservation && cooldownEnabled
          ? COMPANION_FEATURE_BITS.skillCooldownObservation
          : 0
      );
    },
    disposePresentation() {
      const failures: unknown[] = [];
      try { unsubscribeKeyGeometry?.(); } catch (cause) { failures.push(cause); }
      unsubscribeKeyGeometry = null;
      try { keyConsumer?.dispose(); } catch (cause) { failures.push(cause); }
      keyConsumer = null;
      try { cooldownOverlay.dispose(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Skill overlay cleanup failed");
      }
    },
  });
}
