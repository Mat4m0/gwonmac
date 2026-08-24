/**
 * Joins certified slot geometry and recharge state at the presentation edge.
 * Neither source is reinterpreted or retained as gameplay state here.
 */
import type { SkillCooldownColor } from "../shared/skill-cooldowns.js";
import type {
  CompanionSkillCooldownState,
  CompanionSkillSlotState,
} from "./companion-skill-snapshot.js";
import { createSkillCooldownOverlay, type SkillCooldownSlot } from "./skill-cooldown-overlay.js";
import { projectSkillSlots } from "./skill-slot-projection.js";

export function createSkillCooldownOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
) {
  const overlay = createSkillCooldownOverlay(parent);
  let geometry: CompanionSkillSlotState = Object.freeze({ status: "waiting", reason: "memory" });
  let cooldowns: CompanionSkillCooldownState = Object.freeze({ status: "waiting", reason: "memory" });
  let color: SkillCooldownColor = Object.freeze({ kind: "preset", preset: "red" });
  let enabled = false;

  function projection(): readonly SkillCooldownSlot[] | null {
    if (
      !enabled
      || geometry.status !== "ready"
      || cooldowns.status !== "ready"
      || geometry.slots.length !== 8
      || cooldowns.rechargeTimestamps.length !== 8
    ) return null;
    const projected = projectSkillSlots(geometry, canvas);
    if (projected === null) return null;
    const slots: SkillCooldownSlot[] = [];
    for (let index = 0; index < 8; index += 1) {
      const rect = projected[index]!;
      const timestamp = cooldowns.rechargeTimestamps[index]!;
      const remainingMs = timestamp === 0 ? 0 : (timestamp - cooldowns.gameTimer) >>> 0;
      slots.push(Object.freeze({
        ...rect,
        remainingMs,
      }));
    }
    return Object.freeze(slots);
  }
  function render() { overlay.update(projection(), color); }

  return Object.freeze({
    update(next: CompanionSkillSlotState) {
      geometry = next;
      render();
    },
    setCooldownState(next: CompanionSkillCooldownState) {
      cooldowns = next;
      render();
    },
    sync(nextColor: SkillCooldownColor, nextEnabled: boolean) {
      color = nextColor;
      enabled = nextEnabled;
      render();
    },
    dispose() {
      overlay.dispose();
    },
  });
}
