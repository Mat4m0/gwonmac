/**
 * Owns the cooldown HUD and subscriptions to accepted native state. Certified
 * memory allocation remains in the observation installation.
 */
import type { SkillCooldownColor } from "../shared/skill-cooldowns.js";
import type {
  CompanionSkillCooldownState,
  CompanionSkillSlotState,
} from "./companion-skill-snapshot.js";
import { createSkillCooldownOverlayConsumer } from "./skill-cooldown-overlay-consumer.js";

export function createSkillCooldownOverlayInstallation(available: boolean) {
  let consumer: ReturnType<typeof createSkillCooldownOverlayConsumer> | null = null;
  let unsubscribeGeometry: (() => void) | null = null;
  let unsubscribeCooldowns: (() => void) | null = null;
  return Object.freeze({
    mount(
      parent: HTMLElement,
      color: SkillCooldownColor,
      enabled: boolean,
      subscribeGeometry: (listener: (state: CompanionSkillSlotState) => void) => () => void,
      subscribeCooldowns: (
        listener: (state: CompanionSkillCooldownState) => void,
      ) => () => void,
    ) {
      if (!available || consumer !== null) return;
      const canvas = parent.ownerDocument.getElementById("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Enhancement skill cooldown target is missing");
      }
      consumer = createSkillCooldownOverlayConsumer(parent, canvas);
      unsubscribeGeometry = subscribeGeometry(consumer.update);
      unsubscribeCooldowns = subscribeCooldowns(consumer.setCooldownState);
      consumer.sync(color, enabled);
    },
    sync(color: SkillCooldownColor, enabled: boolean) {
      consumer?.sync(color, enabled);
    },
    dispose() {
      unsubscribeGeometry?.();
      unsubscribeCooldowns?.();
      unsubscribeGeometry = null;
      unsubscribeCooldowns = null;
      consumer?.dispose();
      consumer = null;
    },
  });
}
