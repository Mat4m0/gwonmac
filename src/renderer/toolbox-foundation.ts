/**
 * The Tools overlay: the HUD chip, and the layer a tool draws on above the game
 * canvas.
 *
 * The overlay owns the boundary and nothing else — the toggle chord, the event
 * stops, pointer-lock release, the cursor mirror, focus transfer and teardown.
 * It draws no panel of its own. It used to: three rows of companion state, with
 * their own titlebar, drag and placement, kept beside the mounted tool and
 * permanently hidden whenever one was mounted. Two panels arguing over one
 * corner of the screen is not an interface, and the one nobody could see was
 * still being written to on every companion poll.
 *
 * There is deliberately no widget registry, plugin surface or layout engine
 * here. One tool mounts, it brings its own window, and a second tool can
 * introduce a layout when it exists and needs one.
 *
 * The overlay is chrome, so it owns only its own pixels: every click that is
 * not on Tools chrome still belongs to the game.
 */
import { createNonActivatingSurface } from "./non-activating-surface.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";

/**
 * The companion's toolbox projection, as `window.gwCompanionRuntime.toolbox`
 * publishes it. The overlay draws none of it — it holds the latest one and
 * hands it to the mounted tool, which is the only thing here that draws.
 *
 * The shared domain owns this projection. This overlay is only its courier.
 */
type ToolboxState = ToolboxObservation;

/**
 * Non-modal palette styling. The overlay root never intercepts the pointer;
 * only the HUD chip and whatever the tool draws are interactive surfaces, so
 * the game keeps owning every click that is not on Tools chrome. Hover/focus
 * states need real selectors, hence a stylesheet instead of per-element cssText.
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
}
/*
 * Scoped to the chip, not to the root. A bare "#toolbox-foundation button" is
 * specificity (1,0,1) and the tool mounts in light DOM inside this root, so it
 * outranked ".ui-button" (0,1,0) and dressed every button in the Tools window
 * in the overlay's chip skin -- including "cursor: inherit", over a design
 * system that deliberately says otherwise. The overlay draws one button; it
 * should style one button.
 */
#toolbox-foundation [data-role="hud"] button {
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
#toolbox-foundation [data-role="hud"] button:hover {
  background: #2a2823;
  border-color: #6b6557;
}
#toolbox-foundation [data-role="hud"] button:active { background: #161512; }
#toolbox-foundation [data-role="hud"] button:focus-visible {
  outline: 1px solid #c8aa6e;
  outline-offset: 1px;
}
#toolbox-foundation [data-role="hud"] {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  pointer-events: auto;
  /* On the chip only: inherited from the root it would forbid selecting a
     build name or a template code inside the tool, which owns that decision. */
  user-select: none;
  -webkit-user-select: none;
  background: rgba(10, 10, 12, 0.82);
  border: 1px solid #3c3a34;
  border-radius: 3px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
}
@media (prefers-reduced-motion: reduce) {
  #toolbox-foundation [data-role="hud"] button { transition: none; }
}
`;

const TOGGLE_CODE = "Space";

/**
 * A tool mounted into the overlay. It draws its own window; the overlay tells
 * it when it is meant to be on screen and tears it down at the end.
 */
export interface MountedTool {
  setVisible(visible: boolean): void;
  /**
   * The companion's latest projection of the running game.
   *
   * Push, not pull: the overlay is already on the observer's update path, and a
   * tool that polled instead would be a second reader of the same region on a
   * cadence nobody chose. Called on mount with whatever has arrived so far, so
   * a tool loaded after the game was already running does not start blank.
   */
  update(state: ToolboxState): void;
  dispose(): void;
}

export function createToolboxFoundation(
  parent: HTMLElement,
  options: {
    /**
     * Loads the tool into the overlay, on the first open rather than at
     * install: a player who never opens Tools never pays for the bundle.
     *
     * Required. The overlay has nothing to show without it, and an overlay
     * that could be built without a tool is a configuration nothing ships and
     * every test would then be free to certify.
     *
     * `onVisibilityChange` is how a tool that hides itself — its own close
     * control — says so. Without it the overlay goes on believing it is open,
     * which keeps the HUD chip hidden and spends the next toggle restoring the
     * chip rather than reopening the tool.
     */
    mountTool: (
      host: HTMLElement,
      onVisibilityChange: (visible: boolean) => void,
    ) => Promise<MountedTool | null>;
  },
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

  const hud = document.createElement("div");
  hud.dataset.role = "hud";
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Tools";
  open.title = "Open Tools (Command+B)";
  open.setAttribute("aria-label", "Open Tools");
  open.setAttribute("aria-controls", "toolbox-tool");
  open.setAttribute("aria-expanded", "false");
  hud.append(open);

  // Where the tool draws: a full-bleed layer inside the overlay root. A tool
  // brings its own window and positions it against the viewport, so it is given
  // the viewport rather than a box to escape from. Being inside the root is
  // what matters — that is where the event stops and the cursor mirror live, so
  // a tool needs no second boundary of its own.
  const toolHost = document.createElement("div");
  toolHost.id = "toolbox-tool";
  toolHost.dataset.role = "tool";
  root.append(hud, toolHost);
  parent.append(style, root);

  // Everything the overlay draws is non-activating: the HUD chip and whatever
  // the tool mounts inside it. Clicking any of it operates the control without
  // taking the keyboard, so the game keeps receiving keys until the player
  // clicks into something they can actually type in.
  const surface = createNonActivatingSurface(root, () => canvas);

  let tool: MountedTool | null = null;
  let toolRequested = false;
  const ensureTool = () => {
    if (toolRequested) return;
    toolRequested = true;
    // The tool reports its own visibility back, which is how its close control
    // reaches the overlay. Echoes of the overlay's own `setVisible` come back
    // through here too and stop at `setOpen`'s no-change guard.
    void options.mountTool(toolHost, (visible) => setOpen(visible))
      .then((mounted) => {
        tool = mounted;
        // The overlay may have been closed again while the bundle loaded, and
        // the companion has almost certainly published since — the tool loads
        // on first open, which is minutes into a session. Both are caught up
        // here rather than waiting for the next toggle and the next publish.
        tool?.setVisible(overlayOpen);
        tool?.update(state);
      });
  };

  let state: ToolboxState = Object.freeze({ status: "waiting" });
  let overlayOpen = false;

  const releaseGameInput = () => {
    window.dispatchEvent(new CustomEvent("gw:input-reset"));
  };

  const setOpen = (next: boolean) => {
    if (next === overlayOpen) return;
    overlayOpen = next;
    if (next) ensureTool();
    tool?.setVisible(next);
    hud.hidden = next;
    hud.style.display = next ? "none" : "flex";
    open.setAttribute("aria-expanded", String(next));
    root.dataset.open = String(next);
    // Pointer lock still has to go: the tool is unreachable by a captured
    // cursor. The keyboard, though, stays with the game — opening Tools is not
    // a statement that you have stopped playing.
    if (next && document.pointerLockElement !== null) document.exitPointerLock();
    // Opening hides the HUD chip, so the button that was just pressed leaves
    // the document and takes focus with it. Say where the keyboard goes rather
    // than assuming it stayed.
    surface.releaseKeyboard();
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
  // which is to say only while the player is typing in the tool. There it means
  // what it means in any field — stop typing — and hands the game back rather
  // than closing anything. With the game focused it never fires, so Escape
  // keeps meaning what Guild Wars says it means.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    surface.releaseKeyboard();
  });

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

  // The menu's accelerator arrives here as a command, already taken by the main
  // process before the renderer -- and so before the game -- could see the key
  // at all. Answering it is what tells `commands.ts` the capability is
  // installed: the event is cancelable, and cancelling it is this overlay
  // saying "handled". The chord below stays as the keyboard-only route for a
  // build with no menu.
  const onCommand = (event: Event) => {
    event.preventDefault();
    setOpen(!overlayOpen);
  };
  window.addEventListener("gw:tools-toggle", onCommand);
  window.addEventListener("keydown", onToggleChord, true);
  open.addEventListener("click", () => setOpen(true));

  return {
    /**
     * The companion's latest toolbox projection, from the observer.
     *
     * Held as well as forwarded: the tool mounts on first open, long after the
     * game starts publishing, and `ensureTool` replays this into it. Without
     * that the panel would show nothing until the party next changed.
     */
    update(next: ToolboxState) {
      state = next;
      tool?.update(next);
    },
    get state() {
      return state;
    },
    dispose() {
      tool?.dispose();
      surface.dispose();
      cursorMirror.disconnect();
      window.removeEventListener("gw:tools-toggle", onCommand);
      window.removeEventListener("keydown", onToggleChord, true);
      releaseGameInput();
      if (root.contains(document.activeElement)) {
        canvas.focus({ preventScroll: true });
      }
      style.remove();
      root.remove();
    },
  };
}
