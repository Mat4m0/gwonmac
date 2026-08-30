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
import { ensureToolsStylesheet } from "./tools-stylesheet.js";
import { requireToolsApi } from "./tools-native-api.js";

export function createTravelPalette(
  parent: HTMLElement,
  command: TravelCommand,
) {
  const native = requireToolsApi();
  const canvas = parent.ownerDocument.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Travel game canvas is missing");
  }
  const style = parent.ownerDocument.createElement("style");
  style.textContent = `
    #travel-palette-host { position: absolute; inset: 0; pointer-events: none; }
  `;
  const root = parent.ownerDocument.createElement("dialog");
  root.id = "travel-palette-root";
  root.className = "ui-modal ui-modal-layer";
  root.setAttribute("aria-label", "Quick Travel");
  const host = parent.ownerDocument.createElement("div");
  host.id = "travel-palette-host";
  root.append(host);
  parent.append(style, root);

  let enabled = false;
  let requested = false;
  let disposed = false;
  let state: TravelGameState = { status: "waiting", reason: "game" };
  let app: TravelPaletteHandle | null = null;
  function setOpen(next: boolean): void {
    if (!enabled && next) throw new Error(command.unavailable() ?? "Travel is turned off");
    if (root.open === next) return;
    if (next) modal.show();
    else modal.close();
    if (next && !requested) {
      requested = true;
      ensureToolsStylesheet(parent.ownerDocument);
      const specifier = "./tools/tools-app.js";
      void import(specifier).then((bundle: EmbeddedToolsBundle<HTMLElement>) => {
        if (disposed) return;
        app = bundle.mountTravelPalette(host, {
          nativeApi: native,
          command,
          development: window.gwNative.init.development,
          initiallyVisible: root.open,
          onVisibilityChange: (visible) => setOpen(visible),
        });
        app.update(state);
      }).catch((cause: unknown) => {
        console.error("[travel] the Travel palette failed to load", cause);
        modal.close();
      });
    } else if (app) {
      if (next) app.show();
      else app.hide();
    }
  }
  const modal = window.gwSurfaces.registerDialog({
    root,
    priority: 6,
    transient: true,
    dismiss: () => setOpen(false),
    restoreFocus: () => canvas,
  });

  const onCommand = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    event.preventDefault();
    try {
      setOpen(!root.open);
    } catch (error) {
      if (event.detail !== null && typeof event.detail === "object") {
        (event.detail as { error?: unknown }).error = error;
      }
    }
  };
  window.addEventListener("gw:travel-toggle", onCommand);

  return Object.freeze({
    setEnabled(next: boolean) {
      enabled = next;
      if (!next && root.open) setOpen(false);
    },
    update(next: TravelGameState) {
      state = next;
      app?.update(next);
    },
    dispose() {
      disposed = true;
      window.removeEventListener("gw:travel-toggle", onCommand);
      app?.dispose();
      modal.dispose();
      style.remove();
      root.remove();
    },
  });
}
