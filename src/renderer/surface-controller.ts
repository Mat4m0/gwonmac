/**
 * Keyboard ownership for non-modal GWonMac surfaces above the game.
 *
 * Tools and Travel deliberately stay open when a player clicks Guild Wars, so
 * DOM focus alone cannot decide which surface Escape or Tab belongs to. This
 * controller keeps one ordered list of visible host surfaces. Escape dismisses
 * the topmost one and Tab enters or wraps within it. Native modal dialogs stay
 * above this list and keep their browser-provided focus and Escape behavior.
 */

type Surface = Readonly<{
  root: HTMLElement;
  priority: number;
  dismiss(): void;
}>;

type OpenSurface = Surface & { order: number };

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

  return Object.freeze({
    register(surface: Surface): GwonmacSurfaceHandle {
      const id = Symbol("surface");
      let open = false;
      return Object.freeze({
        setOpen(next: boolean) {
          if (next === open) return;
          open = next;
          if (next) surfaces.set(id, { ...surface, order: order++ });
          else surfaces.delete(id);
        },
        dispose() {
          open = false;
          surfaces.delete(id);
        },
      });
    },
  });
}
