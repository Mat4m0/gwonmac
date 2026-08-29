/**
 * Projects the companion's game-viewport rectangles into the canvas's CSS-pixel
 * rectangle. Geometry comes from the game; labels come from the app. This is
 * the only join between those two sources and it owns no discovery or input.
 */
import type { CompanionSkillSlotState } from "./companion-interface-geometry-snapshot.js";
import { createSkillKeyOverlay } from "./skill-key-overlay.js";
import {
  EMPTY_SKILL_KEY_BINDINGS,
  cloneSkillKeyBindings,
  type SkillKeyBindings,
} from "../shared/skill-key-bindings.js";
import { projectSkillSlots } from "./skill-slot-projection.js";

export function createSkillKeyOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
) {
  const overlay = createSkillKeyOverlay(parent);
  let state: CompanionSkillSlotState = Object.freeze({
    status: "waiting",
    reason: "memory",
  });
  let bindings = EMPTY_SKILL_KEY_BINDINGS;
  let enabled = false;
  function render() {
    if (!enabled || state.status !== "ready") {
      overlay.update({ status: "waiting" });
      return;
    }
    const projected = projectSkillSlots(state, canvas);
    if (projected === null) {
      overlay.update({ status: "waiting" });
      return;
    }
    overlay.update({
      status: "ready",
      slots: bindings.flatMap((binding, index) => {
        if (binding === null) return [];
        const slot = projected[index]!;
        return [{
          ...slot,
          binding,
        }];
      }),
    });
  }
  const view = parent.ownerDocument.defaultView;
  view?.addEventListener("resize", render);
  return Object.freeze({
    update(next: CompanionSkillSlotState) {
      state = next;
      render();
    },
    setBindings(next: SkillKeyBindings) {
      bindings = cloneSkillKeyBindings(next);
      render();
    },
    setEnabled(next: boolean) {
      enabled = next;
      render();
    },
    dispose() {
      view?.removeEventListener("resize", render);
      overlay.dispose();
    },
  });
}
