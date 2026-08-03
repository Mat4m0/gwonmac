/**
 * Renderer-owned game input. The Emscripten host installs this once before its
 * glue loads; native interruptions all converge on releaseAll().
 */

// Canvases a held drag may wander from the one it started on. The client keeps
// integrating mouse moves whose coordinates fall outside the canvas, so a drag
// need not stop at the edge — it only needs to stop somewhere, or the
// coordinates of a long drag grow without limit. Sixteen of them put a
// re-anchor several camera revolutions apart at any window size. Only outward:
// the window edge bounds the near side, because the client ignores a move whose
// client coordinates are negative.
const POINTER_ROAM = 16;

// Re-anchors a single mouse move may spend before the leftover delta is
// dropped. Four cross a drag's whole range; further is a teleport, not a drag.
const MAX_POINTER_REGRABS = 4;

// Chromium's own double-click slop: clicks further apart than this are
// separate clicks, so a press that travelled further before releasing was a
// drag, not half of a double-click.
const DOUBLE_CLICK_SLOP = 4;

// ArenaNet's web client identifies a binding by KeyboardEvent.key, which is a
// character from the active keyboard layout. Give each main-block position a
// unique stable US-layout character instead. `code` already is the browser's
// physical identity; this map is only the vocabulary the client accepts for
// non-alphanumeric ANSI positions. ISO/JIS extras and the numpad pass through:
// the key-only client contract has no proven collision-free identity for them.
const PHYSICAL_PUNCTUATION_KEYS: Readonly<Record<string, string>> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

const physicalKey = (code: string, fallback: string): string => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return PHYSICAL_PUNCTUATION_KEYS[code] ?? fallback;
};

/**
 * What a trusted press recorded, so the synthetic release can restate it
 * exactly. `target` is the node the press reached, which is where its release
 * has to be dispatched.
 */
type HeldKey = {
  target: EventTarget | null;
  key: string;
  code: string;
  location: number;
  charCode: number;
  keyCode: number;
  which: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

/**
 * The same for a held mouse button. The coordinates and modifiers are updated
 * by every trusted mousemove, so a release lands where the pointer now is.
 */
type HeldButton = {
  target: EventTarget | null;
  button: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

type GameInputOptions = {
  canvas: HTMLCanvasElement;
  diagnostics?: GameInputDiagnostics;
  log(...values: unknown[]): void;
};

export const installGameInput = ({
  canvas,
  diagnostics,
  log,
}: GameInputOptions): GameInputController => {
  const heldKeys = new Map<string, HeldKey>();
  const heldButtons = new Map<number, HeldButton>();
  const syntheticTouches = new Map<number, Touch>();
  const tapTimers = new Set<ReturnType<typeof setTimeout>>();
  let pendingTap: { x: number; y: number } | null = null;
  let touchId = 0;
  let virtualCursor: { x: number; y: number } | null = null;
  let pointerWanted = false;
  let releasing = false;
  let wheelRemainder = 0;
  let wheelDirection = 0;
  let wheelAt = 0;

  const resetWheel = () => {
    wheelRemainder = 0;
    wheelDirection = 0;
    wheelAt = 0;
  };

  const currentButtons = () => {
    let buttons = 0;
    for (const button of heldButtons.keys()) {
      if (button === 0) buttons |= 1;
      else if (button === 1) buttons |= 4;
      else if (button === 2) buttons |= 2;
      else if (button === 3) buttons |= 8;
      else if (button === 4) buttons |= 16;
    }
    return buttons;
  };

  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      tapTimers.delete(timer);
      callback();
    }, delay);
    tapTimers.add(timer);
    return timer;
  };

  const cancelTapTimers = () => {
    for (const timer of tapTimers) clearTimeout(timer);
    tapTimers.clear();
  };

  const makeTouch = (x: number, y: number, identifier: number) => new Touch({
    identifier,
    target: canvas,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
    radiusX: 5,
    radiusY: 5,
    rotationAngle: 0,
    force: 1,
  });

  const sendTouch = (
    type: 'touchstart' | 'touchend' | 'touchcancel',
    touch: Touch,
  ) => {
    const ended = type === 'touchend' || type === 'touchcancel';
    canvas.dispatchEvent(new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches: ended ? [] : [touch],
      targetTouches: ended ? [] : [touch],
      changedTouches: [touch],
    }));
  };

  const startTouch = (touch: Touch) => {
    syntheticTouches.set(touch.identifier, touch);
    sendTouch('touchstart', touch);
  };
  const finishTouch = (type: 'touchend' | 'touchcancel', touch: Touch) => {
    syntheticTouches.delete(touch.identifier);
    sendTouch(type, touch);
  };

  const cancelSyntheticTouches = () => {
    cancelTapTimers();
    pendingTap = null;
    for (const touch of syntheticTouches.values()) {
      sendTouch('touchcancel', touch);
    }
    syntheticTouches.clear();
  };

  const sendMouse = (
    type: 'mousedown' | 'mousemove' | 'mouseup',
    rect: DOMRect,
    buttons: number,
    button: number,
    movementX: number,
    movementY: number,
  ) => {
    if (!virtualCursor) return false;
    const modifiers = heldButtons.get(button) ??
      (buttons & 2 ? heldButtons.get(2) : undefined);
    return canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + virtualCursor.x,
      clientY: rect.top + virtualCursor.y,
      screenX: window.screenX + rect.left + virtualCursor.x,
      screenY: window.screenY + rect.top + virtualCursor.y,
      movementX,
      movementY,
      buttons,
      button,
      ctrlKey: !!modifiers?.ctrlKey,
      shiftKey: !!modifiers?.shiftKey,
      altKey: !!modifiers?.altKey,
      metaKey: !!modifiers?.metaKey,
    }));
  };

  /**
   * Returns the physical key identity the client should see, having already
   * re-dispatched a corrected event in place of a layout-dependent one.
   */
  const clientKey = (
    event: KeyboardEvent,
    key = physicalKey(event.code, event.key),
  ) => {
    const target = event.target;
    if (!target || key === event.key) return key;
    // One event per physical transition: the rewritten one must not also
    // reach the client. Text entry is restated too because the client's OSK
    // fields relay key events to the canvas. Only propagation stops here, so
    // the field still types the character the OS composed while game input
    // receives the physical identity.
    event.stopImmediatePropagation();
    const restated = new globalThis.KeyboardEvent(event.type, {
      bubbles: true,
      cancelable: true,
      key,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    Object.defineProperties(restated, {
      charCode: { value: event.charCode },
      keyCode: { value: event.keyCode },
      which: { value: event.which },
    });
    target.dispatchEvent(restated);
    return key;
  };

  // Deliberately no position reconciliation here. The client samples mouse
  // state per frame, so a "walk the cursor back to the lock origin" move
  // dispatched at release lands in the same frame as the button-up and is
  // integrated into the camera — releasing a rotation visibly un-rotated it.
  // Event order within a frame cannot fix that; the client resyncs its
  // absolute position from the first real mousemove after the lock ends.
  function releasePointer() {
    pointerWanted = false;
    virtualCursor = null;
    canvas.classList.remove('cursor-hidden');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function dispatchKeyRelease(input: HeldKey) {
    const release = new globalThis.KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key: input.key,
      code: input.code,
      location: input.location,
      ctrlKey: input.ctrlKey,
      shiftKey: input.shiftKey,
      altKey: input.altKey,
      metaKey: input.metaKey,
    });
    // KeyboardEvent's legacy numeric fields are read-only constructor
    // outputs. ArenaNet's Emscripten bridge still marshals them, so shadow
    // the prototype getters with the exact values from the trusted press.
    Object.defineProperties(release, {
      charCode: { value: input.charCode },
      keyCode: { value: input.keyCode },
      which: { value: input.which },
    });
    input.target?.dispatchEvent(release);
  }

  function releaseKeys(matches: (code: string) => boolean = () => true) {
    const inputs = [...heldKeys.entries()].filter(([code]) => matches(code));
    for (const [code] of inputs) heldKeys.delete(code);
    for (const [, input] of inputs) dispatchKeyRelease(input);
  }

  function dispatchButtonRelease(input: HeldButton) {
    input.target?.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: input.button,
      buttons: 0,
      clientX: input.clientX,
      clientY: input.clientY,
      screenX: input.screenX,
      screenY: input.screenY,
      ctrlKey: input.ctrlKey,
      shiftKey: input.shiftKey,
      altKey: input.altKey,
      metaKey: input.metaKey,
    }));
  }

  function releaseButtons() {
    const inputs = [...heldButtons.values()];
    heldButtons.clear();
    releasePointer();
    for (const input of inputs) dispatchButtonRelease(input);
  }

  function releaseAll() {
    if (releasing) return;
    releasing = true;
    try {
      // A double-click repair interrupted between its two taps must not leave
      // ArenaNet's touch detector held across a native modal or focus change.
      cancelSyntheticTouches();
      resetWheel();
      releaseKeys();
      releaseButtons();
    } finally {
      releasing = false;
    }
  }

  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    const held = heldKeys.get(event.code);
    const key = clientKey(event, event.repeat ? held?.key : undefined);
    if (event.repeat && held) return;
    heldKeys.set(event.code, {
      target: event.target,
      key,
      code: event.code,
      location: event.location,
      charCode: event.charCode,
      keyCode: event.keyCode,
      which: event.which,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  }, true);
  window.addEventListener('keyup', (event) => {
    if (!event.isTrusted) return;
    const held = heldKeys.get(event.code);
    clientKey(event, held?.key);
    heldKeys.delete(event.code);
    // A release landing on renderer UI (the Tools palette) never bubbles back
    // to the client's canvas listeners, so a press the canvas received would
    // stay held forever. Replay exactly those releases at the press target;
    // presses the UI itself received stay inside its event boundary.
    if (held && held.target === canvas && event.target !== canvas) {
      dispatchKeyRelease(held);
    }
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      releaseKeys((code) =>
        code !== 'MetaLeft' &&
        code !== 'MetaRight' &&
        code !== 'ShiftLeft' &&
        code !== 'ShiftRight' &&
        code !== 'ControlLeft' &&
        code !== 'ControlRight' &&
        code !== 'AltLeft' &&
        code !== 'AltRight');
    }
  }, true);
  window.addEventListener('mousedown', (event) => {
    if (!event.isTrusted) return;
    heldButtons.set(event.button, {
      target: event.target,
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  }, true);
  window.addEventListener('mouseup', (event) => {
    if (!event.isTrusted) return;
    const held = heldButtons.get(event.button);
    heldButtons.delete(event.button);
    if (held && held.target === canvas && event.target !== canvas) {
      dispatchButtonRelease(held);
    }
  }, true);
  window.addEventListener('mousemove', (event) => {
    if (!event.isTrusted || heldButtons.size === 0) return;
    for (const input of heldButtons.values()) {
      input.clientX = event.clientX;
      input.clientY = event.clientY;
      input.screenX = event.screenX;
      input.screenY = event.screenY;
      input.ctrlKey = event.ctrlKey;
      input.shiftKey = event.shiftKey;
      input.altKey = event.altKey;
      input.metaKey = event.metaKey;
    }
  }, true);

  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', releaseAll);
  window.addEventListener('gw:input-reset', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAll();
  });

  // Pixel deltas from trackpads become bounded pixel steps; discrete mouse
  // wheel events pass through unchanged.
  const normalizedWheels = new WeakSet<WheelEvent>();
  canvas.addEventListener('wheel', (event) => {
    if (normalizedWheels.has(event)) return;
    if (event.deltaMode !== globalThis.WheelEvent.DOM_DELTA_PIXEL) {
      resetWheel();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const now = performance.now();
    const direction = Math.sign(event.deltaY);
    if (
      direction !== 0 &&
      (direction !== wheelDirection || now - wheelAt > 150)
    ) {
      wheelRemainder = 0;
    }
    if (!direction) return;
    wheelDirection = direction;
    wheelAt = now;
    wheelRemainder += event.deltaY;
    const steps = Math.max(-3, Math.min(3, Math.trunc(wheelRemainder / 100)));
    if (!steps) return;
    wheelRemainder -= steps * 100;
    const normalized = new globalThis.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      // ArenaNet's callback receives raw deltaY and deltaMode values. Bundle
      // trackpad motion into Emscripten's nominal 100 px wheel-step size so
      // small pixel deltas are not lost individually.
      deltaY: steps * 100,
      deltaMode: globalThis.WheelEvent.DOM_DELTA_PIXEL,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    normalizedWheels.add(normalized);
    canvas.dispatchEvent(normalized);
  }, { capture: true, passive: false });

  const tapAt = (x: number, y: number, delay: number) => schedule(() => {
    const touch = makeTouch(x, y, ++touchId);
    startTouch(touch);
    schedule(() => finishTouch('touchend', touch), 30);
  }, delay);

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    // Chromium already applies the user's macOS double-click speed and
    // distance preferences to detail. ArenaNet's mouse bridge discards that
    // count, but its touch path has the double-tap detector the game needs for
    // actions such as equipping an item. Preserve every mouse event and append
    // exactly that missing signal for each completed native double-click.
    // detail counts the whole click run, so only the transition into its
    // second click is one: the later even counts (4, 6, …) are rapid single
    // clicks continuing the run, and synthesizing for them turned fast
    // attribute-point clicking into spurious double-clicks.
    cancelSyntheticTouches();
    if (event.detail === 2) {
      pendingTap = { x: event.clientX, y: event.clientY };
    }
  }, true);

  canvas.addEventListener('mouseup', (event) => {
    if (event.button !== 0 || !pendingTap) return;
    const { x, y } = pendingTap;
    pendingTap = null;
    // A press that travelled past the slop before releasing was a drag; a tap
    // pair at the stale press point would act far from where the drag ended.
    if (
      Math.abs(event.clientX - x) > DOUBLE_CLICK_SLOP ||
      Math.abs(event.clientY - y) > DOUBLE_CLICK_SLOP
    ) return;
    tapAt(x, y, 20);
    tapAt(x, y, 100);
  }, true);

  canvas.addEventListener('mouseleave', () => {
    pendingTap = null;
  }, true);

  // The client steers from absolute coordinates, so a held right-drag eventually
  // runs out of the room a re-anchor gives it. Release and re-press at center
  // while the physical button stays held, then spend the rest of the delta in
  // the same tick — deferring the remainder to the next animation frame froze
  // the camera for that frame.
  const sendDelta = (movementX: number, movementY: number) => {
    if (!virtualCursor) return;
    const rect = canvas.getBoundingClientRect();
    const roamX = rect.width * POINTER_ROAM;
    const roamY = rect.height * POINTER_ROAM;
    // Roam is free past the far edges and worthless past the near ones: the
    // client stops integrating a drag whose client coordinates go negative, and
    // resumes only once they come back. A canvas flush against the window — this
    // one fills it — therefore has sixteen canvases of room rightward and half a
    // canvas leftward, which is why rotating right ran forever while rotating
    // left froze within one flick and stayed frozen: the re-anchor that would
    // have rescued it is sixteen canvases further out than a hand ever drags.
    const nearX = Math.max(-roamX, -rect.left);
    const nearY = Math.max(-roamY, -rect.top);
    let restX = movementX;
    let restY = movementY;
    // Each re-anchor buys another budget, so a bounded few consume any delta a
    // hand can produce. The bound also ends the loop on a zero-area canvas.
    for (let regrab = 0; ; regrab += 1) {
      const stepX =
        Math.max(nearX, Math.min(rect.width + roamX, virtualCursor.x + restX)) -
        virtualCursor.x;
      const stepY =
        Math.max(nearY, Math.min(rect.height + roamY, virtualCursor.y + restY)) -
        virtualCursor.y;
      virtualCursor.x += stepX;
      virtualCursor.y += stepY;
      const buttons = currentButtons();
      sendMouse('mousemove', rect, buttons, 0, stepX, stepY);
      restX -= stepX;
      restY -= stepY;
      if ((!restX && !restY) || regrab === MAX_POINTER_REGRABS) return;
      sendMouse('mouseup', rect, buttons & ~2, 2, 0, 0);
      virtualCursor = { x: rect.width / 2, y: rect.height / 2 };
      sendMouse('mousedown', rect, buttons, 2, 0, 0);
    }
  };

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 2 || !event.isTrusted) return;
    const rect = canvas.getBoundingClientRect();
    virtualCursor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    pointerWanted = true;
    if (document.pointerLockElement === canvas) return;
    try {
      const request = canvas.requestPointerLock();
      request?.then(() => {
        if (!pointerWanted && document.pointerLockElement === canvas) {
          document.exitPointerLock();
        }
      }).catch((error: unknown) => {
          diagnostics?.event('pointerLock.failed', error);
          log(
            '[warn] pointer lock refused:',
            error instanceof Error ? error.message : String(error),
          );
          releaseButtons();
        });
    } catch (error) {
      diagnostics?.event('pointerLock.failed', error);
      log(
        '[warn] pointer lock refused:',
        error instanceof Error ? error.message : String(error),
      );
      releaseButtons();
    }
  }, true);

  document.addEventListener('mousemove', (event) => {
    if (
      !virtualCursor ||
      document.pointerLockElement !== canvas ||
      !event.isTrusted
    ) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    sendDelta(event.movementX, event.movementY);
  }, true);

  document.addEventListener('mouseup', (event) => {
    if (event.button === 2 && event.isTrusted) {
      pointerWanted = false;
      releasePointer();
    }
  }, true);
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    canvas.classList.toggle('cursor-hidden', locked);
    if (locked && !pointerWanted) {
      document.exitPointerLock();
    } else if (virtualCursor && !locked) {
      releaseButtons();
    }
  });
  document.addEventListener('pointerlockerror', () => {
    diagnostics?.event('pointerLock.failed');
    log('[warn] pointer lock failed (needs a user gesture and focused document)');
    releaseButtons();
  });
  document.documentElement.addEventListener('mouseleave', releaseAll);

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  log('macOS double-click repair: enabled');
  canvas.dataset.inputReady = 'true';

  return Object.freeze({
    releaseAll,
  });
};
