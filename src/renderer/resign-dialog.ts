/**
 * Small Resign confirmation in the shared Travel modal and material system.
 * Dismissal never submits; only an explicit Enter or confirmation click does,
 * once the shared arming window has passed (HUB-245 arming, HUB-242).
 */
import { armConfirmation } from "./surface-controller.js";

/** The Hub task that opened the confirmation: it ends when Resign is sent and resumes on Cancel (HUB-250). */
export type ResignHandoff = Readonly<{ confirmed(): void; cancelled(): void }>;

export function createResignDialog(
  parent: HTMLElement,
  unavailable: () => string | null,
  submit: () => void,
) {
  const canvas = parent.ownerDocument.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Guild Wars canvas is missing.");
  const style = parent.ownerDocument.createElement("style");
  style.textContent = `
    .resign-panel { position: fixed; top: clamp(160px, 23vh, 280px); left: 50%;
      width: min(440px, calc(100vw - 32px)); max-height: calc(77vh - 24px);
      display: flex; flex-direction: column; overflow: hidden; transform: translateX(-50%); }
    .resign-panel > .ui-panel-head { border-top-left-radius: inherit; border-top-right-radius: inherit; }
    .resign-panel .ui-panel-body { display: grid; gap: var(--ui-space-3); }
    .resign-panel p { margin: 0; }
    .resign-panel .ui-panel-foot { justify-content: flex-end; }
    .resign-error { color: var(--ui-danger); }
    @media (max-height: 560px) { .resign-panel { top: 16px; max-height: calc(100vh - 32px); } }
  `;
  const root = parent.ownerDocument.createElement("dialog");
  root.id = "resign-dialog";
  root.className = "ui-modal ui-modal-layer";
  root.setAttribute("aria-labelledby", "resign-title");
  root.setAttribute("aria-describedby", "resign-description");
  root.innerHTML = `<section class="ui-frame resign-panel">
    <header class="ui-panel-head ui-window-head">
      <h2 class="ui-panel-title" id="resign-title">Resign?</h2>
      <button type="button" class="ui-button" data-icon aria-label="Close Resign">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
      </button>
    </header>
    <div class="ui-panel-body">
      <p id="resign-description">Sends /resign to your party. When everyone has resigned, the party returns to the outpost and this attempt ends.</p>
      <p class="resign-error" role="alert" hidden></p>
    </div>
    <footer class="ui-panel-foot">
      <button type="button" class="ui-button" data-cancel>Cancel</button>
      <button type="button" class="ui-button" data-variant="danger" data-confirm>Resign <kbd aria-hidden="true">↵</kbd></button>
    </footer>
  </section>`;
  const closeButton = root.querySelector<HTMLButtonElement>("[data-icon]")!;
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-cancel]")!;
  const confirmButton = root.querySelector<HTMLButtonElement>("[data-confirm]")!;
  const error = root.querySelector<HTMLParagraphElement>("[role=alert]")!;
  const arming = armConfirmation(confirmButton);
  parent.append(style, root);
  let handoff: ResignHandoff | undefined;
  /** Closes; an explicit cancel returns to the Hub task that opened it, a blur leaves it suspended. */
  const close = (outcome: "cancelled" | "confirmed" | "blurred" = "cancelled") => {
    if (!root.open) return;
    window.removeEventListener("blur", onBlur);
    arming.disarm();
    modal.close();
    const opener = handoff;
    handoff = undefined;
    if (outcome === "confirmed") opener?.confirmed();
    else if (outcome === "cancelled") opener?.cancelled();
  };
  const onBlur = () => close("blurred");
  const modal = window.gwSurfaces.registerDialog({
    root, priority: 7, transient: true, dismiss: () => close(), restoreFocus: () => canvas,
  });
  const report = (message: string | null) => {
    error.textContent = message ?? "";
    error.hidden = message === null;
    confirmButton.disabled = message !== null;
  };
  // The press or click that opened the dialog, and the later clicks of a
  // multi-click, never confirm it.
  const confirm = (event?: Event) => {
    if (!root.open || confirmButton.disabled || !arming.accepts(event)) return;
    try {
      const refusal = unavailable();
      if (refusal !== null) { report(refusal); cancelButton.focus(); return; }
      submit();
      close("confirmed");
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "Resign could not be completed.");
      cancelButton.focus();
    }
  };
  closeButton.addEventListener("click", () => close());
  cancelButton.addEventListener("click", () => close());
  confirmButton.addEventListener("click", (event) => confirm(event));
  root.addEventListener("keydown", (event) => {
    if (event.key === " " && event.target === confirmButton) event.preventDefault();
    if (event.key !== "Enter") return;
    if (event.target === cancelButton || event.target === closeButton) return;
    event.preventDefault();
    if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    confirm();
  });
  return Object.freeze({
    show(opener?: ResignHandoff) {
      if (root.open) return;
      handoff = opener;
      report(unavailable());
      modal.show();
      arming.arm();
      (confirmButton.disabled ? cancelButton : confirmButton).focus({ preventScroll: true });
      window.addEventListener("blur", onBlur);
    },
    /** Closes without returning to a Hub task, e.g. when Resign is turned off. */
    close: () => close("blurred"),
    dispose() {
      window.removeEventListener("blur", onBlur);
      modal.dispose();
      root.remove();
      style.remove();
    },
  });
}
