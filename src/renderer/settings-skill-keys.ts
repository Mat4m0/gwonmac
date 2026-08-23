/**
 * Settings owns recording and persistence for display-only skill-key labels.
 * Keyboard capture crosses main so Command shortcuts cannot fire; mouse and
 * wheel capture stay in the renderer and the first bounded input wins.
 */
import type { AppSettings } from "../shared/contracts.js";
import {
  EMPTY_SKILL_KEY_BINDINGS,
  type SkillKeyBinding,
  type SkillKeyBindings,
  type SkillKeyModifiers,
  withSkillKeyBinding,
} from "../shared/skill-key-bindings.js";
import { createSkillKeyBindingView } from "./skill-key-binding-view.js";

type FeedbackTone = "neutral" | "progress" | "success" | "warning" | "error";

const modifiersFromEvent = (
  event: Pick<MouseEvent | WheelEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): SkillKeyModifiers => ({
  control: event.ctrlKey,
  option: event.altKey,
  shift: event.shiftKey,
  command: event.metaKey,
});

export function bindSkillKeySettings(options: Readonly<{
  fieldset: HTMLFieldSetElement;
  dialog: HTMLDialogElement;
  clearAll: HTMLButtonElement;
  settings: () => AppSettings | null;
  persist: (bindings: SkillKeyBindings) => Promise<unknown>;
  recoverAfterPersistFailure: (message: string) => Promise<void>;
  feedback: (message: string, tone: FeedbackTone, resetAfter?: number) => void;
}>) {
  let recording: number | null = null;
  let generation = 0;
  const rows = [...options.fieldset.querySelectorAll<HTMLElement>("[data-skill-key-slot]")];
  const views = rows.map((row) => {
    const preview = row.querySelector<HTMLElement>(".settings-skill-key-preview");
    if (!preview) throw new Error("missing skill-key preview");
    return createSkillKeyBindingView(preview);
  });

  const rowParts = (slot: number) => {
    const row = rows[slot];
    const change = row?.querySelector<HTMLButtonElement>(".settings-skill-key-change");
    const clear = row?.querySelector<HTMLButtonElement>(".settings-skill-key-clear");
    const message = row?.querySelector<HTMLElement>(".settings-skill-key-message");
    if (!row || !change || !clear || !message) throw new Error(`incomplete skill-key row ${slot + 1}`);
    return { row, change, clear, message };
  };

  function stopRendererCapture(): void {
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("wheel", onWheel, true);
  }

  function cancel(): void {
    const wasRecording = recording !== null;
    generation += 1;
    stopRendererCapture();
    if (wasRecording) void window.gwNative.skillKeys.cancelKeyboardCapture();
    recording = null;
    const settings = options.settings();
    if (settings) render(settings);
  }

  async function save(bindings: SkillKeyBindings): Promise<void> {
    options.feedback("Saving…", "progress");
    try {
      await options.persist(bindings);
      options.feedback("Skill label saved.", "success", 2200);
    } catch {
      await options.recoverAfterPersistFailure(
        "Review the active skill labels before trying again.",
      );
    }
  }

  function captureControl(event: Event): boolean {
    return event.target instanceof Element
      && event.target.closest("[data-skill-key-capture-control]") !== null;
  }

  function accept(binding: SkillKeyBinding): void {
    const slot = recording;
    if (slot === null) return;
    generation += 1;
    stopRendererCapture();
    void window.gwNative.skillKeys.cancelKeyboardCapture();
    recording = null;
    const settings = options.settings();
    if (!settings) return;
    void save(withSkillKeyBinding(settings.skillKeyBindings, slot, binding));
  }

  function onMouseDown(event: MouseEvent): void {
    if (recording === null || captureControl(event)) return;
    if (!Number.isSafeInteger(event.button) || event.button < 0 || event.button > 15) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.button === 2) {
      window.addEventListener("contextmenu", (contextMenu) => {
        contextMenu.preventDefault();
        contextMenu.stopImmediatePropagation();
      }, { capture: true, once: true });
    }
    accept({
      input: { kind: "mouse-button", button: event.button },
      modifiers: modifiersFromEvent(event),
    });
  }

  function onWheel(event: WheelEvent): void {
    if (recording === null || captureControl(event) || event.deltaY === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    accept({
      input: { kind: "wheel", direction: event.deltaY < 0 ? "up" : "down" },
      modifiers: modifiersFromEvent(event),
    });
  }

  function render(settings: AppSettings): void {
    options.fieldset.hidden = !settings.gwonmacTools;
    rows.forEach((_row, slot) => {
      const binding = settings.skillKeyBindings[slot] ?? null;
      const { change, clear, message } = rowParts(slot);
      views[slot]!.update(binding);
      change.textContent = recording === slot ? "Cancel" : "Change";
      clear.disabled = binding === null || recording !== null;
      message.hidden = recording !== slot;
      message.textContent = recording === slot
        ? "Press a key, mouse button, or scroll the wheel. Modifiers are included."
        : "";
    });
    options.clearAll.disabled = settings.skillKeyBindings.every((binding) => binding === null)
      || recording !== null;
  }

  async function record(slot: number): Promise<void> {
    if (recording === slot) {
      cancel();
      rowParts(slot).change.focus();
      return;
    }
    cancel();
    recording = slot;
    const token = ++generation;
    const settings = options.settings();
    if (settings) render(settings);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    const result = await window.gwNative.skillKeys.captureKeyboard();
    if (token !== generation || recording !== slot) return;
    if (result.status === "captured") accept(result.binding);
    else if (result.status === "invalid") {
      const { message, change } = rowParts(slot);
      cancel();
      message.textContent = "That key cannot be represented by Guild Wars.";
      message.hidden = false;
      change.focus();
    } else cancel();
  }

  rows.forEach((_row, slot) => {
    const { change, clear } = rowParts(slot);
    change.addEventListener("click", () => void record(slot));
    clear.addEventListener("click", () => {
      const settings = options.settings();
      if (settings) void save(withSkillKeyBinding(settings.skillKeyBindings, slot, null));
    });
  });
  options.clearAll.addEventListener("click", () => {
    cancel();
    void save(EMPTY_SKILL_KEY_BINDINGS);
  });
  options.dialog.addEventListener("close", cancel);
  window.addEventListener("blur", cancel);

  return Object.freeze({ render, cancel });
}
