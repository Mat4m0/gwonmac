/**
 * Pointer-transparent eight-slot cooldown presentation.
 * This owner writes the DOM only when visible labels or slot geometry change.
 */
import type { SkillCooldownColor } from "../shared/skill-cooldowns.js";
import { formatSkillCooldown } from "../shared/skill-cooldowns.js";
import { createSkillCooldownView } from "./skill-cooldown-view.js";

export type SkillCooldownSlot = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  remainingMs: number;
}>;

const ROOT_STYLE = "position:fixed;inset:0;z-index:2;display:none;overflow:hidden;pointer-events:none;user-select:none";
const SLOT_STYLE = "position:absolute;pointer-events:none;overflow:hidden";

function validSlot(value: SkillCooldownSlot): boolean {
  return [value.x, value.y, value.width, value.height, value.remainingMs].every(Number.isFinite)
    && Math.abs(value.x) <= 32_768
    && Math.abs(value.y) <= 32_768
    && value.width > 0
    && value.width <= 2_048
    && value.height > 0
    && value.height <= 2_048
    && Number.isSafeInteger(value.remainingMs)
    && value.remainingMs >= 0;
}

export function createSkillCooldownOverlay(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = "skill-cooldown-overlay";
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = ROOT_STYLE;
  const views = Array.from({ length: 8 }, () => {
    const slot = document.createElement("span");
    slot.style.cssText = SLOT_STYLE;
    root.append(slot);
    return { slot, countdown: createSkillCooldownView(slot) };
  });
  parent.append(root);
  let signature = "";
  return Object.freeze({
    update(slots: readonly SkillCooldownSlot[] | null, color: SkillCooldownColor) {
      if (slots !== null && (slots.length !== 8 || slots.some((slot) => !validSlot(slot)))) {
        slots = null;
      }
      const next = slots === null ? "" : `${slots.map((slot) =>
        `${slot.x},${slot.y},${slot.width},${slot.height},${formatSkillCooldown(slot.remainingMs) ?? ""}`
      ).join(";")}|${JSON.stringify(color)}`;
      if (next === signature) return;
      signature = next;
      if (slots === null) {
        root.style.display = "none";
        return;
      }
      slots.forEach((value, index) => {
        const view = views[index]!;
        view.slot.style.cssText = `${SLOT_STYLE};left:${value.x}px;top:${value.y}px;width:${value.width}px;height:${value.height}px`;
        view.countdown.element.style.setProperty("--skill-cooldown-slot-height", `${value.height}px`);
        view.countdown.update(value.remainingMs, color);
      });
      root.style.display = slots.some((slot) => formatSkillCooldown(slot.remainingMs) !== null)
        ? "block"
        : "none";
    },
    get state() {
      return Object.freeze({ visible: root.style.display === "block", signature });
    },
    dispose() { root.remove(); },
  });
}
