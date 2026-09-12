/**
 * Joins certified slot geometry and recharge state at the presentation edge.
 * Neither source is reinterpreted or retained as gameplay state here.
 */
import {
  DEFAULT_SKILL_COOLDOWN_COLOR,
  formatSkillCooldown,
  skillCooldownCssColor,
  type SkillCooldownColor,
} from "../shared/skill-cooldowns.js";
import type {
  CompanionSkillCooldownState,
  CompanionSkillSlotState,
} from "./companion-skill-snapshot.js";
import type { NativeHudLayer, NativeHudItem } from "./native-hud-layer.js";
import { projectSkillSlots } from "./skill-slot-projection.js";

export function createSkillCooldownOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
  overlay: NativeHudLayer,
) {
  let geometry: CompanionSkillSlotState = Object.freeze({ status: "waiting", reason: "memory" });
  let cooldowns: CompanionSkillCooldownState = Object.freeze({ status: "waiting", reason: "memory" });
  let color: SkillCooldownColor = DEFAULT_SKILL_COOLDOWN_COLOR;
  let enabled = false;

  function cooldownSignature(state: CompanionSkillCooldownState): string {
    if (state.status !== "ready") return "waiting";
    return state.rechargeTimestamps.map((timestamp) => formatSkillCooldown(
      timestamp === 0 ? 0 : (timestamp - state.gameTimer) >>> 0,
    ) ?? "").join("|");
  }
  let visibleCooldowns = cooldownSignature(cooldowns);

  function projection(): readonly (NativeHudItem | null)[] | null {
    if (
      !enabled
      || geometry.status !== "ready"
      || cooldowns.status !== "ready"
      || geometry.slots.length !== 8
      || cooldowns.rechargeTimestamps.length !== 8
    ) return null;
    const projected = projectSkillSlots(geometry, canvas);
    if (projected === null) return null;
    const slots: (NativeHudItem | null)[] = [];
    for (let index = 0; index < 8; index += 1) {
      const rect = projected[index]!;
      const timestamp = cooldowns.rechargeTimestamps[index]!;
      const remainingMs = timestamp === 0 ? 0 : (timestamp - cooldowns.gameTimer) >>> 0;
      const text = formatSkillCooldown(remainingMs);
      slots.push(text === null ? null : {parent: geometry.frameId, child: index,
        width: rect.width, height: rect.height, text, color: skillCooldownCssColor(color)});
    }
    return Object.freeze(slots);
  }
  function render() { overlay.update("cooldowns", projection() ?? []); }
  const view = parent.ownerDocument.defaultView;
  view?.addEventListener("resize", render);

  return Object.freeze({
    update(next: CompanionSkillSlotState) {
      geometry = next;
      render();
    },
    setCooldownState(next: CompanionSkillCooldownState) {
      cooldowns = next;
      const signature = cooldownSignature(next);
      if (signature === visibleCooldowns) return;
      visibleCooldowns = signature;
      if (enabled) render();
    },
    sync(nextColor: SkillCooldownColor, nextEnabled: boolean) {
      const changed = enabled !== nextEnabled
        || skillCooldownCssColor(color) !== skillCooldownCssColor(nextColor);
      color = nextColor;
      enabled = nextEnabled;
      if (changed) render();
    },
    dispose() {
      view?.removeEventListener("resize", render);
      overlay.update("cooldowns", []);
    },
  });
}
