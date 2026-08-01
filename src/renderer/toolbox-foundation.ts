type ToolboxState = Readonly<{
  status: string;
  playerChatCount?: number;
  heroAvailable?: boolean;
  heroCount?: number;
  firstHeroId?: number;
  panelState?: number;
}>;

const ROOT_STYLE = [
  "position:fixed",
  "inset:0",
  "z-index:4",
  "display:grid",
  "align-content:end",
  "justify-items:end",
  "gap:8px",
  "padding:18px",
  "box-sizing:border-box",
  "color:#f0ece2",
  "font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
  "user-select:none",
  "pointer-events:none",
].join(";");

const SURFACE_STYLE = [
  "border:1px solid #59554b",
  "border-radius:4px",
  "background:#11100ee8",
  "box-shadow:0 8px 24px #0008",
].join(";");

const BUTTON_STYLE = [
  "padding:5px 10px",
  "border:1px solid #6b665b",
  "border-radius:3px",
  "color:inherit",
  "background:#292720",
  "font:inherit",
  "cursor:pointer",
].join(";");

const PANEL_NAMES = ["unknown", "hidden", "shown"] as const;
const TOGGLE_CODE = "Space";

export function createToolboxFoundation(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const canvas = document.getElementById("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Toolbox game canvas is missing");
  }

  const root = document.createElement("section");
  root.id = "toolbox-foundation";
  root.setAttribute("aria-label", "Toolbox foundation developer example");
  root.style.cssText = ROOT_STYLE;

  const hud = document.createElement("div");
  hud.style.cssText = `${SURFACE_STYLE};display:flex;align-items:center;gap:10px;padding:8px 10px`;
  const summary = document.createElement("span");
  summary.setAttribute("aria-live", "off");
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Open Toolbox";
  open.title = "Open Toolbox (Control+Shift+Space)";
  open.setAttribute("aria-controls", "toolbox-foundation-panel");
  open.setAttribute("aria-expanded", "false");
  open.style.cssText = `${BUTTON_STYLE};pointer-events:auto`;
  hud.append(summary, open);

  const dialog = document.createElement("div");
  dialog.id = "toolbox-foundation-panel";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "toolbox-foundation-title");
  dialog.style.cssText = [
    SURFACE_STYLE,
    "display:grid",
    "gap:8px",
    "min-width:260px",
    "padding:12px",
    "pointer-events:auto",
  ].join(";");
  dialog.style.display = "none";

  const heading = document.createElement("div");
  heading.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;gap:12px";
  const title = document.createElement("strong");
  title.id = "toolbox-foundation-title";
  title.textContent = "Toolbox";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close Toolbox");
  close.style.cssText = BUTTON_STYLE;
  heading.append(title, close);

  const chat = document.createElement("div");
  const hero = document.createElement("div");
  const panel = document.createElement("div");
  dialog.append(heading, chat, hero, panel);
  root.append(hud, dialog);
  parent.append(root);

  let state: ToolboxState = Object.freeze({ status: "waiting" });
  let overlayOpen = false;

  const releaseGameInput = () => {
    window.dispatchEvent(new CustomEvent("gw:input-reset"));
  };

  const setOpen = (next: boolean) => {
    if (next === overlayOpen) return;
    releaseGameInput();
    overlayOpen = next;
    dialog.hidden = !next;
    hud.hidden = next;
    dialog.style.display = next ? "grid" : "none";
    hud.style.display = next ? "none" : "flex";
    root.style.pointerEvents = next ? "auto" : "none";
    open.setAttribute("aria-expanded", String(next));
    root.dataset.open = String(next);
    if (next) {
      if (document.pointerLockElement !== null) document.exitPointerLock();
      close.focus({ preventScroll: true });
    } else {
      canvas.focus({ preventScroll: true });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const toggles =
      event.code === TOGGLE_CODE &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey;
    if (!toggles && !(overlayOpen && event.key === "Escape")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(toggles ? !overlayOpen : false);
  };

  const trapOverlayFocus = (event: KeyboardEvent) => {
    if (!overlayOpen || event.key !== "Tab") return;
    event.preventDefault();
    const controls = [close];
    const current = controls.findIndex(
      (control) => control === document.activeElement,
    );
    const offset = event.shiftKey ? -1 : 1;
    const next = (current + offset + controls.length) % controls.length;
    controls[next]?.focus({ preventScroll: true });
  };

  const containOverlayFocus = (event: FocusEvent) => {
    if (
      !overlayOpen
      || !(event.target instanceof Node)
      || root.contains(event.target)
    ) {
      return;
    }
    close.focus({ preventScroll: true });
  };

  // Events from controls stop at this renderer-owned boundary. The game's
  // canvas listeners continue to own every event outside it.
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
  root.addEventListener("click", (event) => {
    if (overlayOpen && event.target === root) setOpen(false);
  });
  root.addEventListener("keydown", trapOverlayFocus);
  document.addEventListener("focusin", containOverlayFocus, true);
  window.addEventListener("keydown", onKeyDown, true);
  open.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));

  return {
    update(next: ToolboxState) {
      state = next;
      if (next.status !== "ready") {
        summary.textContent = "Player chat events · waiting";
        chat.textContent = "Player chat events · waiting";
        hero.textContent = "First owned hero · waiting";
        panel.textContent = "Hero panel · waiting";
        return;
      }
      const chatCount = next.playerChatCount ?? 0;
      summary.textContent = `Player chat events · ${chatCount}`;
      chat.textContent = `Player chat events · ${chatCount}`;
      hero.textContent = next.heroAvailable
        ? `First owned hero · ${next.firstHeroId} (${next.heroCount} owned)`
        : "First owned hero · unavailable";
      panel.textContent = `Hero panel observed · ${PANEL_NAMES[next.panelState ?? 0] ?? "unknown"}`;
    },
    get state() {
      return state;
    },
    dispose() {
      document.removeEventListener("focusin", containOverlayFocus, true);
      window.removeEventListener("keydown", onKeyDown, true);
      releaseGameInput();
      if (root.contains(document.activeElement)) {
        canvas.focus({ preventScroll: true });
      }
      root.remove();
    },
  };
}
