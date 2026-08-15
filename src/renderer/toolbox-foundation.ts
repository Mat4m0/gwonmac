/**
 * The Tools overlay: the layer a tool draws on above the game canvas.
 *
 * The overlay owns the boundary and nothing else — the toggle commands, the
 * event stops, pointer-lock release, the cursor mirror, focus transfer and
 * teardown.
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
 * only what the tool draws is interactive, so the game keeps owning every
 * click that is not on Tools chrome.
 */
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
`;

const TOGGLE_CODE = "Space";

/**
 * A tool mounted into the overlay. It draws its own window; the overlay tells
 * it when it is meant to be on screen and tears it down at the end.
 */
export interface MountedTool {
  setVisible(visible: boolean): void;
  /** Ask the tool to close so it can protect any unsaved authoring work. */
  requestClose(): void;
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
     * control — says so. Without it the overlay goes on believing it is open
     * and the next toggle closes an already-hidden tool instead of reopening it.
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

  // Where the tool draws: a full-bleed layer inside the overlay root. A tool
  // brings its own window and positions it against the viewport, so it is given
  // the viewport rather than a box to escape from. Being inside the root is
  // what matters — that is where the event stops and the cursor mirror live, so
  // a tool needs no second boundary of its own.
  const toolHost = document.createElement("div");
  toolHost.id = "toolbox-tool";
  toolHost.dataset.role = "tool";
  root.append(toolHost);
  parent.append(style, root);

  // Everything the tool draws is non-activating. Clicking it operates the
  // control without taking the keyboard, so the game keeps receiving keys
  // until the player clicks into something they can actually type in.
  const surface = createNonActivatingSurface(root, () => canvas);

  let tool: MountedTool | null = null;
  let toolRequested = false;
  let disposed = false;
  const ensureTool = () => {
    if (toolRequested) return;
    toolRequested = true;
    // The tool reports its own visibility back, which is how its close control
    // reaches the overlay. Echoes of the overlay's own `setVisible` come back
    // through here too and stop at `setOpen`'s no-change guard.
    void options.mountTool(toolHost, (visible) => setOpen(visible))
      .then((mounted) => {
        if (disposed) {
          mounted?.dispose();
          return;
        }
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

  const requestClose = () => {
    if (!overlayOpen) return;
    if (tool) tool.requestClose();
    else setOpen(false);
  };
  const dismissable = window.gwSurfaces.register({
    root,
    priority: 4,
    dismiss: requestClose,
  });

  const releaseGameInput = () => {
    window.dispatchEvent(new CustomEvent("gw:input-reset"));
  };

  const setOpen = (next: boolean) => {
    if (next === overlayOpen) return;
    overlayOpen = next;
    if (next) ensureTool();
    tool?.setVisible(next);
    root.dataset.open = String(next);
    dismissable.setOpen(next);
    // Pointer lock still has to go: the tool is unreachable by a captured
    // cursor. The keyboard, though, stays with the game — opening Tools is not
    // a statement that you have stopped playing.
    if (next && document.pointerLockElement !== null) document.exitPointerLock();
    // A menu command can arrive while another renderer-owned control has focus.
    // Say where the keyboard goes rather than assuming it stayed.
    surface.releaseKeyboard();
  };

  const toggleOpen = () => {
    if (overlayOpen) requestClose();
    else setOpen(true);
  };

  // The global chord toggles Tools. The shared surface controller separately
  // owns Escape and keyboard entry for whichever GWonMac surface is topmost.
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
    toggleOpen();
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
    toggleOpen();
  };
  window.addEventListener("gw:tools-toggle", onCommand);
  window.addEventListener("keydown", onToggleChord, true);

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
      disposed = true;
      tool?.dispose();
      tool = null;
      dismissable.dispose();
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

/**
 * Owns the optional lifetime around one toolbox foundation.
 *
 * Both certified and host-only sessions can change their Tools setting while
 * the renderer stays alive. Keeping that transition here makes disabling mean
 * the same thing in both paths: the DOM, command listener, chord, and mounted
 * tool all disappear together. The latest observation is retained so a later
 * re-enable starts current rather than waiting for the next game poll.
 */
export function createToolboxLifecycle(
  parent: HTMLElement,
  options: Parameters<typeof createToolboxFoundation>[1],
) {
  let foundation: ReturnType<typeof createToolboxFoundation> | null = null;
  let state: ToolboxState = Object.freeze({ status: "waiting" });
  let disposed = false;

  return {
    setEnabled(enabled: boolean) {
      if (disposed) return;
      if (enabled) {
        if (foundation !== null) return;
        foundation = createToolboxFoundation(parent, options);
        foundation.update(state);
        return;
      }
      foundation?.dispose();
      foundation = null;
    },
    update(next: ToolboxState) {
      state = next;
      foundation?.update(next);
    },
    get state() {
      return foundation?.state ?? null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      foundation?.dispose();
      foundation = null;
    },
  };
}
