/**
 * Coordinates the two presentation-only skill HUDs over their independent
 * certified geometry and recharge feeds. Native ownership stays in the feed
 * installations; this module owns only their shared settings/policy lifecycle.
 */
import { COMPANION_FEATURE_BITS } from "../shared/companion-abi.js";
import type { AppSettings } from "../shared/contracts.js";
import type { EnhancementCapabilities } from "../shared/enhancement-contracts.js";
import { createSkillCooldownOverlayConsumer } from "./skill-cooldown-overlay-consumer.js";
import { createSkillCooldownObservationInstallation } from "./skill-cooldown-state-installation.js";
import { createSkillKeyOverlayConsumer } from "./skill-key-overlay-consumer.js";
import { createSkillSlotGeometryInstallation } from "./skill-slot-geometry-installation.js";

type SkillSettings = Pick<AppSettings, "skillKeyBindings" | "skillCooldownColor">;
type SkillFeaturePolicy = Readonly<{
  skillKeyLabels: boolean;
  skillCooldowns: boolean;
}>;

export function createSkillOverlaysInstallation(
  capabilities: Pick<EnhancementCapabilities, "skillSlotGeometry" | "skillCooldownObservation">,
  geometry = createSkillSlotGeometryInstallation(capabilities.skillSlotGeometry),
  cooldowns = createSkillCooldownObservationInstallation(
    capabilities.skillCooldownObservation,
  ),
) {
  let keyConsumer: ReturnType<typeof createSkillKeyOverlayConsumer> | null = null;
  let cooldownConsumer: ReturnType<typeof createSkillCooldownOverlayConsumer> | null = null;
  let unsubscribeKeyGeometry: (() => void) | null = null;
  let unsubscribeCooldownGeometry: (() => void) | null = null;
  let unsubscribeCooldownState: (() => void) | null = null;
  let activeFeatureFlags = 0;

  return Object.freeze({
    geometry,
    cooldowns,
    certifiedFeatureFlags:
      (capabilities.skillSlotGeometry ? COMPANION_FEATURE_BITS.skillSlotGeometry : 0)
      | (capabilities.skillCooldownObservation
        ? COMPANION_FEATURE_BITS.skillCooldownObservation
        : 0),
    get activeFeatureFlags() { return activeFeatureFlags; },
    mount(parent: HTMLElement, settings: SkillSettings) {
      if (!capabilities.skillSlotGeometry || keyConsumer !== null) return;
      const canvas = parent.ownerDocument.getElementById("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Enhancement skill overlay target is missing");
      }
      keyConsumer = createSkillKeyOverlayConsumer(parent, canvas);
      unsubscribeKeyGeometry = geometry.subscribe(keyConsumer.update);
      if (!capabilities.skillCooldownObservation) return;
      cooldownConsumer = createSkillCooldownOverlayConsumer(parent, canvas);
      cooldownConsumer.sync(settings.skillCooldownColor, false);
      unsubscribeCooldownGeometry = geometry.subscribe(cooldownConsumer.update);
      unsubscribeCooldownState = cooldowns.subscribe(cooldownConsumer.setCooldownState);
    },
    sync(settings: SkillSettings, policy: SkillFeaturePolicy) {
      const geometryActive = policy.skillKeyLabels || policy.skillCooldowns;
      geometry.setActive(geometryActive);
      cooldowns.setActive(policy.skillCooldowns);
      keyConsumer?.setBindings(settings.skillKeyBindings);
      keyConsumer?.setEnabled(policy.skillKeyLabels);
      cooldownConsumer?.sync(settings.skillCooldownColor, policy.skillCooldowns);
      activeFeatureFlags = (
        capabilities.skillSlotGeometry
          && geometryActive
          ? COMPANION_FEATURE_BITS.skillSlotGeometry
          : 0
      ) | (
        capabilities.skillCooldownObservation && policy.skillCooldowns
          ? COMPANION_FEATURE_BITS.skillCooldownObservation
          : 0
      );
    },
    disposePresentation() {
      const failures: unknown[] = [];
      const attempt = (release: (() => void) | null) => {
        try { release?.(); } catch (cause) { failures.push(cause); }
      };
      const keyToDispose = keyConsumer;
      const cooldownToDispose = cooldownConsumer;
      const releases = [
        unsubscribeKeyGeometry,
        unsubscribeCooldownGeometry,
        unsubscribeCooldownState,
        keyToDispose === null ? null : () => keyToDispose.dispose(),
        cooldownToDispose === null ? null : () => cooldownToDispose.dispose(),
      ];
      unsubscribeKeyGeometry = null;
      unsubscribeCooldownGeometry = null;
      unsubscribeCooldownState = null;
      keyConsumer = null;
      cooldownConsumer = null;
      for (const release of releases) attempt(release);
      if (failures.length > 0) {
        throw new AggregateError(failures, "Skill overlay cleanup failed");
      }
    },
  });
}
