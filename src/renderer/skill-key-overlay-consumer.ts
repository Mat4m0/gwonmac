/**
 * Projects the companion's game-viewport rectangles into the canvas's CSS-pixel
 * rectangle. Geometry comes from the game; labels come from the app. This is
 * the only join between those two sources and it owns no discovery or input.
 */
import type { CompanionSkillSlotState } from "./companion-skill-snapshot.js";
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
  let blockedSequence: number | null = null;
  function render() {
    if (
      !enabled
      || state.status !== "ready"
      || state.sequence === blockedSequence
    ) {
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
  return Object.freeze({
    update(next: CompanionSkillSlotState) {
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
    dispose() {
      overlay.dispose();
    },
  });
}
