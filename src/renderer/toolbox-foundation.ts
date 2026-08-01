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
  cursor: default;
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
  cursor: default;
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

export function createToolboxFoundation(parent: HTMLElement) {
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
  // A palette, not a modal: the game stays interactive beside it, so no
  // aria-modal and no focus trap. tabindex puts keyboard focus on the panel
  // itself when a click lands on non-interactive panel area.
  panel.setAttribute("role", "dialog");
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
  root.append(hud, panel);
  parent.append(style, root);

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
    releaseGameInput();
    overlayOpen = next;
    panel.hidden = !next;
    panel.style.display = next ? "grid" : "none";
    hud.hidden = next;
    hud.style.display = next ? "none" : "flex";
    open.setAttribute("aria-expanded", String(next));
    root.dataset.open = String(next);
    if (next) {
      if (document.pointerLockElement !== null) document.exitPointerLock();
      placePanel();
      panel.focus({ preventScroll: true });
    } else {
      canvas.focus({ preventScroll: true });
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

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOpen(false);
  });

  // Focus follows click. Entering the overlay releases held game input so a
  // key held while clicking into the panel cannot keep the character moving.
  root.addEventListener("focusin", (event) => {
    const from = event.relatedTarget;
    if (from instanceof Node && root.contains(from)) return;
    releaseGameInput();
  });
  panel.addEventListener("pointerdown", () => {
    if (!root.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
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
