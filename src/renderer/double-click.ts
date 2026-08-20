/**
 * Gives Guild Wars a double-click through its native flag when certified and
 * through its existing double-tap path otherwise.
 *
 * The served module carries one exported mutable global (see
 * `src/main/certification/native-double-click.ts`). Its mousedown callback
 * copies that global into the input record's flag word, the translator carries
 * the word into the press message, and `FrMouse` masks bit 0 out of it as
 * `FLAG_DBL_CLICK`. All of that is the client's; the only thing missing was
 * something to write the global, and that is the primary path in this file.
 *
 * It decides nothing about what a double-click is. Chromium's `detail` already
 * counts a click run under the player's own macOS double-click speed and
 * distance preferences, and Windows raises `WM_LBUTTONDBLCLK` on every even
 * click of a run — so every even count sets the flag and every other press
 * clears it.
 *
 * The native write is unconditional on every trusted press, including presses
 * that are not double-clicks and presses on other buttons. That keeps it
 * stateless. The client reads the global exactly once per press, so a press
 * that failed to reach the client cannot leave a set flag for the next one.
 *
 * An unknown ArenaNet build has no certified flag. For that short patch-day
 * window, the second trusted left press schedules two bounded taps at the same
 * point after its release. Guild Wars already owns that double-tap detector.
 * The fallback does not replace or withhold any mouse event, and it never runs
 * for a single click, another button, another target, or a certified build.
 */

/** A `WebAssembly.Global` is all this owner needs, narrowed to what it writes. */
type FlagGlobal = { value: number };

type TapPoint = Pick<
  MouseEvent,
  'clientX' | 'clientY' | 'pageX' | 'pageY' | 'screenX' | 'screenY'
>;

// Two non-overlapping short taps match the client's existing touch detector.
const TAP_START_DELAYS_MS = [20, 100] as const;
const TAP_HOLD_MS = 30;
const TAP_RADIUS_PX = 5;

type DoubleClickOptions = {
  canvas: HTMLCanvasElement;
  /**
   * The exported flag, or null when the served module does not carry it —
   * an unrecognised client build, which the certification chain serves
   * untransformed and this module supports through bounded taps.
   */
  nativeFlag: () => FlagGlobal | null;
  trace?: InputTrace;
  log(...values: unknown[]): void;
};

export const installDoubleClick = ({
  canvas,
  nativeFlag,
  trace,
  log,
}: DoubleClickOptions): void => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const activeTouches = new Set<Touch>();
  let pendingFallback: TapPoint | null = null;
  let touchId = 0;

  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };

  const sendTouch = (
    type: 'touchstart' | 'touchend' | 'touchcancel',
    touch: Touch,
  ) => {
    const ended = type !== 'touchstart';
    canvas.dispatchEvent(new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches: ended ? [] : [touch],
      targetTouches: ended ? [] : [touch],
      changedTouches: [touch],
    }));
  };

  const tapAt = (point: TapPoint, delay: number) => schedule(() => {
    const touch = new Touch({
      identifier: ++touchId,
      target: canvas,
      ...point,
      radiusX: TAP_RADIUS_PX,
      radiusY: TAP_RADIUS_PX,
      rotationAngle: 0,
      force: 1,
    });
    activeTouches.add(touch);
    schedule(() => {
      activeTouches.delete(touch);
      sendTouch('touchend', touch);
    }, TAP_HOLD_MS);
    sendTouch('touchstart', touch);
  }, delay);

  const cancelFallback = () => {
    pendingFallback = null;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const touch of activeTouches.values()) sendTouch('touchcancel', touch);
    activeTouches.clear();
  };

  // Capture phase on the window, so this runs before the listener the client's
  // glue registers on the canvas and the flag is already in place when the
  // callback reads it. Registered here rather than on the canvas for the same
  // reason: capture descends from the root, so an ancestor always precedes it.
  window.addEventListener('mousedown', (event) => {
    if (!event.isTrusted) return;
    const flag = nativeFlag();
    const isDoubleClick = event.button === 0 && event.detail % 2 === 0;
    if (flag) flag.value = isDoubleClick ? 1 : 0;
    if (event.button !== 0 || event.target !== canvas) return;
    cancelFallback();
    if (!isDoubleClick) return;
    if (flag !== null) {
      trace?.record({ source: 'renderer', kind: 'double-click', path: 'native' });
      return;
    }
    pendingFallback = {
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
      screenX: event.screenX,
      screenY: event.screenY,
    };
    trace?.record({
      source: 'renderer',
      kind: 'double-click',
      path: 'tap-fallback',
    });
  }, true);

  window.addEventListener('mouseup', (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    const point = pendingFallback;
    pendingFallback = null;
    if (point === null || event.target !== canvas) return;
    for (const delay of TAP_START_DELAYS_MS) tapAt(point, delay);
  }, true);
  canvas.addEventListener('mouseleave', () => {
    pendingFallback = null;
  }, true);
  window.addEventListener('blur', cancelFallback);
  window.addEventListener('pagehide', cancelFallback);
  window.addEventListener('gw:input-reset', cancelFallback);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelFallback();
  });
  log('double-click: native with tap fallback');
};
