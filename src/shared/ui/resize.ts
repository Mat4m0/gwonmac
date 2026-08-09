/**
 * Owns pointer and keyboard resizing for browser UI frames.
 * Surface owners still decide their current size, bounds, and active styling.
 */
export interface ResizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export interface ResizeGripOptions {
  size(): { width: number; height: number };
  limits(): ResizeLimits;
  resize(width: number, height: number): void;
  setActive?(active: boolean): void;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(Math.min(minimum, maximum), Math.min(maximum, value));

/**
 * Give a `.ui-resize-grip` the one resize interaction GWonMac supports.
 *
 * The surface owner supplies bounds and applies the size because a Vue panel
 * owns reactive state while the native Settings dialog owns inline geometry.
 * Pointer capture, cancellation, and keyboard behavior stay identical.
 */
export function installResizeGrip(
  handle: HTMLElement,
  options: ResizeGripOptions,
): () => void {
  let finishActivePointer: (() => void) | null = null;

  const apply = (width: number, height: number) => {
    const limits = options.limits();
    options.resize(
      clamp(width, limits.minWidth, limits.maxWidth),
      clamp(height, limits.minHeight, limits.maxHeight),
    );
  };

  const pointerdown = (event: PointerEvent) => {
    event.preventDefault();
    finishActivePointer?.();
    const start = options.size();
    const origin = { x: event.clientX, y: event.clientY };
    handle.setPointerCapture(event.pointerId);
    options.setActive?.(true);
    const move = (next: PointerEvent) => {
      apply(
        start.width + next.clientX - origin.x,
        start.height + next.clientY - origin.y,
      );
    };
    const finish = () => {
      options.setActive?.(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      if (finishActivePointer === finish) finishActivePointer = null;
    };
    finishActivePointer = finish;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
  };

  const keydown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const size = options.size();
    const step = event.shiftKey ? 48 : 16;
    apply(
      size.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      size.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
    );
  };

  handle.addEventListener("pointerdown", pointerdown);
  handle.addEventListener("keydown", keydown);
  return () => {
    finishActivePointer?.();
    handle.removeEventListener("pointerdown", pointerdown);
    handle.removeEventListener("keydown", keydown);
  };
}
