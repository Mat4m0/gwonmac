/**
 * Owns input isolation and Vue lifetime for the optional whisper surface.
 * Temporary region withdrawal hides the view without losing its placement.
 */
import type { WhisperSession } from "../shared/whisper-session.js";
import type { EmbeddedToolsBundle } from "../shared/tools-bundle-contracts.js";
import { createNonActivatingSurface } from "./non-activating-surface.js";
import { ensureToolsStylesheet } from "./tools-stylesheet.js";

export function createWhisperSurface(parent: HTMLElement, session: WhisperSession) {
  const document = parent.ownerDocument;
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Whispers game canvas is missing");
  const root = document.createElement("div");
  root.id = "whispers-host";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:4";
  parent.append(root);
  const nonActivating = createNonActivatingSurface(root, () => canvas);
  const surface = window.gwSurfaces.register({ root, priority: 4,
    dismiss: () => session.setVisible(false) });
  const toggle = (event: Event) => {
    if (!enabled || !session.state.available) return;
    event.preventDefault();
    session.setVisible(!session.state.visible);
    if (session.state.visible) requestAnimationFrame(() => {
      if (disposed || !enabled || !session.state.visible) return;
      const id = session.state.selected ? `draft-${session.state.selected}` : "whisper-person";
      root.querySelector<HTMLInputElement>(`input[id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
  };
  window.addEventListener("gw:whispers-toggle", toggle);
  let visible = false;
  let enabled = true;
  let disposed = false;
  let app: { dispose(): void } | null = null;
  const unsubscribe = session.subscribe(state => {
    surface.setOpen(enabled && state.visible);
    if (state.visible === visible) return;
    visible = state.visible;
    if (visible && document.pointerLockElement) document.exitPointerLock();
    if (!visible) nonActivating.releaseKeyboard();
  });
  // Reparenting during a press cancels the click and pointer capture in Chromium.
  root.addEventListener("pointerdown", () => surface.raise(), true);
  const stop = (event: Event) => event.stopPropagation();
  for (const name of ["keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "contextmenu"]) root.addEventListener(name, stop);
  root.addEventListener("wheel", stop, { passive: true });
  ensureToolsStylesheet(document);
  const specifier = "./tools/tools-app.js";
  void import(specifier).then((bundle: EmbeddedToolsBundle<HTMLElement>) => {
    if (!disposed) app = bundle.mountWhispers(root, { session });
  }).catch(() => {
    if (disposed) return;
    root.textContent = "Whispers could not load. Use original chat and restart to try again.";
    root.style.pointerEvents = "auto";
    root.style.inset = "auto 16px 16px auto";
    root.classList.add("ui-frame");
  });
  return {
    setEnabled(next: boolean) {
      enabled = next; root.hidden = !next; surface.setOpen(next && session.state.visible);
      if (!next && root.contains(document.activeElement)) nonActivating.releaseKeyboard();
    },
    dispose() {
      if (disposed) return;
      window.removeEventListener("gw:whispers-toggle", toggle);
      disposed = true; unsubscribe(); app?.dispose(); surface.dispose();
      if (root.contains(document.activeElement)) nonActivating.releaseKeyboard();
      nonActivating.dispose(); root.remove();
      window.dispatchEvent(new CustomEvent("gw:input-reset"));
    },
  };
}
