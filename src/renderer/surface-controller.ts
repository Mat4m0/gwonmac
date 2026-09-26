/**
 * Keyboard and modal ownership for GWonMac surfaces above the game.
 *
 * Tools deliberately stays open when a player clicks Guild Wars, so DOM focus
 * alone cannot decide which surface Escape or Tab belongs to. This
 * controller keeps one ordered list of visible host surfaces. Escape dismisses
 * the topmost one and Tab enters or wraps within it. Dialogs use the platform's
 * modal behavior, with one shared backdrop, dismissal, and focus lifecycle.
 * A press that starts on a surface owns its repeats and release, so a key that
 * closes a surface never continues into the game.
 *
 * The pointer has the same rule for a click run (HUB-242, HUB-244). Chromium
 * counts the clicks of one run in `detail`; a run belongs to the surface page
 * its first press landed on. When that page changes or the surface closes
 * before a later press of the run, the rest of the run is swallowed wherever
 * it lands, the game canvas included, so a double-click never runs what its
 * first click revealed and never reaches Guild Wars as a world click.
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

/** A pointerdown belongs to the previous press of a cancelled run only this soon and this close. */
const CLICK_RUN_MS = 500;
const CLICK_RUN_SLOP = 8;
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
  // Each registered root's page generation. It advances when the surface
  // opens, closes or reports a page change.
  const pages = new WeakMap<Element, { generation: number }>();
  const suppressedKeyUps = new Set<string>();
  // Physical keys whose press began on a surface (HUB-003). The game never saw
  // the key-down, so a repeat or release that lands off the surface after it
  // closed must not reach the game either.
  const ownedPresses = new Set<string>();
  const onSurface = (target: EventTarget | null) =>
    target instanceof Element && target.closest("[data-gwonmac-surface]") !== null;
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
    if (!event.repeat) {
      if (onSurface(event.target)) ownedPresses.add(event.code);
      else ownedPresses.delete(event.code);
    } else if (ownedPresses.has(event.code) && !onSurface(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const nativeModal = document.querySelector("dialog:modal");
    const surface = topmost();
    if (!surface || (nativeModal !== null && nativeModal !== surface.root)) return;

    if (event.key === "Escape") {
      if (nativeModal !== null) return; // The native cancel event owns dismissal.
      claim(event);
      const expanded = (event.target instanceof Element ? event.target.closest<HTMLDetailsElement>('details[open]') : null);
      if (expanded && surface.root.contains(expanded)) {
        expanded.open = false; expanded.querySelector('summary')?.focus(); return;
      }
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
    const owned = ownedPresses.delete(event.code) && !onSurface(event.target);
    if (!suppressedKeyUps.delete(event.code) && !owned) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("gw:input-release", (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      suppressedKeyUps.delete(event.detail);
      ownedPresses.delete(event.detail);
    }
  });
  const clearSuppressedKeyUps = () => suppressedKeyUps.clear();
  // An input reset releases the game's keys; a surface press stays owned
  // through it, because the action it runs may reset input before release.
  const clearPresses = () => { clearSuppressedKeyUps(); ownedPresses.clear(); };
  window.addEventListener("blur", clearPresses);
  window.addEventListener("pagehide", clearPresses);
  window.addEventListener("gw:input-reset", clearSuppressedKeyUps);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") clearPresses();
  });

  // The one click-run owner. It listens first on the window capture phase,
  // before `input.ts`, the native double-click flag and any surface, so a
  // swallowed press never reaches the game's held-button ledger, never counts
  // as input that cancels a pending focus, and never moves focus.
  type ClickRun = {
    page: { generation: number } | null;
    generation: number;
    x: number;
    y: number;
    at: number;
    cancelled: boolean;
  };
  let run: ClickRun | null = null;
  // The current press continues a cancelled run: its remaining events are swallowed.
  let swallowingPress = false;
  const pageOf = (target: EventTarget | null) => {
    const root = target instanceof Element ? target.closest("[data-gwonmac-surface]") : null;
    return root ? pages.get(root) ?? null : null;
  };
  const stale = (current: ClickRun) => {
    if (!current.cancelled && current.page !== null && current.page.generation !== current.generation) {
      current.cancelled = true;
    }
    return current.cancelled;
  };
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const primary = (event: MouseEvent) => event.isTrusted && event.button === 0;
  window.addEventListener("pointerdown", (event) => {
    if (!primary(event)) return;
    swallowingPress = false;
    // A pointerdown carries no click count, so it is paired with a stale run by
    // time and place and kept from every later listener. It is not cancelled:
    // that would also drop the mousedown of a fresh press, which alone says
    // whether this press continues the run.
    if (run !== null && (stale(run) || (run.page !== null && pageOf(event.target) !== run.page))
      && event.timeStamp - run.at <= CLICK_RUN_MS
      && Math.hypot(event.clientX - run.x, event.clientY - run.y) <= CLICK_RUN_SLOP) {
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("mousedown", (event) => {
    if (!primary(event)) return;
    if (event.detail <= 1) {
      const page = pageOf(event.target);
      run = { page, generation: page?.generation ?? 0, x: event.clientX, y: event.clientY, at: event.timeStamp, cancelled: false };
      return;
    }
    if (run === null) return;
    run.at = event.timeStamp;
    // A run that began on a surface never continues somewhere else, the game included.
    if (run.page !== null && pageOf(event.target) !== run.page) run.cancelled = true;
    if (!stale(run)) return;
    swallowingPress = true;
    swallow(event);
  }, true);
  for (const type of ["pointerup", "mouseup"] as const) {
    window.addEventListener(type, (event) => {
      if (!primary(event)) return;
      if (run) run.at = event.timeStamp;
      if (swallowingPress) swallow(event);
    }, true);
  }
  for (const type of ["click", "dblclick"] as const) {
    window.addEventListener(type, (event) => {
      // A keyboard activation (detail 0) is never part of a click run.
      if (!primary(event) || event.detail === 0) return;
      if (swallowingPress || (event.detail > 1 && run !== null && stale(run))) swallow(event);
    }, true);
  }

  const register = (surface: Surface): GwonmacSurfaceHandle => {
    const id = Symbol("surface");
    let open = false;
    // Input diagnostics report only this coarse ownership category. The
    // marker carries no UI text or selector, and lets a player distinguish
    // "Guild Wars received the click" from "a GWonMac surface owned it".
    surface.root.dataset.gwonmacSurface = "";
    const page = { generation: 0 };
    pages.set(surface.root, page);
    return Object.freeze({
      setOpen(next: boolean) {
        if (next === open) return;
        open = next;
        page.generation++;
        if (next) {
          if (surface.transient) dismissTransient(id);
          surfaces.set(id, { ...surface, order: order++ });
          if (!(surface.root instanceof HTMLDialogElement)) surface.root.style.zIndex = String(100 + order);
        }
        else surfaces.delete(id);
      },
      pageChanged() {
        page.generation++;
      },
      raise() {
        const current = surfaces.get(id);
        if (!current) return;
        surfaces.set(id, { ...current, order: order++ });
        if (!(surface.root instanceof HTMLDialogElement)) surface.root.style.zIndex = String(100 + order);
      },
      dispose() {
        open = false;
        page.generation++;
        surfaces.delete(id);
        pages.delete(surface.root);
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
        pageChanged: surface.pageChanged,
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
