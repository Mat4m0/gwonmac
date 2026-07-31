/**
 * Ask Guild Wars to repeat pointer hit-testing after a click only when its
 * cursor callback proves the click did not already do so. The two synthetic
 * coordinates end where they began; Chromium's physical pointer never moves.
 */
export function installCursorRefresh(
  canvas: HTMLCanvasElement,
  eventCount: () => number,
  refreshed: () => void,
): () => void {
  let pendingFrame = 0;
  let pressEventCount: number | null = null;
  const rememberBeforeClick = (event: MouseEvent) => {
    if (event.isTrusted && event.button === 0 && event.target === canvas) {
      pressEventCount = eventCount();
    }
  };
  const refreshAfterClick = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    const countBeforeClick = pressEventCount ?? eventCount();
    pressEventCount = null;
    if (event.target !== canvas) return;
    const init: MouseEventInit = {
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
    };
    cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      if (!canvas.isConnected || document.visibilityState !== "visible") return;
      if (eventCount() !== countBeforeClick) return;
      const rect = canvas.getBoundingClientRect();
      const nudge = event.clientX - rect.left + 1 < rect.width ? 1 : -1;
      canvas.dispatchEvent(new MouseEvent("mousemove", {
        ...init,
        clientX: event.clientX + nudge,
        screenX: event.screenX + nudge,
        movementX: nudge,
      }));
      canvas.dispatchEvent(new MouseEvent("mousemove", {
        ...init,
        movementX: -nudge,
      }));
      refreshed();
    });
  };
  window.addEventListener("mousedown", rememberBeforeClick, true);
  window.addEventListener("mouseup", refreshAfterClick, true);
  return () => {
    window.removeEventListener("mousedown", rememberBeforeClick, true);
    window.removeEventListener("mouseup", refreshAfterClick, true);
    cancelAnimationFrame(pendingFrame);
    pressEventCount = null;
  };
}
