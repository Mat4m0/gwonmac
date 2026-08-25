/**
 * Owns the memory warning's single non-modal DOM surface and session-local
 * dismissal. Heap sampling and escalation remain in heap-pressure.ts.
 */
import { memoryWarningCopy } from "./failure-messages.js";

export type MemoryWarningLevel = "low" | "critical";

export interface MemoryWarningPresenter {
  present(level: MemoryWarningLevel, capBytes: number): void;
  setAutoRelog(enabled: boolean): void;
  hide(): void;
}

export type MemoryWarningActions = Readonly<{
  autoRelogAfterReload: boolean;
  saveAutoRelog(enabled: boolean): Promise<void>;
  reload(): void | Promise<void>;
}>;

/** One non-modal warning surface. The estimator owns urgency; this owns DOM. */
export function bindMemoryWarning(
  document: Document,
  actions: MemoryWarningActions,
  surfaces: GwonmacSurfaceController | null = null,
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
  const autoRelog = document.getElementById("memory-notice-auto-relog") as
    | HTMLInputElement
    | null;
  if (
    !root || !live || !label || !detail || !explanation || !details
    || !reloadButton || !laterButton || !autoRelog
  ) return null;
  let savedAutoRelog = actions.autoRelogAfterReload;
  autoRelog.checked = savedAutoRelog;

  let currentLevel: MemoryWarningLevel | null = null;
  let dismissedLevel: MemoryWarningLevel | null = null;
  const rank = (level: MemoryWarningLevel) => level === "critical" ? 2 : 1;
  const dismiss = () => {
    dismissedLevel = currentLevel;
    root.hidden = true;
    details.open = false;
    dismissable?.setOpen(false);
    document.getElementById("canvas")?.focus();
  };
  const dismissable = surfaces?.register({
    root,
    priority: 8,
    dismiss,
  }) ?? null;

  for (const name of [
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
  ]) {
    root.addEventListener(name, (event) => event.stopPropagation());
  }

  autoRelog.addEventListener("change", () => {
    const selected = autoRelog.checked;
    void actions.saveAutoRelog(selected).then(() => {
      savedAutoRelog = selected;
    }).catch(() => {
      if (autoRelog.checked === selected) autoRelog.checked = savedAutoRelog;
    });
  });

  reloadButton.addEventListener("click", () => {
    root.hidden = true;
    dismissable?.setOpen(false);
    (reloadButton as HTMLButtonElement).disabled = true;
    void actions.saveAutoRelog(autoRelog.checked)
      .then(() => actions.reload())
      .catch(() => {
      (reloadButton as HTMLButtonElement).disabled = false;
      root.hidden = false;
      dismissable?.setOpen(true);
      });
  });
  laterButton.addEventListener("click", dismiss);

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
      dismissable?.setOpen(true);
    },
    setAutoRelog(enabled) {
      savedAutoRelog = enabled;
      autoRelog.checked = enabled;
    },
    hide() {
      root.hidden = true;
      details.open = false;
      dismissable?.setOpen(false);
    },
  };
}
