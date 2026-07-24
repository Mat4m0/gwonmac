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
    let lockEnabled = initialSettings.pointerLock;
    /** @type {{ x: number, y: number } | null} */
    let pendingTap = null;
    let touchId = 0;
    /** @type {Touch | null} */
    let activeTouch = null;
    /** @type {{ x: number, y: number } | null} */
    let virtualCursor = null;
    let resettingPointer = false;
    let pendingX = 0;
    let pendingY = 0;
    let resetFrame = 0;
    let wheelRemainder = 0;
    let wheelDirection = 0;
    let wheelAt = 0;

    const resetWheel = () => {
      wheelRemainder = 0;
      wheelDirection = 0;
      wheelAt = 0;
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

    function releasePointer() {
      virtualCursor = null;
      resettingPointer = false;
      pendingX = 0;
      pendingY = 0;
      cancelAnimationFrame(resetFrame);
      canvas.classList.remove('cursor-hidden');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    function releaseAll() {
      // Translate/augment gestures must see interruption, not a normal mouseup.
      cancelSyntheticTouches();
      resetWheel();
      for (const input of heldKeys.values()) {
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
      heldKeys.clear();
      for (const input of heldButtons.values()) {
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
      heldButtons.clear();
      releasePointer();
    }

    window.addEventListener('keydown', (event) => {
      if (!event.isTrusted || event.repeat) return;
      heldKeys.set(event.code, {
        target: event.target,
        key: event.key,
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
      if (event.isTrusted) heldKeys.delete(event.code);
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

    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    window.addEventListener('gw:input-reset', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') releaseAll();
    });

    // Pixel deltas from trackpads become bounded line steps; discrete mouse
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
      if (!direction) return;
      if (direction !== wheelDirection || now - wheelAt > 150) {
        wheelRemainder = 0;
      }
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
        // ArenaNet's generated Emscripten glue defines one wheel step as
        // three DOM lines. Sending a single line was divided by three again
        // inside the client and never crossed its zoom threshold.
        deltaY: steps * 3,
        deltaMode: globalThis.WheelEvent.DOM_DELTA_LINE,
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
        sendMouse('mousemove', rect, 2, 0, movementX, movementY);
        return;
      }
      const stepX =
        Math.max(0, Math.min(rect.width, nextX)) - virtualCursor.x;
      const stepY =
        Math.max(0, Math.min(rect.height, nextY)) - virtualCursor.y;
      virtualCursor.x += stepX;
      virtualCursor.y += stepY;
      sendMouse('mousemove', rect, 2, 0, stepX, stepY);
      pendingX += movementX - stepX;
      pendingY += movementY - stepY;
      if (resettingPointer) return;
      resettingPointer = true;
      sendMouse('mouseup', rect, 0, 2, 0, 0);
      virtualCursor = { x: rect.width / 2, y: rect.height / 2 };
      sendMouse('mousedown', rect, 2, 2, 0, 0);
      resetFrame = requestAnimationFrame(() => {
        resettingPointer = false;
        if (document.pointerLockElement !== canvas || !virtualCursor) return;
        const replayX = pendingX;
        const replayY = pendingY;
        pendingX = 0;
        pendingY = 0;
        if (replayX || replayY) sendDelta(replayX, replayY);
      });
    };

    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 2 || !lockEnabled || !event.isTrusted) return;
      const rect = canvas.getBoundingClientRect();
      virtualCursor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      resettingPointer = false;
      pendingX = 0;
      pendingY = 0;
      if (document.pointerLockElement === canvas) return;
      try {
        const request = canvas.requestPointerLock();
        request?.catch((error) => {
          diagnostics?.event('pointerLock.failed', error);
          log(
            '[warn] pointer lock refused:',
            error instanceof Error ? error.message : String(error),
          );
          releaseAll();
        });
      } catch (error) {
        diagnostics?.event('pointerLock.failed', error);
        log(
          '[warn] pointer lock refused:',
          error instanceof Error ? error.message : String(error),
        );
        releaseAll();
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
        pendingX += event.movementX;
        pendingY += event.movementY;
      } else {
        sendDelta(event.movementX, event.movementY);
      }
    }, true);

    document.addEventListener('mouseup', (event) => {
      if (event.button === 2 && event.isTrusted) releasePointer();
    }, true);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      canvas.classList.toggle('cursor-hidden', locked);
      if (virtualCursor && !locked) releaseAll();
    });
    document.addEventListener('pointerlockerror', () => {
      diagnostics?.event('pointerLock.failed');
      log('[warn] pointer lock failed (needs a user gesture and focused document)');
      releaseAll();
    });

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
        lockEnabled = next.pointerLock;
        if (!lockEnabled) releasePointer();
      },
    });
  };
})();
