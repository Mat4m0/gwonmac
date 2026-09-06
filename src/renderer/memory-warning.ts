/**
 * Owns the memory warning's single non-modal DOM surface and session-local
 * dismissal. Heap sampling and escalation remain in heap-pressure.ts.
 */
import type { AppSettings } from "../shared/contracts.js";
import { memoryWarningCopy } from "./failure-messages.js";

export type MemoryWarningLevel = "low" | "critical";

export interface MemoryWarningPresenter {
  present(level: MemoryWarningLevel, capBytes: number): void;
  setAutoRelog(enabled: boolean): void;
  setPosition(position: AppSettings["memoryWarningPosition"]): void;
  dispose(): void;
  hide(): void;
}

export type MemoryWarningActions = Readonly<{
  position: AppSettings["memoryWarningPosition"];
  savePosition(position: AppSettings["memoryWarningPosition"]): Promise<void>;
  autoRelogAfterReload: boolean;
  saveAutoRelog(enabled: boolean): Promise<void>;
  reload(): void | Promise<void>;
}>;

/** One non-modal warning surface. The estimator owns urgency; this owns DOM. */
export function bindMemoryWarning(
  document: Document,
  actions: MemoryWarningActions,
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
  let pendingPreferenceSave = Promise.resolve();
  autoRelog.checked = savedAutoRelog;

  const view = document.defaultView;
  let position = actions.position;
  let savedPosition = position;
  let positionSave = Promise.resolve();
  let drag: { id: number; dx: number; dy: number; before: typeof position } | null = null;
  const place = () => {
    if (!view || root.hidden) return;
    if (position === null) {
      root.style.left = "";
      root.style.top = "";
      root.style.transform = "";
      return;
    }
    const box = root.getBoundingClientRect();
    root.style.left = `${8 + position.x * Math.max(0, view.innerWidth - box.width - 16)}px`;
    root.style.top = `${8 + position.y * Math.max(0, view.innerHeight - box.height - 16)}px`;
    root.style.transform = "none";
  };
  const move = (left: number, top: number) => {
    if (!view) return;
    const box = root.getBoundingClientRect();
    position = {
      x: Math.max(0, Math.min(1, (left - 8) / Math.max(1, view.innerWidth - box.width - 16))),
      y: Math.max(0, Math.min(1, (top - 8) / Math.max(1, view.innerHeight - box.height - 16))),
    };
    place();
  };
  const savePosition = () => {
    const next = position;
    positionSave = positionSave.then(() => actions.savePosition(next)).then(() => {
      savedPosition = next;
    }).catch(() => {
      if (position === next) { position = savedPosition; place(); }
      detail.textContent = "Position could not be saved. Move the warning to try again.";
    });
  };
  label.tabIndex = 0;
  label.setAttribute("role", "button");
  label.setAttribute("aria-description", "Drag to move the warning, or use arrow keys.");
  label.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag !== null) return;
    event.preventDefault();
    const box = root.getBoundingClientRect();
    drag = { id: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top, before: position };
    label.setPointerCapture(event.pointerId);
  });
  label.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    move(event.clientX - drag.dx, event.clientY - drag.dy);
  });
  label.addEventListener("pointerup", (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    label.releasePointerCapture(event.pointerId);
    savePosition();
  });
  label.addEventListener("lostpointercapture", () => {
    if (drag === null) return;
    position = drag.before;
    drag = null;
    place();
  });
  label.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const box = root.getBoundingClientRect();
    const step = event.shiftKey ? 1 : 10;
    move(box.left + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      box.top + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
  });
  label.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) savePosition();
  });
  const observer = view && typeof view.ResizeObserver === "function" ? new view.ResizeObserver(place) : null;
  observer?.observe(root);
  view?.addEventListener("resize", place);

  let currentLevel: MemoryWarningLevel | null = null;
  let dismissedLevel: MemoryWarningLevel | null = null;
  const rank = (level: MemoryWarningLevel) => level === "critical" ? 2 : 1;
  const dismiss = () => {
    dismissedLevel = currentLevel;
    root.hidden = true;
    details.open = false;
    document.getElementById("canvas")?.focus();
  };

  for (const name of [
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
  ]) {
    root.addEventListener(name, (event) => event.stopPropagation());
  }

  autoRelog.addEventListener("change", () => {
    const selected = autoRelog.checked;
    pendingPreferenceSave = actions.saveAutoRelog(selected).then(() => {
      savedAutoRelog = selected;
    }).catch(() => {
      if (autoRelog.checked === selected) autoRelog.checked = savedAutoRelog;
      throw new Error("automatic return preference could not be saved");
    });
    void pendingPreferenceSave.catch(() => undefined);
  });

  reloadButton.addEventListener("click", () => {
    root.hidden = true;
    (reloadButton as HTMLButtonElement).disabled = true;
    void pendingPreferenceSave.then(() => actions.reload())
      .catch(() => {
        (reloadButton as HTMLButtonElement).disabled = false;
        root.hidden = false;
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
      place();
    },
    setAutoRelog(enabled) {
      savedAutoRelog = enabled;
      autoRelog.checked = enabled;
    },
    setPosition(next) {
      savedPosition = next;
      if (drag === null) { position = next; place(); }
    },
    dispose() { observer?.disconnect(); view?.removeEventListener("resize", place); },
    hide() {
      root.hidden = true;
      details.open = false;
    },
  };
}
