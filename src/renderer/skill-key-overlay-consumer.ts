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

const DEFAULT_STALE_AFTER_MS = 500;
type FreshnessTimer = ReturnType<typeof globalThis.setTimeout> | number;

type FreshnessOptions = Readonly<{
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => FreshnessTimer;
  cancel?: (timer: FreshnessTimer) => void;
  staleAfterMs?: number;
}>;

export function createSkillKeyOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
  freshness: FreshnessOptions = {},
) {
  const overlay = createSkillKeyOverlay(parent);
  let state: CompanionSkillKeyState = Object.freeze({
    status: "waiting",
    reason: "memory",
  });
  let bindings = EMPTY_SKILL_KEY_BINDINGS;
  let enabled = false;
  let blockedSequence: number | null = null;
  let observedSequence: number | null = null;
  let staleSequence: number | null = null;
  let advancedAt = 0;
  let freshnessTimer: FreshnessTimer | null = null;
  const now = freshness.now ?? (() => performance.now());
  const schedule = freshness.schedule ?? ((callback, delay) =>
    globalThis.setTimeout(callback, delay));
  const cancelTimer = freshness.cancel ?? ((timer) => globalThis.clearTimeout(timer));
  const staleAfterMs = freshness.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  const stopFreshnessTimer = () => {
    if (freshnessTimer !== null) cancelTimer(freshnessTimer);
    freshnessTimer = null;
  };

  const watchFreshness = () => {
    if (freshnessTimer !== null || observedSequence === null) return;
    const remaining = staleAfterMs - (now() - advancedAt);
    freshnessTimer = schedule(() => {
      freshnessTimer = null;
      if (observedSequence === null) return;
      if (now() - advancedAt < staleAfterMs) {
        watchFreshness();
        return;
      }
      staleSequence = observedSequence;
      render();
    }, Math.max(0, remaining));
  };

  function render() {
    if (
      !enabled
      || state.status !== "ready"
      || state.sequence === blockedSequence
      || state.sequence === staleSequence
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
  }
  return Object.freeze({
    update(next: CompanionSkillKeyState) {
      state = next;
      if (next.status === "ready" && next.sequence !== observedSequence) {
        observedSequence = next.sequence;
        staleSequence = null;
        advancedAt = now();
        watchFreshness();
      } else if (next.status !== "ready") {
        observedSequence = null;
        staleSequence = null;
        stopFreshnessTimer();
      }
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
      stopFreshnessTimer();
      overlay.dispose();
    },
  });
}
