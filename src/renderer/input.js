// Renderer-owned game input. The Emscripten host installs this once before its
// glue loads; native interruptions all converge on releaseAll().
(function () {
  'use strict';

  window.gwInstallGameInput = ({
    canvas,
    initialSettings,
    diagnostics,
    log,
  }) => {
    /** @type {Map<string, {
     *   target: EventTarget | null,
     *   key: string,
     *   code: string,
     *   location: number,
     *   charCode: number,
     *   keyCode: number,
     *   which: number,
     *   ctrlKey: boolean,
     *   shiftKey: boolean,
     *   altKey: boolean,
     *   metaKey: boolean
     * }>} */
    const heldKeys = new Map();
    /** @type {Map<number, {
     *   target: EventTarget | null,
     *   button: number,
     *   clientX: number,
     *   clientY: number,
     *   screenX: number,
     *   screenY: number,
     *   ctrlKey: boolean,
     *   shiftKey: boolean,
     *   altKey: boolean,
     *   metaKey: boolean
     * }>} */
    const heldButtons = new Map();
    /** @type {Map<number, Touch>} */
    const syntheticTouches = new Map();
    /** @type {Set<number>} */
    const tapTimers = new Set();
    let touchMode = initialSettings.touchMode;
    /** @type {{ x: number, y: number } | null} */
    let pendingTap = null;
    let touchId = 0;
    /** @type {Touch | null} */
    let activeTouch = null;
    /** @type {{ x: number, y: number } | null} */
    let virtualCursor = null;
    let pointerWanted = false;
    let resettingPointer = false;
    let pendingPointerX = 0;
    let pendingPointerY = 0;
    let pointerResetFrame = 0;
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

    /** @param {() => void} callback @param {number} delay */
    const schedule = (callback, delay) => {
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

    /** @param {number} x @param {number} y @param {number} identifier */
    const makeTouch = (x, y, identifier) => new Touch({
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

    /**
     * @param {'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'} type
     * @param {Touch} touch
     */
    const sendTouch = (type, touch) => {
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

    /** @param {Touch} touch */
    const startTouch = (touch) => {
      syntheticTouches.set(touch.identifier, touch);
      sendTouch('touchstart', touch);
    };
    /** @param {Touch} touch */
    const moveTouch = (touch) => {
      syntheticTouches.set(touch.identifier, touch);
      sendTouch('touchmove', touch);
    };
    /**
     * @param {'touchend' | 'touchcancel'} type
     * @param {Touch} touch
     */
    const finishTouch = (type, touch) => {
      syntheticTouches.delete(touch.identifier);
      sendTouch(type, touch);
    };

    const cancelSyntheticTouches = () => {
      cancelTapTimers();
      pendingTap = null;
      activeTouch = null;
      for (const touch of syntheticTouches.values()) {
        sendTouch('touchcancel', touch);
      }
      syntheticTouches.clear();
    };

    /**
     * @param {string} type
     * @param {DOMRect} rect
     * @param {number} buttons
     * @param {number} button
     * @param {number} movementX
     * @param {number} movementY
     */
    const sendMouse = (type, rect, buttons, button, movementX, movementY) => {
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

    // macOS treats Option as a text modifier, so a held Option rewrites
    // KeyboardEvent.key: W arrives as "∑" on a US layout, and as an unrelated
    // ASCII character ("@", "|") on others. ArenaNet's client identifies keys
    // by that string, so an Option-held release never clears the key its press
    // registered — holding Option to read merchant names while running left
    // movement keys down for good. The physical key is in `code`; ask the OS
    // what that key produces unmodified, and restate the event before the
    // client (or our own held-key registry) sees it.
    /** @type {Map<string, string>} */
    let layoutKeys = new Map();
    const readLayoutKeys = () => {
      const layout = navigator.keyboard?.getLayoutMap?.();
      if (!layout) {
        log('[warn] keyboard layout unavailable; Option-held keys may stick');
        return;
      }
      layout.then((map) => {
        layoutKeys = new Map(map);
      }).catch((error) => {
        diagnostics?.event('keyboard.layoutFailed', error);
        log(
          '[warn] keyboard layout unreadable:',
          error instanceof Error ? error.message : String(error),
        );
      });
    };
    readLayoutKeys();
    // Chromium has no layout-change event, and switching input source does not
    // reach the game while another window owns it. Re-reading on focus is the
    // last moment before the new layout can produce a key.
    window.addEventListener('focus', readLayoutKeys);

    /**
     * Returns the key the client should see, having already re-dispatched a
     * corrected event in place of a modifier-rewritten one.
     * @param {KeyboardEvent} event
     */
    const layoutKey = (event) => {
      const target = event.target;
      if (!event.altKey || !target) return event.key;
      const key = layoutKeys.get(event.code);
      if (!key || key.toUpperCase() === event.key.toUpperCase()) return event.key;
      // One event per physical transition: the rewritten one must not also
      // reach the client, or a layout whose Option layer produces a bound
      // character presses that binding and never releases it — a German
      // Option+L is "@", which the client reads as the 2 key going down.
      // Text entry is restated too: the client's own OSK fields relay key
      // events to the canvas, so they carry the same rewrite to the same
      // state. Only propagation stops here, so the field still types the
      // character the OS composed.
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

    function releasePointer() {
      pointerWanted = false;
      virtualCursor = null;
      resettingPointer = false;
      pendingPointerX = 0;
      pendingPointerY = 0;
      cancelAnimationFrame(pointerResetFrame);
      canvas.classList.remove('cursor-hidden');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    /** @param {(code: string) => boolean} [matches] */
    function releaseKeys(matches = () => true) {
      const inputs = [...heldKeys.entries()].filter(([code]) => matches(code));
      for (const [code] of inputs) heldKeys.delete(code);
      for (const [, input] of inputs) {
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
    }

    function releaseButtons() {
      const inputs = [...heldButtons.values()];
      heldButtons.clear();
      releasePointer();
      for (const input of inputs) {
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
    }

    function releaseAll() {
      if (releasing) return;
      releasing = true;
      try {
        // Translate/augment gestures must see interruption, not a normal mouseup.
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
      const key = layoutKey(event);
      if (event.repeat && heldKeys.has(event.code)) return;
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
      layoutKey(event);
      heldKeys.delete(event.code);
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
      if (event.isTrusted) heldButtons.delete(event.button);
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
    /** @type {WeakSet<WheelEvent>} */
    const normalizedWheels = new WeakSet();
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

    /** @param {number} x @param {number} y @param {number} delay */
    const tapAt = (x, y, delay) => schedule(() => {
      const touch = makeTouch(x, y, ++touchId);
      startTouch(touch);
      schedule(() => finishTouch('touchend', touch), 30);
    }, delay);

    canvas.addEventListener('mousedown', (event) => {
      if (touchMode === 'off' || event.button !== 0) return;
      if (touchMode === 'dbltap') {
        // Chromium already applies the user's macOS double-click speed and
        // distance preferences to detail. Do not impose a second, conflicting
        // detector here. Even counts preserve consecutive double-click pairs.
        cancelSyntheticTouches();
        if (event.detail > 0 && event.detail % 2 === 0) {
          pendingTap = { x: event.clientX, y: event.clientY };
        }
        return;
      }
      activeTouch = makeTouch(event.clientX, event.clientY, ++touchId);
      startTouch(activeTouch);
      if (touchMode === 'translate') event.stopImmediatePropagation();
    }, true);

    canvas.addEventListener('mousemove', (event) => {
      if (touchMode === 'off' || touchMode === 'dbltap' || !activeTouch) return;
      activeTouch = makeTouch(
        event.clientX,
        event.clientY,
        activeTouch.identifier,
      );
      moveTouch(activeTouch);
      if (touchMode === 'translate') event.stopImmediatePropagation();
    }, true);

    canvas.addEventListener('mouseup', (event) => {
      if (touchMode === 'dbltap') {
        if (event.button !== 0 || !pendingTap) return;
        const { x, y } = pendingTap;
        pendingTap = null;
        tapAt(x, y, 20);
        tapAt(x, y, 100);
        return;
      }
      if (touchMode === 'off' || event.button !== 0 || !activeTouch) return;
      const touch = makeTouch(
        event.clientX,
        event.clientY,
        activeTouch.identifier,
      );
      activeTouch = null;
      finishTouch('touchend', touch);
      if (touchMode === 'translate') event.stopImmediatePropagation();
    }, true);

    canvas.addEventListener('mouseleave', () => {
      if (touchMode === 'dbltap') {
        pendingTap = null;
        return;
      }
      if (!activeTouch) return;
      const touch = activeTouch;
      activeTouch = null;
      finishTouch('touchcancel', touch);
    }, true);

    /** @param {number} movementX @param {number} movementY */
    const sendDelta = (movementX, movementY) => {
      if (!virtualCursor) return;
      const rect = canvas.getBoundingClientRect();
      const nextX = virtualCursor.x + movementX;
      const nextY = virtualCursor.y + movementY;
      if (
        nextX >= 0 &&
        nextX <= rect.width &&
        nextY >= 0 &&
        nextY <= rect.height
      ) {
        virtualCursor.x = nextX;
        virtualCursor.y = nextY;
        sendMouse('mousemove', rect, currentButtons(), 0, movementX, movementY);
        return;
      }
      const stepX =
        Math.max(0, Math.min(rect.width, nextX)) - virtualCursor.x;
      const stepY =
        Math.max(0, Math.min(rect.height, nextY)) - virtualCursor.y;
      virtualCursor.x += stepX;
      virtualCursor.y += stepY;
      const buttons = currentButtons();
      sendMouse('mousemove', rect, buttons, 0, stepX, stepY);
      pendingPointerX += movementX - stepX;
      pendingPointerY += movementY - stepY;
      if (resettingPointer) return;
      resettingPointer = true;
      // The client steers from absolute coordinates. Re-grab at center while
      // the physical button remains held, then replay the unconsumed delta.
      sendMouse('mouseup', rect, buttons & ~2, 2, 0, 0);
      virtualCursor = { x: rect.width / 2, y: rect.height / 2 };
      sendMouse('mousedown', rect, buttons, 2, 0, 0);
      pointerResetFrame = requestAnimationFrame(() => {
        resettingPointer = false;
        if (document.pointerLockElement !== canvas || !virtualCursor) return;
        const replayX = pendingPointerX;
        const replayY = pendingPointerY;
        pendingPointerX = 0;
        pendingPointerY = 0;
        if (replayX || replayY) sendDelta(replayX, replayY);
      });
    };

    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 2 || !event.isTrusted) return;
      const rect = canvas.getBoundingClientRect();
      virtualCursor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      pointerWanted = true;
      resettingPointer = false;
      pendingPointerX = 0;
      pendingPointerY = 0;
      if (document.pointerLockElement === canvas) return;
      try {
        const request = canvas.requestPointerLock();
        request?.then(() => {
          if (!pointerWanted && document.pointerLockElement === canvas) {
            document.exitPointerLock();
          }
        }).catch((error) => {
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
      if (resettingPointer) {
        pendingPointerX += event.movementX;
        pendingPointerY += event.movementY;
      } else {
        sendDelta(event.movementX, event.movementY);
      }
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
    log(`touch mode: ${touchMode}`);
    canvas.dataset.inputReady = 'true';

    return Object.freeze({
      releaseAll,
      /** @param {import('../shared/contracts.js').AppSettings} next */
      applySettings(next) {
        if (next.touchMode !== touchMode) {
          cancelSyntheticTouches();
        }
        touchMode = next.touchMode;
      },
    });
  };
})();
