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

// The modifier keys the client tracks, by the `KeyboardEvent.key` it reads.
// It has no fourth: Command is not a Guild Wars modifier.
const TRACED_MODIFIERS: Readonly<Record<string, 'ctrl' | 'shift' | 'alt'>> = {
  Control: 'ctrl',
  Shift: 'shift',
  Alt: 'alt',
};

const isCommandKey = (code: string): boolean =>
  code === 'MetaLeft' || code === 'MetaRight';

/**
 * The modifiers a press carried, as the trace prints them.
 *
 * Worth knowing when reading one: the client does not use these. Its mouse
 * callback reads only the button and the position out of the event and never
 * touches the modifier bytes beside them, so a press message carries a
 * modifier state the client accumulated from *key* events instead. A trace
 * that shows `left +ctrl` on the press and no Control key down before it is
 * therefore a report about the keyboard path, not the mouse one.
 */
const tracedModifiers = (event: MouseEvent) => [
  ...(event.ctrlKey ? ['ctrl' as const] : []),
  ...(event.shiftKey ? ['shift' as const] : []),
  ...(event.altKey ? ['alt' as const] : []),
  ...(event.metaKey ? ['cmd' as const] : []),
];

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
  // Where the press landed, which the moves below deliberately do not update:
  // the trace reports how far a press travelled before its release, and the
  // live coordinates have already been walked to the pointer by then.
  originX: number;
  originY: number;
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
  /**
   * The hidden desktop fields the client uses as native text-editing proxies.
   * They stay out of the browser's tab order; the client owns which one is
   * active and moves between them itself.
   */
  textInputs?: ReadonlySet<EventTarget | null>;
  diagnostics?: GameInputDiagnostics;
  /**
   * The developer trace, when the player has switched it on. It observes and
   * never decides: every call here is on a path whose behaviour is identical
   * with the trace absent.
   */
  trace?: InputTrace;
  /**
   * The client's own cursor-hidden state through the certified cursor
   * readout, or null while that readout is unavailable (enhancement off,
   * uncertified build, not yet installed). Measured 2026-08-03: entering
   * mouse-look hides the client's cursor within a tick of the right press;
   * a world-map pan never hides it.
   */
  clientCursorHidden?: () => boolean | null;
  log(...values: unknown[]): void;
};

// How often a held right-drag re-asks the client whether it entered
// mouse-look, matching the cursor observer's own sampling cadence.
const POINTER_MODE_INTERVAL_MS = 50;

// The provider chooser is laid out in the client's fixed 600-unit-tall login
// coordinate system. These are the centres of its two buttons, measured from
// the current official client. Expressing them through the canvas height keeps
// the hit targets stable across window sizes and Retina scale factors.
const PROVIDER_BUTTON_X_FROM_CENTRE = -161 / 600;
const PROVIDER_BUTTON_Y = [219 / 600, 253 / 600] as const;

// A successful login can paint character selection one or two frames before
// that screen starts accepting keys. Delay only the first immediate Enter;
// after this short window, the upstream client is ready and needs no help.
const CHARACTER_SELECTION_WINDOW_MS = 8_000;
const CHARACTER_ENTER_DELAY_MS = 180;

export const installGameInput = ({
  canvas,
  textInputs = new Set(),
  diagnostics,
  trace,
  clientCursorHidden,
  log,
}: GameInputOptions): GameInputController => {
  const heldKeys = new Map<string, HeldKey>();
  const heldButtons = new Map<number, HeldButton>();
  const suppressedKeyUps = new Set<string>();
  let providerChooserVisible = false;
  let providerSelection = 0;
  let characterSelectionUntil = 0;
  let virtualCursor: { x: number; y: number } | null = null;
  let pointerWanted = false;
  let modeWatch: ReturnType<typeof setInterval> | null = null;
  // The lock state the trace last reported, which is not the same as the lock
  // state. A right-click shorter than the lock's round trip resolves its
  // request after the button is already up, so the exit below runs before the
  // browser delivers the change event that announced the lock — and both that
  // event and the one for the exit then read an already-cleared
  // `pointerLockElement`. Reporting each of those is how a lock nobody held
  // came out of the trace as "released" twice with no "engaged" above it.
  let lockTraced = false;

  function stopModeWatch() {
    if (modeWatch !== null) clearInterval(modeWatch);
    modeWatch = null;
  }
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
    stopModeWatch();
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

  function dispatchButtonRelease(input: HeldButton, buttons: number) {
    input.target?.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: input.button,
      buttons,
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
    for (const input of inputs) dispatchButtonRelease(input, 0);
  }

  function releaseButton(button: number) {
    const input = heldButtons.get(button);
    if (!input) return;
    heldButtons.delete(button);
    if (button === 2) releasePointer();
    dispatchButtonRelease(input, currentButtons());
  }

  function releaseAll() {
    if (releasing) return;
    releasing = true;
    try {
      resetWheel();
      releaseKeys();
      releaseButtons();
    } finally {
      releasing = false;
    }
  }

  const providerPoint = (selection = providerSelection) => {
    const rect = canvas.getBoundingClientRect();
    return {
      rect,
      x: rect.left + rect.width / 2 + rect.height * PROVIDER_BUTTON_X_FROM_CENTRE,
      y: rect.top + rect.height *
        (PROVIDER_BUTTON_Y[selection] ?? PROVIDER_BUTTON_Y[0]),
    };
  };

  const sendProviderMouse = (
    type: 'mousemove' | 'mousedown' | 'mouseup' | 'click',
    buttons: number,
  ) => {
    const { x, y } = providerPoint();
    canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: type === 'mousemove' ? -1 : 0,
      buttons,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      detail: type === 'click' ? 1 : 0,
    }));
  };

  const pointAtProviderSelection = () => sendProviderMouse('mousemove', 0);

  const activateProviderSelection = () => {
    sendProviderMouse('mousedown', 1);
    sendProviderMouse('mouseup', 0);
    sendProviderMouse('click', 0);
    providerChooserVisible = false;
  };

  const handleProviderKey = (event: KeyboardEvent) => {
    if (!providerChooserVisible || event.target !== canvas) return false;
    const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ||
      (event.key === 'Tab' && event.shiftKey);
    const forwards = event.key === 'ArrowDown' || event.key === 'ArrowRight' ||
      (event.key === 'Tab' && !event.shiftKey);
    if (backwards || forwards) {
      providerSelection = (providerSelection + (backwards ? -1 : 1) + 2) % 2;
      pointAtProviderSelection();
    } else if (event.key === 'Enter' || event.key === ' ') {
      activateProviderSelection();
    } else {
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressedKeyUps.add(event.code);
    return true;
  };

  const sendBufferedCharacterEnter = (event: KeyboardEvent) => {
    const init: KeyboardEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: event.key,
      code: event.code,
      location: event.location,
    };
    setTimeout(() => {
      canvas.dispatchEvent(new globalThis.KeyboardEvent('keydown', init));
      canvas.dispatchEvent(new globalThis.KeyboardEvent('keyup', init));
    }, CHARACTER_ENTER_DELAY_MS);
  };

  const traceOwner = (target: EventTarget | null) => {
    if (target === canvas) return 'canvas' as const;
    if (textInputs.has(target)) {
      return target instanceof HTMLInputElement &&
        (target.type === 'password' || target.type === 'email')
        ? 'secret' as const
        : 'text' as const;
    }
    return target instanceof Element && target.closest('[data-gwonmac-surface]')
      ? 'surface' as const
      : 'other' as const;
  };

  const traceKey = (
    event: KeyboardEvent,
    phase: 'down' | 'up',
    decision: 'observed' | 'held' | 'released' | 'suppressed' | 'command',
  ) => {
    const owner = traceOwner(event.target);
    const common = {
      source: 'renderer' as const, kind: 'key' as const, phase,
      repeat: event.repeat, trusted: event.isTrusted, decision,
    };
    trace?.record(owner === 'canvas'
      ? { ...common, owner, code: event.code }
      : { ...common, owner });
  };

  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    // Guild Wars has no Command modifier. Let Chromium and the main-process
    // shortcut controller keep the combination, but do not let the bare
    // modifier transition disturb game keys that are already held.
    if (isCommandKey(event.code)) {
      traceKey(event, 'down', 'command');
      event.stopImmediatePropagation();
      return;
    }
    if (handleProviderKey(event)) {
      traceKey(event, 'down', 'suppressed');
      return;
    }
    if (
      event.target === canvas &&
      event.key === 'Enter' &&
      performance.now() < characterSelectionUntil
    ) {
      characterSelectionUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressedKeyUps.add(event.code);
      traceKey(event, 'down', 'suppressed');
      sendBufferedCharacterEnter(event);
      return;
    }
    if (performance.now() >= characterSelectionUntil) characterSelectionUntil = 0;
    // The client changes its active proxy in its own keydown listener. Do not
    // let Chromium then perform a second Tab move from the newly focused field
    // to the canvas, which made focus appear to skip at random.
    if (event.key === 'Tab' && textInputs.has(event.target)) {
      event.preventDefault();
    }
    const held = heldKeys.get(event.code);
    const key = clientKey(event, event.repeat ? held?.key : undefined);
    if (event.repeat && held) {
      traceKey(event, 'down', 'observed');
      return;
    }
    const modifier = TRACED_MODIFIERS[key];
    if (modifier) trace?.record({
      source: 'renderer', kind: 'modifier', key: modifier, down: true,
    });
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
    traceKey(event, 'down', 'held');
  }, true);
  window.addEventListener('keyup', (event) => {
    if (!event.isTrusted) return;
    if (isCommandKey(event.code)) {
      traceKey(event, 'up', 'command');
      event.stopImmediatePropagation();
      return;
    }
    if (suppressedKeyUps.delete(event.code)) {
      traceKey(event, 'up', 'suppressed');
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const held = heldKeys.get(event.code);
    const key = clientKey(event, held?.key);
    const modifier = TRACED_MODIFIERS[key];
    if (modifier) trace?.record({
      source: 'renderer', kind: 'modifier', key: modifier, down: false,
    });
    heldKeys.delete(event.code);
    traceKey(event, 'up', 'released');
    // A release landing on renderer UI (the Tools palette) never bubbles back
    // to the client's canvas listeners, so a press the canvas received would
    // stay held forever. Replay exactly those releases at the press target;
    // presses the UI itself received stay inside its event boundary.
    if (held && held.target === canvas && event.target !== canvas) {
      dispatchKeyRelease(held);
    }
  }, true);
  window.addEventListener('mousedown', (event) => {
    if (!event.isTrusted) return;
    trace?.record({
      source: 'renderer',
      kind: 'press',
      owner: traceOwner(event.target),
      button: event.button,
      detail: event.detail,
      modifiers: tracedModifiers(event),
    });
    heldButtons.set(event.button, {
      target: event.target,
      button: event.button,
      originX: event.clientX,
      originY: event.clientY,
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
    trace?.record({
      source: 'renderer',
      kind: 'release',
      owner: traceOwner(event.target),
      button: event.button,
      travel: held
        ? (() => {
            const pixels = Math.hypot(
          event.clientX - held.originX,
          event.clientY - held.originY,
            );
            return pixels < 3 ? 'still' : pixels < 40 ? 'short' : 'far';
          })()
        : 'still',
      buttonsRemaining: heldButtons.size - (held ? 1 : 0),
    });
    heldButtons.delete(event.button);
    if (held && held.target === canvas && event.target !== canvas) {
      dispatchButtonRelease(held, currentButtons());
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

  const releaseFor = (cause: 'blur' | 'hidden' | 'command' | 'pagehide') => () => {
    // Only the causes are named, not a new reason to release: every one of
    // these already released everything, and the trace exists to say which
    // native interruption ended a drag the player thought they still had.
    if (heldKeys.size || heldButtons.size) {
      trace?.record({ source: 'renderer', kind: 'release-all', cause });
    }
    suppressedKeyUps.clear();
    releaseAll();
  };
  window.addEventListener('blur', releaseFor('blur'));
  window.addEventListener('pagehide', releaseFor('pagehide'));
  window.addEventListener('gw:input-reset', releaseFor('command'));
  window.addEventListener('gw:input-release', (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
    suppressedKeyUps.delete(event.detail);
    releaseKeys((code) => code === event.detail);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseFor('hidden')();
  });

  // Pixel deltas from trackpads become bounded pixel steps; discrete mouse
  // wheel events pass through unchanged.
  const normalizedWheels = new WeakSet<WheelEvent>();
  canvas.addEventListener('wheel', (event) => {
    if (normalizedWheels.has(event)) return;
    if (event.deltaMode !== globalThis.WheelEvent.DOM_DELTA_PIXEL) {
      trace?.record({
        source: 'renderer',
        kind: 'wheel',
        direction: Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX < 0 ? 'left' : 'right'
          : event.deltaY < 0 ? 'up' : 'down',
        mode: event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
          ? 'line'
          : 'page',
      });
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
    trace?.record({
      source: 'renderer',
      kind: 'wheel',
      direction: steps < 0 ? 'up' : 'down',
      mode: 'pixel',
    });
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

  const engagePointerLock = () => {
    // The trusted-move handler keeps these coordinates current, so a lock
    // engaged mid-drag seeds the virtual cursor where the pointer now is and
    // the drag continues without a seam.
    const held = heldButtons.get(2);
    if (!held) return;
    const rect = canvas.getBoundingClientRect();
    virtualCursor = {
      x: held.clientX - rect.left,
      y: held.clientY - rect.top,
    };
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
          releaseButton(2);
        });
    } catch (error) {
      diagnostics?.event('pointerLock.failed', error);
      log(
        '[warn] pointer lock refused:',
        error instanceof Error ? error.message : String(error),
      );
      releaseButton(2);
    }
  };

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 2 || !event.isTrusted) return;
    pointerWanted = true;
    // Right-click is two modes the press alone cannot tell apart: mouse-look,
    // which needs the lock and the roam walk, and a map/UI pan, which must
    // stay a plain absolute drag or the cursor vanishes and the pan jumps.
    // The client separates them itself — entering mouse-look hides its cursor
    // within a tick — so when that readout is available the lock waits for
    // it. Without the readout the lock engages at the press, as it always
    // has: today's behaviour is the fallback, not the map's.
    const hidden = clientCursorHidden ? clientCursorHidden() : null;
    if (hidden !== false) {
      engagePointerLock();
      return;
    }
    stopModeWatch();
    modeWatch = setInterval(() => {
      if (!pointerWanted || !heldButtons.has(2)) {
        stopModeWatch();
        return;
      }
      if (clientCursorHidden?.() === true) {
        stopModeWatch();
        engagePointerLock();
      }
    }, POINTER_MODE_INTERVAL_MS);
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
    if (locked !== lockTraced) {
      lockTraced = locked;
      trace?.record({ source: 'renderer', kind: 'pointer-lock', locked });
    }
    canvas.classList.toggle('cursor-hidden', locked);
    if (locked && !pointerWanted) {
      document.exitPointerLock();
    } else if (virtualCursor && !locked) {
      releaseButton(2);
    }
  });
  document.addEventListener('pointerlockerror', () => {
    diagnostics?.event('pointerLock.failed');
    log('[warn] pointer lock failed (needs a user gesture and focused document)');
    releaseButton(2);
  });
  document.documentElement.addEventListener('mouseleave', releaseButtons);

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.dataset.inputReady = 'true';

  return Object.freeze({
    releaseAll,
    setLoginProviderChooser(visible: boolean) {
      providerChooserVisible = visible;
      if (!visible) return;
      characterSelectionUntil = 0;
      providerSelection = 0;
      // The rejection resolves just before the client rebuilds this screen.
      // Two frames let that rebuild install its canvas listeners before the
      // synthetic move gives the first button its visible hover state.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (providerChooserVisible) pointAtProviderSelection();
      }));
    },
    expectCharacterSelection() {
      providerChooserVisible = false;
      characterSelectionUntil = performance.now() + CHARACTER_SELECTION_WINDOW_MS;
    },
  });
};
