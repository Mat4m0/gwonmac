/**
 * The Tools overlay: the HUD chip and the panel behind it, drawn above the game
 * canvas.
 *
 * It renders the state it is handed and asks the game for nothing. There is
 * deliberately no widget registry, plugin surface or layout engine behind it —
 * a second tool can introduce one when it exists and needs it.
 *
 * The overlay is chrome, so it owns only its own pixels: every click that is
 * not on Tools chrome still belongs to the game.
 */
import { createNonActivatingSurface } from "./non-activating-surface.js";

type ToolboxState = Readonly<{
  status: string;
  playerChatCount?: number;
  heroAvailable?: boolean;
  heroCount?: number;
  firstHeroId?: number;
  panelState?: number;
}>;

/**
 * Non-modal palette styling. The overlay root never intercepts the pointer;
 * only the HUD chip and the panel are interactive surfaces, so the game keeps
 * owning every click that is not on Tools chrome. Hover/focus states need real
 * selectors, hence a stylesheet instead of per-element cssText.
 */
const OVERLAY_CSS = `
#toolbox-foundation {
  position: fixed;
  inset: 0;
  z-index: 4;
  display: grid;
  align-content: end;
  justify-items: end;
  padding: 18px;
  box-sizing: border-box;
  pointer-events: none;
  color: #e8e4d8;
  font: 12px/1.45 -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  user-select: none;
  -webkit-user-select: none;
}
#toolbox-foundation .toolbox-surface {
  background: rgba(10, 10, 12, 0.82);
  border: 1px solid #3c3a34;
  border-radius: 3px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
}
#toolbox-foundation button {
  pointer-events: auto;
  padding: 4px 10px;
  border: 1px solid #524e44;
  border-radius: 2px;
  background: #1d1c19;
  color: inherit;
  font: inherit;
  cursor: inherit;
  transition: background-color 80ms linear, border-color 80ms linear;
}
#toolbox-foundation button:hover {
  background: #2a2823;
  border-color: #6b6557;
}
#toolbox-foundation button:active { background: #161512; }
#toolbox-foundation button:focus-visible {
  outline: 1px solid #c8aa6e;
  outline-offset: 1px;
}
#toolbox-foundation [data-role="hud"] {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 10px;
  pointer-events: auto;
}
#toolbox-foundation-panel {
  position: fixed;
  min-width: 280px;
  display: grid;
  gap: 6px;
  padding: 10px;
  pointer-events: auto;
  outline: none;
}
#toolbox-foundation-panel [data-role="titlebar"] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -10px -10px 4px;
  padding: 8px 10px;
  border-bottom: 1px solid #2c2a25;
  touch-action: none;
}
#toolbox-foundation-panel strong {
  color: #c8aa6e;
  font-weight: 600;
  letter-spacing: 0.02em;
}
@media (prefers-reduced-motion: reduce) {
  #toolbox-foundation button { transition: none; }
}
`;

const PANEL_NAMES = ["unknown", "hidden", "shown"] as const;
const TOGGLE_CODE = "Space";
const VIEWPORT_MARGIN = 8;

/**
 * Where the user last put the panel. Module state so the position survives
 * teardown/reinstall inside one renderer session; a reload starts fresh.
 * Persisting it is a deliberate non-goal for the developer foundation —
 * renderer storage is policy-banned and the settings channel should only
 * grow keys for product features.
 */
let panelPosition: { left: number; top: number } | null = null;

/**
 * A tool mounted into the overlay. It draws its own window; the overlay tells
 * it when it is meant to be on screen and tears it down at the end.
 */
export interface MountedTool {
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createToolboxFoundation(
  parent: HTMLElement,
  options: {
    /** Loads a tool into the overlay. Called the first time Tools is opened. */
    mountTool?: (host: HTMLElement) => Promise<MountedTool | null>;
  } = {},
) {
  // A tool replaces the built-in readout rather than sitting under it. Those
  // three rows are the foundation's own developer example, and two panels
  // arguing over one corner of the screen is not an interface.
  const usesTool = options.mountTool !== undefined;
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
  root.setAttribute("aria-label", "Tools foundation developer example");

  const hud = document.createElement("div");
  hud.className = "toolbox-surface";
  hud.dataset.role = "hud";
  const summary = document.createElement("span");
  summary.setAttribute("aria-live", "off");
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Tools";
  open.title = "Open Tools (Control+Shift+Space)";
  open.setAttribute("aria-label", "Open Tools");
  open.setAttribute("aria-controls", "toolbox-foundation-panel");
  open.setAttribute("aria-expanded", "false");
  hud.append(summary, open);

  const panel = document.createElement("div");
  panel.id = "toolbox-foundation-panel";
  panel.className = "toolbox-surface";
  panel.hidden = true;
  panel.style.display = "none";
  // A palette, not a modal, and not a dialog either: a dialog is a surface
  // focus moves into, and this one deliberately never takes the keyboard on
  // its own. Tab from the canvas reaches its controls in document order, which
  // is the ordinary way in and needs no affordance of its own.
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", "toolbox-foundation-title");
  panel.tabIndex = -1;

  const titlebar = document.createElement("div");
  titlebar.dataset.role = "titlebar";
  const title = document.createElement("strong");
  title.id = "toolbox-foundation-title";
  title.textContent = "Tools";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close Tools");
  titlebar.append(title, close);

  const chat = document.createElement("div");
  const hero = document.createElement("div");
  const panelRow = document.createElement("div");
  panel.append(titlebar, chat, hero, panelRow);

  // Where a tool draws: a full-bleed layer inside the overlay root, beside the
  // palette rather than inside it. A tool brings its own window and positions
  // it against the viewport, so nesting it in a 280px dialog would give it a
  // container it immediately escapes. Being inside the root is what matters —
  // that is where the event stops and the cursor mirror live, so a tool needs
  // no second boundary of its own.
  const toolHost = document.createElement("div");
  toolHost.dataset.role = "tool";
  root.append(hud, panel, toolHost);
  parent.append(style, root);

  // Everything the overlay draws is non-activating: the HUD chip, the panel,
  // and whatever a tool mounts inside it. Clicking any of it operates the
  // control without taking the keyboard, so the game keeps receiving keys
  // until the player clicks into something they can actually type in.
  const surface = createNonActivatingSurface(root, () => canvas);

  let tool: MountedTool | null = null;
  let toolRequested = false;
  const ensureTool = () => {
    if (toolRequested || options.mountTool === undefined) return;
    toolRequested = true;
    void options.mountTool(toolHost).then((mounted) => {
      tool = mounted;
      // The overlay may have been closed again while the bundle loaded.
      tool?.setVisible(overlayOpen);
    });
  };

  let state: ToolboxState = Object.freeze({ status: "waiting" });
  let overlayOpen = false;

  const releaseGameInput = () => {
    window.dispatchEvent(new CustomEvent("gw:input-reset"));
  };

  const clampPosition = (left: number, top: number) => {
    const rect = panel.getBoundingClientRect();
    return {
      left: Math.min(
        Math.max(left, VIEWPORT_MARGIN),
        Math.max(window.innerWidth - rect.width - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
      ),
      top: Math.min(
        Math.max(top, VIEWPORT_MARGIN),
        Math.max(window.innerHeight - rect.height - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
      ),
    };
  };

  const placePanel = () => {
    const rect = panel.getBoundingClientRect();
    const wanted = panelPosition ?? {
      left: window.innerWidth - rect.width - 18,
      top: window.innerHeight - rect.height - 58,
    };
    const placed = clampPosition(wanted.left, wanted.top);
    panel.style.left = `${placed.left}px`;
    panel.style.top = `${placed.top}px`;
  };

  const setOpen = (next: boolean) => {
    if (next === overlayOpen) return;
    overlayOpen = next;
    // The tool's bundle is worth loading when someone asks to see it, and not
    // before: a player who never opens Tools never pays for it.
    if (next) ensureTool();
    tool?.setVisible(next);
    const showPanel = next && !usesTool;
    panel.hidden = !showPanel;
    panel.style.display = showPanel ? "grid" : "none";
    hud.hidden = next;
    hud.style.display = next ? "none" : "flex";
    open.setAttribute("aria-expanded", String(next));
    root.dataset.open = String(next);
    if (next) {
      // Pointer lock still has to go: the panel is unreachable by a captured
      // cursor. The keyboard, though, stays with the game — opening Tools is
      // not a statement that you have stopped playing.
      if (document.pointerLockElement !== null) document.exitPointerLock();
      placePanel();
      // Opening hides the HUD chip, so the button that was just pressed leaves
      // the document and takes focus with it. Say where the keyboard goes
      // rather than assuming it stayed.
      surface.releaseKeyboard();
    } else {
      surface.releaseKeyboard();
    }
  };

  // The global chord is the only key the overlay claims from game focus.
  // Escape is handled inside the overlay boundary below, so with the game
  // focused it keeps meaning what Guild Wars says it means.
  const onToggleChord = (event: KeyboardEvent) => {
    const toggles =
      event.code === TOGGLE_CODE &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey;
    if (!toggles) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(!overlayOpen);
  };

  // Events from Tools chrome stop at this renderer-owned boundary. The game's
  // window/document listeners continue to own every event outside it, and
  // pointer capture during a drag keeps even fast drags inside the boundary.
  const stopAtOverlay = (event: Event) => event.stopPropagation();
  for (const name of [
    "keydown",
    "keyup",
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "mousemove",
    "click",
    "wheel",
    "contextmenu",
  ]) {
    root.addEventListener(name, stopAtOverlay);
  }

  // Escape reaches this listener only while the surface holds the keyboard,
  // which is to say only while the player is typing in it. There it means what
  // it means in any field — stop typing — and hands the game back rather than
  // closing the panel. With the game focused it never fires, so Escape keeps
  // meaning what Guild Wars says it means.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    surface.releaseKeyboard();
  });

  let dragOffset: { x: number; y: number } | null = null;
  titlebar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Node && close.contains(event.target)) return;
    const rect = panel.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    titlebar.setPointerCapture(event.pointerId);
  });
  titlebar.addEventListener("pointermove", (event) => {
    if (!dragOffset) return;
    const placed = clampPosition(
      event.clientX - dragOffset.x,
      event.clientY - dragOffset.y,
    );
    panel.style.left = `${placed.left}px`;
    panel.style.top = `${placed.top}px`;
    panelPosition = placed;
  });
  const endDrag = () => {
    dragOffset = null;
  };
  titlebar.addEventListener("pointerup", endDrag);
  titlebar.addEventListener("pointercancel", endDrag);

  const onResize = () => {
    if (overlayOpen) placePanel();
  };

  // The native Guild Wars cursor is published as the canvas's style cursor.
  // Mirror it so the game cursor stays the cursor over Tools chrome too;
  // with the native cursor off the mirrored value is empty and the system
  // arrow shows.
  const mirrorCursor = () => {
    root.style.cursor = canvas.style.cursor;
  };
  const cursorMirror = new MutationObserver(mirrorCursor);
  cursorMirror.observe(canvas, {
    attributes: true,
    attributeFilter: ["style"],
  });
  mirrorCursor();

  window.addEventListener("keydown", onToggleChord, true);
  window.addEventListener("resize", onResize);
  open.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));

  return {
    update(next: ToolboxState) {
      state = next;
      if (next.status !== "ready") {
        summary.textContent = "Player chat events · waiting";
        chat.textContent = "Player chat events · waiting";
        hero.textContent = "First owned hero · waiting";
        panelRow.textContent = "Hero panel · waiting";
        return;
      }
      const chatCount = next.playerChatCount ?? 0;
      summary.textContent = `Player chat events · ${chatCount}`;
      chat.textContent = `Player chat events · ${chatCount}`;
      hero.textContent = next.heroAvailable
        ? `First owned hero · ${next.firstHeroId} (${next.heroCount} owned)`
        : "First owned hero · unavailable";
      panelRow.textContent = `Hero panel observed · ${PANEL_NAMES[next.panelState ?? 0] ?? "unknown"}`;
    },
    get state() {
      return state;
    },
    dispose() {
      tool?.dispose();
      surface.dispose();
      cursorMirror.disconnect();
      window.removeEventListener("keydown", onToggleChord, true);
      window.removeEventListener("resize", onResize);
      releaseGameInput();
      if (root.contains(document.activeElement)) {
        canvas.focus({ preventScroll: true });
      }
      style.remove();
      root.remove();
    },
  };
}
