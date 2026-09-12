/**
 * Joins exact player durations and independently certified native icon geometry.
 * This presentation edge does not create or predict gameplay state.
 */
import type {
  CompanionEffectIconState,
  CompanionPlayerEffectState,
} from "./companion-effect-snapshot.js";
import { formatEffectTimer, remainingEffectMs } from "./companion-effect-snapshot.js";
import type { NativeHudLayer } from "./native-hud-layer.js";
export type EffectTimerLabel = Readonly<{skillId: number; x: number; y: number; width: number; height: number; text: string; urgency: "normal" | "soon" | "urgent"}>;

export function projectEffectTimerLabels(
  effects: CompanionPlayerEffectState,
  geometry: CompanionEffectIconState,
  canvas: HTMLCanvasElement,
): readonly EffectTimerLabel[] | null {
  if (effects.status !== "ready" || geometry.status !== "ready") return null;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const scaleX = bounds.width / geometry.viewportWidth;
  const scaleY = bounds.height / geometry.viewportHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;

  const longest = new Map<number, number>();
  for (const effect of effects.effects) {
    // Long native durations can be placeholders, including Displacement.
    if (effect.durationMs >= 3_600_000) continue;
    const remaining = remainingEffectMs(
      effects.gameTimer,
      effect.appliedAtGameMs,
      effect.durationMs,
    );
    if (remaining !== null && remaining > (longest.get(effect.skillId) ?? 0)) {
      longest.set(effect.skillId, remaining);
    }
  }
  const labels: EffectTimerLabel[] = [];
  for (const icon of geometry.icons) {
    const remaining = longest.get(icon.skillId);
    if (remaining === undefined || remaining === 0) continue;
    const width = (icon.right - icon.left) * scaleX;
    const height = (icon.top - icon.bottom) * scaleY;
    labels.push(Object.freeze({
      skillId: icon.skillId,
      x: bounds.left + icon.left * scaleX,
      y: bounds.top + (geometry.viewportHeight - icon.top) * scaleY,
      width,
      height,
      text: formatEffectTimer(remaining),
      urgency: remaining < 2_000 ? "urgent" : remaining < 5_000 ? "soon" : "normal",
    }));
  }
  return Object.freeze(labels);
}

export function createEffectTimerOverlayConsumer(
  parent: HTMLElement,
  canvas: HTMLCanvasElement,
  overlay: NativeHudLayer,
) {
  let effects: CompanionPlayerEffectState = Object.freeze({ status: "waiting", reason: "memory" });
  let geometry: CompanionEffectIconState = Object.freeze({ status: "waiting", reason: "memory" });
  let enabled = false;
  const render = () => {
    const labels = enabled ? projectEffectTimerLabels(effects, geometry, canvas) : null;
    overlay.update("effects", labels?.map((label) => ({parent: geometry.status === "ready" ? geometry.frameId : 0,
      child: label.skillId + 4, width: label.width, height: label.height, text: label.text,
      color: {normal: "#eadcc2", soon: "#e5ad52", urgent: "#c86c65"}[label.urgency]})) ?? []);
  };
  const view = parent.ownerDocument.defaultView;
  view?.addEventListener("resize", render);
  return Object.freeze({
    setEffects(next: CompanionPlayerEffectState) { effects = next; render(); },
    setGeometry(next: CompanionEffectIconState) { geometry = next; render(); },
    setEnabled(next: boolean) { if (enabled !== next) { enabled = next; render(); } },
    dispose() { view?.removeEventListener("resize", render); overlay.update("effects", []); },
  });
}
