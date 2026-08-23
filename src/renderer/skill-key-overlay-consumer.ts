/**
 * Projects the companion's game-viewport rectangles into the canvas's CSS-pixel
 * rectangle. Geometry comes from the game; labels come from the app. This is
 * the only join between those two sources and it owns no discovery or input.
 */
import type { CompanionSkillKeyState } from "./companion-snapshot.js";
import { createSkillKeyOverlay } from "./skill-key-overlay.js";

const CUSTOM_BINDINGS = Object.freeze([
  Object.freeze({ slot: 7, label: "C" }),
]);

export function createSkillKeyOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
) {
  const overlay = createSkillKeyOverlay(parent);
  return Object.freeze({
    update(state: CompanionSkillKeyState) {
      if (state.status !== "ready") {
        overlay.update({ status: "waiting" });
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / state.viewportWidth;
      const scaleY = canvasRect.height / state.viewportHeight;
      overlay.update({
        status: "ready",
        slots: CUSTOM_BINDINGS.map(({ slot: index, label }) => {
          const slot = state.slots[index]!;
          return {
            x: canvasRect.left + slot.left * scaleX,
            y: canvasRect.top + (state.viewportHeight - slot.top) * scaleY,
            width: (slot.right - slot.left) * scaleX,
            height: (slot.top - slot.bottom) * scaleY,
            label,
          };
        }),
      });
    },
    dispose: overlay.dispose,
  });
}
