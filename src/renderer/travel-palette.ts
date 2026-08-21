/**
 * Renderer boundary for the Cmd+T Travel palette. It owns visibility, focus,
 * event isolation, lazy Vue loading, and nothing about destination search.
 */
import type {
  TravelCommand,
  TravelGameState,
} from "../shared/travel-command.js";
import type {
  EmbeddedToolsBundle,
  TravelPaletteHandle,
} from "../shared/tools-bundle-contracts.js";

export function createTravelPalette(
  parent: HTMLElement,
  command: TravelCommand,
) {
  const canvas = parent.ownerDocument.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Travel game canvas is missing");
  }
  const style = parent.ownerDocument.createElement("style");
  style.textContent = `
    #travel-palette-root { position: fixed; inset: 0; z-index: 6; pointer-events: none; }
    #travel-palette-host { position: absolute; inset: 0; pointer-events: none; }
  `;
  const root = parent.ownerDocument.createElement("section");
  root.id = "travel-palette-root";
  root.hidden = true;
  const host = parent.ownerDocument.createElement("div");
  host.id = "travel-palette-host";
  root.append(host);
  parent.append(style, root);

  let enabled = false;
  let open = false;
  let requested = false;
  let disposed = false;
  let state: TravelGameState = { status: "waiting", reason: "game" };
  let app: TravelPaletteHandle | null = null;
  const dismissable = window.gwSurfaces.register({
    root,
    priority: 6,
    dismiss: () => setOpen(false),
  });

  const setOpen = (next: boolean) => {
    if (!enabled && next) throw new Error(command.unavailable() ?? "Travel is turned off");
    if (open === next) return;
    open = next;
    root.hidden = !next;
    dismissable.setOpen(next);
    if (next && parent.ownerDocument.pointerLockElement !== null) {
      parent.ownerDocument.exitPointerLock();
    }
    if (next && !requested) {
      requested = true;
      const specifier = "./tools/tools-app.js";
      void import(specifier).then((bundle: EmbeddedToolsBundle<HTMLElement>) => {
        if (disposed) return;
        app = bundle.mountTravelPalette(host, {
          command,
          development: window.gwNative.init.development,
          initiallyVisible: open,
          onVisibilityChange: (visible) => setOpen(visible),
        });
        app.update(state);
      }).catch((cause: unknown) => {
        console.error("[travel] the Travel palette failed to load", cause);
        open = false;
        root.hidden = true;
      });
    } else if (app) {
      if (next) app.show();
      else app.hide();
    }
    if (!next) canvas.focus({ preventScroll: true });
  };

  const onCommand = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    event.preventDefault();
    try {
      setOpen(!open);
    } catch (error) {
      if (event.detail !== null && typeof event.detail === "object") {
        (event.detail as { error?: unknown }).error = error;
      }
    }
  };
  const stop = (event: Event) => event.stopPropagation();
  for (const name of [
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
  ]) root.addEventListener(name, stop);
  window.addEventListener("gw:travel-toggle", onCommand);

  return Object.freeze({
    setEnabled(next: boolean) {
      enabled = next;
      if (!next && open) setOpen(false);
    },
    update(next: TravelGameState) {
      state = next;
      app?.update(next);
    },
    dispose() {
      disposed = true;
      window.removeEventListener("gw:travel-toggle", onCommand);
      app?.dispose();
      dismissable.dispose();
      style.remove();
      root.remove();
      canvas.focus({ preventScroll: true });
    },
  });
}
