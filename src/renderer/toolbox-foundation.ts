/**
 * The shared in-game boundary for the two independent Tools windows.
 *
 * Builds & Teams and Trade Chat mount lazily into explicit hosts. They may be
 * open together; the last interacted host owns visual stacking, Escape and
 * Tab. There is intentionally no registry or general layout system.
 */
import { createNonActivatingSurface } from "./non-activating-surface.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";

type ToolboxState = ToolboxObservation;

const OVERLAY_CSS = `
#toolbox-foundation {
  position: fixed;
  inset: 0;
  z-index: 4;
  box-sizing: border-box;
  pointer-events: none;
  color: #e8e4d8;
  font: 12px/1.45 -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
}
#toolbox-foundation > [data-role] {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
`;

const TOGGLE_CODE = "Space";

export interface MountedTool {
  setVisible(visible: boolean): void;
  setActive?(active: boolean): void;
  requestClose(): void;
  update(state: ToolboxState): void;
  dispose(): void;
}

type MountTool = (
  host: HTMLElement,
  onVisibilityChange: (visible: boolean) => void,
) => Promise<MountedTool | null>;

type FoundationOptions = {
  /** Existing Builds & Teams mount. The name stays compatible with fixtures. */
  mountTool: MountTool;
  /** The separate host-only Trade Chat mount. */
  mountTrade?: MountTool;
};

type Slot = {
  readonly name: "builds" | "trade";
  readonly host: HTMLElement;
  readonly mount: MountTool;
  readonly surface: GwonmacSurfaceHandle;
  tool: MountedTool | null;
  requested: boolean;
  visible: boolean;
};

export type ToolboxAvailability = Readonly<{
  builds: boolean;
  trade: boolean;
}>;

export function createToolboxFoundation(
  parent: HTMLElement,
  options: FoundationOptions,
) {
  const document = parent.ownerDocument;
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Tools game canvas is missing");
  }

  const style = document.createElement("style");
  style.id = "toolbox-foundation-style";
  style.textContent = OVERLAY_CSS;
  const root = document.createElement("section");
  root.id = "toolbox-foundation";
  root.setAttribute("aria-label", "Tools");
  const buildsHost = makeHost(document, "toolbox-builds", "builds");
  const tradeHost = makeHost(document, "toolbox-trade", "trade");
  root.append(buildsHost, tradeHost);
  parent.append(style, root);

  const nonActivating = createNonActivatingSurface(root, () => canvas);
  let state: ToolboxState = Object.freeze({ status: "waiting" });
  let disposed = false;
  let stackOrder = 0;
  let active: Slot | null = null;
  let availability: ToolboxAvailability = { builds: true, trade: true };

  const requestClose = (slot: Slot): void => {
    if (!slot.visible) return;
    if (slot.tool) slot.tool.requestClose();
    else setOpen(slot, false);
  };
  const makeSlot = (
    name: Slot["name"],
    element: HTMLElement,
    mount: MountTool,
  ): Slot => {
    const slot: Slot = {
      name,
      host: element,
      mount,
      tool: null,
      requested: false,
      visible: false,
      surface: window.gwSurfaces.register({
        root: element,
        priority: 4,
        dismiss: () => requestClose(slot),
      }),
    };
    return slot;
  };
  const builds = makeSlot("builds", buildsHost, options.mountTool);
  const trade = options.mountTrade
    ? makeSlot("trade", tradeHost, options.mountTrade)
    : null;
  const slots = (): Slot[] => trade ? [builds, trade] : [builds];

  const activate = (slot: Slot) => {
    active = slot;
    slot.host.style.zIndex = String(++stackOrder);
    slot.surface.raise();
    for (const candidate of slots()) {
      candidate.tool?.setActive?.(candidate === slot);
    }
  };

  const ensure = (slot: Slot) => {
    if (slot.requested) return;
    slot.requested = true;
    void slot.mount(slot.host, (visible) => setOpen(slot, visible))
      .then((mounted) => {
        if (disposed) {
          mounted?.dispose();
          return;
        }
        slot.tool = mounted;
        mounted?.setVisible(slot.visible);
        mounted?.setActive?.(active === slot);
        if (slot.name === "builds") mounted?.update(state);
      });
  };

  const setOpen = (slot: Slot, next: boolean) => {
    if (slot.visible === next) return;
    slot.visible = next;
    if (next) {
      ensure(slot);
      activate(slot);
    }
    slot.tool?.setVisible(next);
    slot.host.dataset.open = String(next);
    slot.surface.setOpen(next);
    root.dataset.open = String(slots().some((candidate) => candidate.visible));
    if (next && document.pointerLockElement !== null) document.exitPointerLock();
    if (!next && active === slot) {
      active = slots().filter((candidate) => candidate.visible)
        .sort((left, right) => Number(right.host.style.zIndex) - Number(left.host.style.zIndex))[0] ?? null;
      active?.surface.raise();
      for (const candidate of slots()) candidate.tool?.setActive?.(candidate === active);
    }
    nonActivating.releaseKeyboard();
  };

  const toggle = (slot: Slot) => slot.visible ? requestClose(slot) : setOpen(slot, true);
  for (const slot of slots()) {
    slot.host.addEventListener("pointerdown", () => {
      if (slot.visible) activate(slot);
    }, true);
  }

  const onToggleChord = (event: KeyboardEvent) => {
    if (
      !availability.builds
      || event.code !== TOGGLE_CODE
      || !event.ctrlKey
      || !event.shiftKey
      || event.altKey
      || event.metaKey
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle(builds);
  };
  const onBuildsCommand = (event: Event) => {
    if (!availability.builds) return;
    event.preventDefault();
    toggle(builds);
  };
  const onTradeCommand = (event: Event) => {
    if (!trade || !availability.trade) return;
    event.preventDefault();
    toggle(trade);
  };

  const stopAtOverlay = (event: Event) => event.stopPropagation();
  for (const name of [
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove",
    "mousedown", "mouseup", "mousemove", "click", "wheel", "contextmenu",
  ]) root.addEventListener(name, stopAtOverlay);

  const mirrorCursor = () => { root.style.cursor = canvas.style.cursor; };
  const cursorMirror = new MutationObserver(mirrorCursor);
  cursorMirror.observe(canvas, { attributes: true, attributeFilter: ["style"] });
  mirrorCursor();
  window.addEventListener("gw:tools-toggle", onBuildsCommand);
  window.addEventListener("gw:trade-toggle", onTradeCommand);
  window.addEventListener("keydown", onToggleChord, true);

  return {
    update(next: ToolboxState) {
      state = next;
      builds.tool?.update(next);
    },
    setAvailable(next: ToolboxAvailability) {
      availability = next;
      if (!next.builds) setOpen(builds, false);
      if (trade && !next.trade) setOpen(trade, false);
    },
    get state() { return state; },
    dispose() {
      disposed = true;
      for (const slot of slots()) {
        slot.tool?.dispose();
        slot.surface.dispose();
      }
      nonActivating.dispose();
      cursorMirror.disconnect();
      window.removeEventListener("gw:tools-toggle", onBuildsCommand);
      window.removeEventListener("gw:trade-toggle", onTradeCommand);
      window.removeEventListener("keydown", onToggleChord, true);
      window.dispatchEvent(new CustomEvent("gw:input-reset"));
      if (root.contains(document.activeElement)) canvas.focus({ preventScroll: true });
      style.remove();
      root.remove();
    },
  };
}

export function createToolboxLifecycle(
  parent: HTMLElement,
  options: FoundationOptions,
) {
  let foundation: ReturnType<typeof createToolboxFoundation> | null = null;
  let state: ToolboxState = Object.freeze({ status: "waiting" });
  let availability: ToolboxAvailability = { builds: true, trade: true };
  let disposed = false;
  return {
    setEnabled(enabled: boolean) {
      if (disposed) return;
      if (enabled) {
        if (foundation) return;
        foundation = createToolboxFoundation(parent, options);
        foundation.update(state);
        foundation.setAvailable(availability);
      } else {
        foundation?.dispose();
        foundation = null;
      }
    },
    update(next: ToolboxState) {
      state = next;
      foundation?.update(next);
    },
    setAvailable(next: ToolboxAvailability) {
      availability = next;
      foundation?.setAvailable(next);
    },
    get state() { return foundation?.state ?? null; },
    dispose() {
      if (disposed) return;
      disposed = true;
      foundation?.dispose();
      foundation = null;
    },
  };
}

function makeHost(document: Document, id: string, role: string): HTMLElement {
  const element = document.createElement("div");
  element.id = id;
  element.dataset.role = role;
  return element;
}
