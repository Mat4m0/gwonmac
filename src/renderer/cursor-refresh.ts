/**
 * Ask Guild Wars to repeat pointer hit-testing without moving the pointer.
 *
 * Two triggers share one synthetic re-test — a pair of `mousemove`s whose
 * coordinates end where they began, so Chromium's physical pointer never moves:
 *
 * 1. After a click, when the game's cursor callback proves the click did not
 *    already hit-test (the original one-shot).
 * 2. While the published cursor sits in `hidden` right after a click. A
 *    server-validated mode change hides the cursor when the acknowledgement
 *    lands, and the game then waits for input or its idle cadence to decide
 *    the new art — measured at 183 ms to 1,795 ms of hidden cursor for the
 *    same salvage action on build 38797 (2026-08-01). The game answers a
 *    re-test with final art as soon as the hide is published, so the loop
 *    asks on the poll after the hide and needs no first-ask delay.
 *
 * Every path that stops re-asking lands on today's behaviour, never below it.
 * The retry state also names the window in which the cursor consumer may hold
 * the last visible art instead of showing a hidden pointer; see `armed` and
 * the consumer's `transitionHold`.
 */

/**
 * Re-asks after the first are paced for transitions that resolve slowly;
 * 150 ms keeps the worst case to a handful of no-op event pairs. 2,500 ms
 * covers the longest measured transition with margin — one that outlives the
 * deadline is treated as the game hiding the cursor on purpose, and the
 * pointer is left alone.
 */
const RETEST_INTERVAL_MS = 150;
const RETEST_DEADLINE_MS = 2500;
/** A stored click older than this cannot have started the current transition. */
const RETEST_CLICK_WINDOW_MS = RETEST_DEADLINE_MS + 500;

interface ClickSnapshot {
  init: MouseEventInit;
  clientX: number;
  screenX: number;
  at: number;
}

export interface CursorRefresh {
  /**
   * Whether a re-test would be honoured right now: a trusted canvas click
   * happened recently, no button is held, the pointer is not locked, the
   * page is visible, and the pointer has not left the canvas since. The same
   * predicate gates the hidden-art hold, so what is asked about and what is
   * held for can never disagree.
   */
  armed(): boolean;
  /** Dispatch the synthetic pair at the last click; `false` when not armed. */
  retest(): boolean;
  dispose(): void;
}

export function installCursorRefresh(
  canvas: HTMLCanvasElement,
  eventCount: () => number,
  refreshed: () => void,
): CursorRefresh {
  let pendingFrame = 0;
  let pressEventCount: number | null = null;
  let lastClick: ClickSnapshot | null = null;
  let heldButtons = 0;

  const dispatchPair = (snapshot: ClickSnapshot) => {
    const rect = canvas.getBoundingClientRect();
    const nudge = snapshot.clientX - rect.left + 1 < rect.width ? 1 : -1;
    canvas.dispatchEvent(new MouseEvent("mousemove", {
      ...snapshot.init,
      clientX: snapshot.clientX + nudge,
      screenX: snapshot.screenX + nudge,
      movementX: nudge,
    }));
    canvas.dispatchEvent(new MouseEvent("mousemove", {
      ...snapshot.init,
      movementX: -nudge,
    }));
    refreshed();
  };

  const presentable = () =>
    canvas.isConnected &&
    document.visibilityState === "visible" &&
    document.pointerLockElement === null;

  const armed = () =>
    lastClick !== null &&
    heldButtons === 0 &&
    presentable() &&
    performance.now() - lastClick.at <= RETEST_CLICK_WINDOW_MS;

  const rememberBeforeClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    heldButtons = event.buttons;
    if (event.button === 0 && event.target === canvas) {
      pressEventCount = eventCount();
    }
  };

  const refreshAfterClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    heldButtons = event.buttons;
    if (event.button !== 0) return;
    const countBeforeClick = pressEventCount ?? eventCount();
    pressEventCount = null;
    if (event.target !== canvas) return;
    const snapshot: ClickSnapshot = {
      init: {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: 0,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        movementX: 0,
        movementY: 0,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      },
      clientX: event.clientX,
      screenX: event.screenX,
      at: performance.now(),
    };
    lastClick = snapshot;
    cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      if (!presentable()) return;
      if (eventCount() !== countBeforeClick) return;
      dispatchPair(snapshot);
    });
  };

  // Real movement over the canvas re-aims the stored click at the pointer's
  // new position — a hand is never perfectly still, and a one-pixel tremor
  // must not abandon a transition the server has yet to answer. Movement onto
  // anything else ends the transition context outright. Synthetic pairs are
  // untrusted and must not touch the click they serve.
  const followRealMove = (event: MouseEvent) => {
    if (!event.isTrusted || lastClick === null) return;
    if (event.target !== canvas) {
      lastClick = null;
      return;
    }
    lastClick = {
      ...lastClick,
      init: {
        ...lastClick.init,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
      },
      clientX: event.clientX,
      screenX: event.screenX,
    };
  };

  window.addEventListener("mousedown", rememberBeforeClick, true);
  window.addEventListener("mouseup", refreshAfterClick, true);
  window.addEventListener("mousemove", followRealMove, true);
  return {
    armed,
    retest() {
      const snapshot = lastClick;
      if (snapshot === null || !armed()) return false;
      dispatchPair(snapshot);
      return true;
    },
    dispose() {
      window.removeEventListener("mousedown", rememberBeforeClick, true);
      window.removeEventListener("mouseup", refreshAfterClick, true);
      window.removeEventListener("mousemove", followRealMove, true);
      cancelAnimationFrame(pendingFrame);
      pressEventCount = null;
      lastClick = null;
    },
  };
}

export interface HiddenCursorRetry {
  /** Feed every consumer poll result; drives the bounded re-ask loop. */
  afterPoll(state: { hidden: boolean; valid: boolean }): void;
  /**
   * Whether the current hidden transition outlived the deadline. False from
   * the very first frame — the consumer's hold window is `!expired` and-ed
   * with the refresh's `armed`, and being false before the loop has even
   * seen the hide is what lets the hold engage on the frame the hide is
   * applied, regardless of poll ordering. Resolution resets it.
   */
  readonly expired: boolean;
  /** Re-tests attempted by this loop, for the runtime stats surface. */
  readonly retests: number;
  /** How long the last resolved hidden transition lasted, in milliseconds. */
  readonly lastGapMs: number | null;
}

/**
 * The bounded loop behind trigger 2: the first ask rides the poll after the
 * hide arrives — the game can already answer by then, and a delayed first ask
 * was itself the measured 152-203 ms gap — and later asks are paced by the
 * interval. A deadline that expires stays expired until the cursor resolves,
 * so a deliberate long hide is asked about a bounded number of times and then
 * left alone.
 */
export function createHiddenCursorRetry(
  retest: () => boolean,
  now: () => number = () => performance.now(),
): HiddenCursorRetry {
  let hiddenSince: number | null = null;
  let lastAttempt: number | null = null;
  let expired = false;
  let retests = 0;
  let lastGapMs: number | null = null;

  return {
    afterPoll(state) {
      if (!state.valid || !state.hidden) {
        if (hiddenSince !== null && state.valid) {
          lastGapMs = now() - hiddenSince;
        }
        hiddenSince = null;
        lastAttempt = null;
        expired = false;
        return;
      }
      const at = now();
      if (hiddenSince === null) {
        hiddenSince = at;
        return;
      }
      if (expired) return;
      if (at - hiddenSince > RETEST_DEADLINE_MS) {
        expired = true;
        return;
      }
      if (lastAttempt !== null && at - lastAttempt < RETEST_INTERVAL_MS) return;
      lastAttempt = at;
      if (retest()) retests += 1;
    },
    get expired() {
      return expired;
    },
    get retests() {
      return retests;
    },
    get lastGapMs() {
      return lastGapMs;
    },
  };
}
