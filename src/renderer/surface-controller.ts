/**
 * Keyboard and modal ownership for GWonMac surfaces above the game.
 *
 * Tools deliberately stays open when a player clicks Guild Wars, so DOM focus
 * alone cannot decide which surface Escape or Tab belongs to. This
 * controller keeps one ordered list of visible host surfaces. Escape dismisses
 * the topmost one and Tab enters or wraps within it. Dialogs use the platform's
 * modal behavior, with one shared backdrop, dismissal, and focus lifecycle.
 */

type Surface = Readonly<{
  root: HTMLElement;
  priority: number;
  transient?: boolean;
  dismiss(): void;
}>;

type OpenSurface = Surface & { order: number };

type ModalDialog = Readonly<{
  root: HTMLDialogElement;
  priority: number;
  transient?: boolean;
  dismiss(): void;
  restoreFocus(): HTMLElement | null;
}>;

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.closest("[hidden], [inert]") === null
    && element.getClientRects().length > 0
  );
}

export function installSurfaceController(
  document: Document,
): GwonmacSurfaceController {
  const surfaces = new Map<symbol, OpenSurface>();
  const suppressedKeyUps = new Set<string>();
  let order = 0;

  const topmost = () => [...surfaces.values()].sort((left, right) =>
    right.priority - left.priority || right.order - left.order
  )[0] ?? null;

  const dismissTransient = (except?: symbol) => {
    const open = [...surfaces.entries()]
      .filter(([id, surface]) => id !== except && surface.transient)
      .sort((left, right) =>
        right[1].priority - left[1].priority || right[1].order - left[1].order
      );
    for (const [id, surface] of open) {
      surface.dismiss();
      // A faulty surface must not keep stale ownership after dismissal.
      surfaces.delete(id);
    }
  };

  const claim = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressedKeyUps.add(event.code);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (document.querySelector("dialog:modal") !== null) return;
    const surface = topmost();
    if (!surface) return;

    if (event.key === "Escape") {
      claim(event);
      surface.dismiss();
      return;
    }
    if (
      event.key !== "Tab"
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) return;

    const elements = focusableElements(surface.root);
    if (elements.length === 0) {
      claim(event);
      return;
    }
    const first = elements[0]!;
    const last = elements.at(-1)!;
    const active = document.activeElement;
    if (!surface.root.contains(active)) {
      claim(event);
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (event.shiftKey && active === first) {
      claim(event);
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      claim(event);
      first.focus({ preventScroll: true });
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!suppressedKeyUps.delete(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("gw:input-release", (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      suppressedKeyUps.delete(event.detail);
    }
  });
  const clearSuppressedKeyUps = () => suppressedKeyUps.clear();
  window.addEventListener("blur", clearSuppressedKeyUps);
  window.addEventListener("pagehide", clearSuppressedKeyUps);
  window.addEventListener("gw:input-reset", clearSuppressedKeyUps);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") clearSuppressedKeyUps();
  });

  const register = (surface: Surface): GwonmacSurfaceHandle => {
    const id = Symbol("surface");
    let open = false;
    // Input diagnostics report only this coarse ownership category. The
    // marker carries no UI text or selector, and lets a player distinguish
    // "Guild Wars received the click" from "a GWonMac surface owned it".
    surface.root.dataset.gwonmacSurface = "";
    return Object.freeze({
      setOpen(next: boolean) {
        if (next === open) return;
        open = next;
        if (next) {
          if (surface.transient) dismissTransient(id);
          surfaces.set(id, { ...surface, order: order++ });
        }
        else surfaces.delete(id);
      },
      raise() {
        const current = surfaces.get(id);
        if (!current) return;
        surfaces.set(id, { ...current, order: order++ });
      },
      dispose() {
        open = false;
        surfaces.delete(id);
        delete surface.root.dataset.gwonmacSurface;
      },
    });
  };

  return Object.freeze({
    register,
    registerDialog(dialog: ModalDialog): GwonmacDialogHandle {
      const dismissForReplacement = () => {
        dialog.dismiss();
        // Replacing a transient modal is unconditional. Feature dismissals
        // may first update local view state, but they cannot leave the old
        // native dialog in the top layer and block its replacement.
        if (dialog.root.open) dialog.root.close();
        surface.setOpen(false);
      };
      const surface = register({
        root: dialog.root,
        priority: dialog.priority,
        ...(dialog.transient === undefined ? {} : { transient: dialog.transient }),
        dismiss: dismissForReplacement,
      });
      let disposed = false;

      const restoreFocus = () => {
        const target = dialog.restoreFocus();
        const remainingModal = document.querySelector("dialog:modal");
        if (target && (remainingModal === null || remainingModal.contains(target))) {
          target.focus({ preventScroll: true });
        }
      };
      const onCancel = (event: Event) => {
        event.preventDefault();
        dialog.dismiss();
      };
      const onClick = (event: MouseEvent) => {
        if (event.target !== dialog.root) return;
        event.preventDefault();
        event.stopPropagation();
        dialog.dismiss();
      };
      const onClose = () => {
        // Chromium queues `close`. The dialog may already have reopened by
        // the time an older event arrives; that event must not withdraw the
        // new modal claim or restore focus behind it.
        if (dialog.root.open) return;
        surface.setOpen(false);
        // A transient replacement may already be modal by the time Chromium
        // delivers the old dialog's close event. Restore only when the target
        // belongs to the remaining parent modal or no modal replaced it.
        restoreFocus();
      };
      const stop = (event: Event) => event.stopPropagation();
      const isolatedEvents = [
        "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
        "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
      ] as const;
      dialog.root.addEventListener("cancel", onCancel);
      dialog.root.addEventListener("click", onClick);
      dialog.root.addEventListener("close", onClose);
      for (const name of isolatedEvents) dialog.root.addEventListener(name, stop);

      return Object.freeze({
        show() {
          if (disposed || dialog.root.open) return;
          if (document.pointerLockElement !== null) void document.exitPointerLock();
          surface.setOpen(true);
          try {
            dialog.root.showModal();
          } catch (error) {
            surface.setOpen(false);
            throw error;
          }
        },
        close() {
          if (dialog.root.open) dialog.root.close();
          // `close` is queued, while ownership changes synchronously. Withdraw
          // now so a same-turn reopen receives a fresh modal claim.
          surface.setOpen(false);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          if (dialog.root.open) dialog.root.close();
          surface.dispose();
          dialog.root.removeEventListener("cancel", onCancel);
          dialog.root.removeEventListener("click", onClick);
          dialog.root.removeEventListener("close", onClose);
          for (const name of isolatedEvents) dialog.root.removeEventListener(name, stop);
        },
      });
    },
    dismissTransient,
  });
}
