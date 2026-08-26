/**
 * Tells the client which presses are double-clicks, using its own flag.
 *
 * The served module carries one exported mutable global (see
 * `src/main/certification/native-double-click.ts`). Its mousedown callback
 * copies that global into the input record's flag word, the translator carries
 * the word into the press message, and `FrMouse` masks bit 0 out of it as
 * `FLAG_DBL_CLICK`. All of that is the client's; the only thing missing was
 * something to write the global, and that is this file.
 *
 * It decides nothing about what a double-click is. Chromium's `detail` already
 * counts a click run under the player's own macOS double-click speed and
 * distance preferences, and Windows raises `WM_LBUTTONDBLCLK` on every even
 * click of a run — so every even count sets the flag and every other press
 * clears it.
 *
 * The write is unconditional on every trusted press, including the ones that
 * are not double-clicks and the ones on other buttons. That is what keeps it
 * stateless: the client reads the global exactly once per press, so a press
 * that failed to reach the client cannot leave a set flag behind for the next
 * one.
 */

/** A `WebAssembly.Global` is all this needs, narrowed to what it writes. */
type FlagGlobal = { value: number };

type NativeDoubleClickOptions = {
  /**
   * The exported flag, or null when the served module does not carry it —
   * an unrecognised client build, which the certification chain serves
   * untransformed. There is no fallback: the client simply has no
   * double-click until its build is certified again.
   */
  flag: () => FlagGlobal | null;
  trace?: InputTrace;
  log(...values: unknown[]): void;
};

export const nativeDoubleClickFlagForPress = (event: Pick<MouseEvent,
  "button" | "detail" | "isTrusted"
>): 0 | 1 | null => {
  if (!event.isTrusted) return null;
  return event.button === 0 && event.detail % 2 === 0 ? 1 : 0;
};

export function applyNativeDoubleClickPress(
  event: Pick<MouseEvent, 'isTrusted' | 'button' | 'detail'>,
  global: FlagGlobal | null,
): boolean {
  const value = nativeDoubleClickFlagForPress(event);
  if (value === null) return false;
  if (global) global.value = value;
  return true;
}

export const installNativeDoubleClick = ({
  flag,
  trace,
  log,
}: NativeDoubleClickOptions): void => {
  // Capture phase on the window, so this runs before the listener the client's
  // glue registers on the canvas and the flag is already in place when the
  // callback reads it. Registered here rather than on the canvas for the same
  // reason: capture descends from the root, so an ancestor always precedes it.
  window.addEventListener('mousedown', (event) => {
    const global = flag();
    const doubleClick = event.button === 0 && event.detail % 2 === 0;
    if (!applyNativeDoubleClickPress(event, global)) return;
    // Recorded even when there is nothing to write to. A double-click that
    // the client cannot be told about is the report worth having, and the
    // absent row would otherwise look like the press never happened.
    if (doubleClick) {
      trace?.record({
        source: 'renderer',
        kind: 'double-click',
        delivered: global !== null,
      });
    }
  }, true);
  log('native double-click: enabled');
};
