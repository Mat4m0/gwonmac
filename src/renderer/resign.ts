/**
 * Prepares an empty chat editor and validates the fixed command before submission.
 * Main owns native text insertion; this owner preserves focus and interruption checks.
 */
import { featureActivationRequested } from "../shared/feature-contracts.js";

let pending: { submit(): void; dispose(): void } | null = null;

export async function resignFromGame(phase: "prepare" | "submit" | "cancel"): Promise<void> {
  if (phase !== "prepare") {
    const current = pending;
    pending = null;
    try {
      if (phase === "submit") {
        if (!current) throw new Error("Resign preparation expired.");
        current.submit();
      }
    } finally { current?.dispose(); }
    return;
  }
  pending?.dispose();
  pending = null;
  const enabled = () => featureActivationRequested("resign", window.gwToolsSettings());
  if (!enabled()) throw new Error("Enable Resign in Tools settings first.");
  const canvas = document.getElementById("canvas");
  const field = document.getElementById("osk-input-text");
  const context = window.gwCharacterSwitch?.context;
  if (!(canvas instanceof HTMLCanvasElement) || !(field instanceof HTMLInputElement)
    || document.activeElement !== canvas || field.value !== "" || !document.hasFocus()
    || (context !== "outpost" && context !== "pve-explorable")) {
    throw new Error("Return to Guild Wars in PvE and close other windows or text fields first.");
  }
  let interrupted = false;
  const interrupt = (event: Event) => { if (event.isTrusted) interrupted = true; };
  const key = (target: HTMLElement, value: "Enter") => {
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: value, code: value, bubbles: true, cancelable: true,
      }));
    }
  };
  const unchanged = () => enabled() && !interrupted && document.hasFocus()
    && window.gwCharacterSwitch?.context === context;
  window.addEventListener("keydown", interrupt, true);
  window.addEventListener("pointerdown", interrupt, true);
  try {
    key(canvas, "Enter");
    const deadline = performance.now() + 1_000;
    while (document.activeElement !== field && unchanged() && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (!unchanged() || document.activeElement !== field || field.value !== ""
      || field.disabled || field.readOnly) {
      throw new Error("Chat did not open empty. Nothing was sent; close chat and try again.");
    }
    const timer = setTimeout(() => {
      pending?.dispose();
      pending = null;
    }, 4_000);
    pending = {
      submit() {
        if (!unchanged() || document.activeElement !== field || field.value !== "/resign") {
          throw new Error("Resign was interrupted. Check the chat field before continuing.");
        }
        key(field, "Enter");
      },
      dispose() {
        clearTimeout(timer);
        window.removeEventListener("keydown", interrupt, true);
        window.removeEventListener("pointerdown", interrupt, true);
      },
    };
  } finally {
    if (pending === null) {
      window.removeEventListener("keydown", interrupt, true);
      window.removeEventListener("pointerdown", interrupt, true);
    }
  }
}
