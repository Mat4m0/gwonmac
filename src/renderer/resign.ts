/**
 * Sends only the confirmed /resign command through the client's normal chat UI.
 * No command is sent unless an empty text proxy opens from the game canvas.
 */
export async function resignFromGame(): Promise<void> {
  const canvas = document.getElementById("canvas");
  const field = document.getElementById("osk-input-text");
  const context = window.gwCharacterSwitch?.context;
  if (!(canvas instanceof HTMLCanvasElement) || !(field instanceof HTMLInputElement)
    || document.activeElement !== canvas || !document.hasFocus()
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
  const unchanged = () => !interrupted && document.hasFocus()
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
    field.value = "/resign";
    field.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: "insertText", data: "/resign",
    }));
    // Let the game consume text input before submitting its visible chat editor.
    await new Promise((resolve) => setTimeout(resolve, 16));
    if (!unchanged() || document.activeElement !== field || field.value !== "/resign") {
      throw new Error("Resign was interrupted. Check the chat field before continuing.");
    }
    key(field, "Enter");
  } finally {
    window.removeEventListener("keydown", interrupt, true);
    window.removeEventListener("pointerdown", interrupt, true);
  }
}
