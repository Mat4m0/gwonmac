/**
 * A surface that can be clicked without taking the keyboard.
 *
 * Native systems separate which window receives keys from which window you are
 * working in: macOS gives utility palettes `becomesKeyOnlyIfNeeded`, Windows
 * has `WS_EX_NOACTIVATE`. Pressing a button in an inspector operates it and
 * leaves your document holding the keyboard; clicking into a text field is what
 * hands it over. Game interfaces follow the same rule — opening a panel does
 * not stop you moving, but clicking into chat does.
 *
 * The rule underneath is that keyboard focus should follow the intent to type,
 * not the click. An overlay that takes focus whenever it is touched reads as a
 * trap: the character stops, and pressing the movement key again does nothing
 * because the keys are going somewhere else.
 *
 * The browser gives us the same hook the native flags do. `preventDefault()` on
 * `mousedown` suppresses the focus change while still letting `click` fire, so
 * a control can be operated without ever becoming the focused element. It is
 * `mousedown` rather than `pointerdown` deliberately: canceling `pointerdown`
 * also suppresses the compatibility mouse events, which would silently break
 * anything mounted inside the surface that listens for `mousedown` itself.
 *
 * What this does *not* do is filter key events. The overlay's own listeners
 * already stop events that originate inside it, and events targeted at the
 * canvas never pass through the overlay at all — so leaving focus where it was
 * is the entire mechanism. Nothing has to guess which keys the game should get.
 */

/**
 * Whether clicking this node should hand over the keyboard.
 *
 * Only text entry qualifies. A button, checkbox, radio or slider is a control
 * you operate, not a place you type, and treating it as focus-worthy is exactly
 * what makes a palette feel like a modal.
 */
function wantsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true']",
  );
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(field.type);
  }
  return true;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export interface NonActivatingSurface {
  /** Whether the keyboard currently belongs to this surface. */
  ownsKeyboard(): boolean;
  /** Hand the keyboard back, if this surface holds it. */
  releaseKeyboard(): void;
  dispose(): void;
}

/**
 * Makes `root` non-activating.
 *
 * `returnFocusTo` is where the keyboard goes when this surface gives it up —
 * the game canvas. It is a callback rather than an element because the caller
 * resolves it lazily and may outlive any one node.
 */
export function createNonActivatingSurface(
  root: HTMLElement,
  returnFocusTo: () => HTMLElement | null,
): NonActivatingSurface {
  const ownsKeyboard = () =>
    root.contains(root.ownerDocument.activeElement);

  const releaseKeyboard = () => {
    if (!ownsKeyboard()) return;
    returnFocusTo()?.focus({ preventScroll: true });
  };

  /**
   * Capture, so the decision is made before anything inside the surface acts on
   * the press — a drag handler that captures the pointer still works, because
   * suppressing focus is not suppressing the pointer.
   */
  const onMouseDown = (event: MouseEvent) => {
    if (wantsKeyboard(event.target)) return;
    // Keep the keyboard where it is. If this surface was holding it, a click on
    // its own chrome is also the natural way to say "I am done typing", so the
    // keyboard goes back to the game rather than staying on a field the player
    // has visibly clicked away from.
    event.preventDefault();
    releaseKeyboard();
  };

  root.addEventListener("mousedown", onMouseDown, true);

  return {
    ownsKeyboard,
    releaseKeyboard,
    dispose() {
      root.removeEventListener("mousedown", onMouseDown, true);
    },
  };
}
