/**
 * Owns the memory warning's single non-modal DOM surface and session-local
 * dismissal. Heap sampling and escalation remain in heap-pressure.ts.
 */
import { memoryWarningCopy } from "./failure-messages.js";

export type MemoryWarningLevel = "low" | "critical";

export interface MemoryWarningPresenter {
  present(level: MemoryWarningLevel, capBytes: number): void;
  hide(): void;
}

/** One non-modal warning surface. The estimator owns urgency; this owns DOM. */
export function bindMemoryWarning(
  document: Document,
  reload: () => void,
): MemoryWarningPresenter | null {
  const root = document.getElementById("memory-notice");
  const live = document.getElementById("memory-notice-text");
  const label = document.getElementById("memory-notice-label");
  const detail = document.getElementById("memory-notice-detail");
  const explanation = document.getElementById("memory-notice-explanation");
  const details = document.getElementById("memory-notice-details") as
    | HTMLDetailsElement
    | null;
  const reloadButton = document.getElementById("memory-notice-reload");
  const laterButton = document.getElementById("memory-notice-later");
  if (
    !root || !live || !label || !detail || !explanation || !details
    || !reloadButton || !laterButton
  ) return null;

  let currentLevel: MemoryWarningLevel | null = null;
  let dismissedLevel: MemoryWarningLevel | null = null;
  const rank = (level: MemoryWarningLevel) => level === "critical" ? 2 : 1;

  for (const name of [
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
  ]) {
    root.addEventListener(name, (event) => event.stopPropagation());
  }

  reloadButton.addEventListener("click", () => {
    root.hidden = true;
    reload();
  });
  laterButton.addEventListener("click", () => {
    dismissedLevel = currentLevel;
    root.hidden = true;
    details.open = false;
    document.getElementById("canvas")?.focus();
  });

  return {
    present(level, capBytes) {
      currentLevel = level;
      if (dismissedLevel && rank(dismissedLevel) >= rank(level)) return;
      const copy = memoryWarningCopy(level, capBytes);
      label.textContent = copy.label;
      detail.textContent = copy.detail;
      explanation.textContent = copy.explanation;
      reloadButton.textContent = copy.reloadButton;
      laterButton.textContent = copy.dismissButton;
      root.classList.toggle("critical", level === "critical");
      live.setAttribute("role", level === "critical" ? "alert" : "status");
      live.setAttribute("aria-live", level === "critical" ? "assertive" : "polite");
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
      details.open = false;
    },
  };
}
