/**
 * Projects the companion's game-viewport rectangles into the canvas's CSS-pixel
 * rectangle. Geometry comes from the game; labels come from the app. This is
 * the only join between those two sources and it owns no discovery or input.
 */
import type { CompanionSkillKeyState } from "./companion-snapshot.js";
import { createSkillKeyOverlay } from "./skill-key-overlay.js";
import {
  EMPTY_SKILL_KEY_BINDINGS,
  cloneSkillKeyBindings,
  type SkillKeyBindings,
} from "../shared/skill-key-bindings.js";

export function createSkillKeyOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
) {
  const overlay = createSkillKeyOverlay(parent);
  let state: CompanionSkillKeyState = Object.freeze({
    status: "waiting",
    reason: "memory",
  });
  let bindings = EMPTY_SKILL_KEY_BINDINGS;
  let enabled = false;
  let blockedSequence: number | null = null;

  const render = () => {
    if (
      !enabled
      || state.status !== "ready"
      || state.sequence === blockedSequence
    ) {
      overlay.update({ status: "waiting" });
      return;
    }
    const ready = state;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / ready.viewportWidth;
    const scaleY = canvasRect.height / ready.viewportHeight;
    overlay.update({
      status: "ready",
      slots: bindings.flatMap((binding, index) => {
        if (binding === null) return [];
        const slot = ready.slots[index]!;
        return [{
          x: canvasRect.left + slot.left * scaleX,
          y: canvasRect.top + (ready.viewportHeight - slot.top) * scaleY,
          width: (slot.right - slot.left) * scaleX,
          height: (slot.top - slot.bottom) * scaleY,
          binding,
        }];
      }),
    });
  };
  return Object.freeze({
    update(next: CompanionSkillKeyState) {
      state = next;
      if (
        enabled
        && next.status === "ready"
        && next.sequence !== blockedSequence
      ) blockedSequence = null;
      render();
    },
    setBindings(next: SkillKeyBindings) {
      bindings = cloneSkillKeyBindings(next);
      render();
    },
    setEnabled(next: boolean) {
      if (enabled && !next) {
        blockedSequence = state.status === "ready" ? state.sequence : null;
      }
      enabled = next;
      render();
    },
    dispose: overlay.dispose,
  });
}
