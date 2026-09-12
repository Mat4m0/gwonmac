/**
 * Projects the companion's game-viewport rectangles into the canvas's CSS-pixel
 * rectangle. Geometry comes from the game; labels come from the app. This is
 * the only join between those two sources and it owns no discovery or input.
 */
import type { CompanionSkillSlotState } from "./companion-skill-snapshot.js";
import type { NativeHudLayer } from "./native-hud-layer.js";
import {
  EMPTY_SKILL_KEY_BINDINGS,
  EMPTY_SKILL_KEY_MODIFIERS,
  cloneSkillKeyBindings,
  type SkillKeyBindings,
} from "../shared/skill-key-bindings.js";
import { projectSkillSlots } from "./skill-slot-projection.js";

export function createSkillKeyOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
  overlay: NativeHudLayer,
) {
  let state: CompanionSkillSlotState = Object.freeze({
    status: "waiting",
    reason: "memory",
  });
  let bindings = EMPTY_SKILL_KEY_BINDINGS;
  let enabled = false;
  function render() {
    if (!enabled || state.status !== "ready") {
      overlay.update("keys", []);
      return;
    }
    const projected = projectSkillSlots(state, canvas);
    if (projected === null) {
      overlay.update("keys", []);
      return;
    }
    overlay.update("keys", bindings.map((binding, index) => {
      const slot = projected[index]!;
      return {parent: state.status === "ready" ? state.frameId : 0, child: index,
        width: slot.width, height: slot.height, binding: binding ?? {
          input: {kind: "keyboard" as const, code: `Digit${index + 1}`}, modifiers: EMPTY_SKILL_KEY_MODIFIERS,
        }};
    }));
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
      overlay.update("keys", []);
    },
  });
}
