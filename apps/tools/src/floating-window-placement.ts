/** Normalized persistence for an embedded Tools window across viewport sizes. */

export type FloatingWindowViewport = Readonly<{
  width: number;
  height: number;
  margin: number;
}>;

export type FloatingWindowBox = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type StoredFloatingWindowPlacement = Readonly<{
  formatVersion: 1;
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type StoredFloatingPosition = Readonly<{
  formatVersion: 1;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  x: number;
  y: number;
}>;

const ratio = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(Math.min(minimum, maximum), value));

function usable(viewport: FloatingWindowViewport) {
  return {
    width: Math.max(0, viewport.width - viewport.margin * 2),
    height: Math.max(0, viewport.height - viewport.margin * 2),
  };
}

function storedRecord(serialized: string | null): Record<string, unknown> | null {
  if (serialized === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function restoreFloatingWindowPlacement(
  serialized: string | null,
  viewport: FloatingWindowViewport,
  minimum: Readonly<{ width: number; height: number }>,
): FloatingWindowBox | null {
  const stored = storedRecord(serialized);
  if (!stored) return null;
  if (
    stored.formatVersion !== 1
    || !ratio(stored.left)
    || !ratio(stored.top)
    || !ratio(stored.width)
    || !ratio(stored.height)
    || stored.width === 0
    || stored.height === 0
  ) return null;

  const available = usable(viewport);
  if (available.width === 0 || available.height === 0) return null;
  const width = clamp(
    Math.round(stored.width * available.width),
    minimum.width,
    available.width,
  );
  const height = clamp(
    Math.round(stored.height * available.height),
    minimum.height,
    available.height,
  );
  return {
    left: viewport.margin + Math.round(
      stored.left * Math.max(0, available.width - width),
    ),
    top: viewport.margin + Math.round(
      stored.top * Math.max(0, available.height - height),
    ),
    width,
    height,
  };
}

export function restoreFloatingPosition(
  serialized: string | null,
  viewport: FloatingWindowViewport,
  size: Readonly<{ width: number; height: number }>,
): Readonly<{ left: number; top: number }> | null {
  const stored = storedRecord(serialized);
  if (
    !stored
    || stored.formatVersion !== 1
    || !["top-left", "top-right", "bottom-left", "bottom-right"].includes(String(stored.corner))
    || typeof stored.x !== "number"
    || !Number.isFinite(stored.x)
    || stored.x < 0
    || typeof stored.y !== "number"
    || !Number.isFinite(stored.y)
    || stored.y < 0
  ) {
    return null;
  }
  const available = usable(viewport);
  if (available.width === 0 || available.height === 0 || size.width <= 0 || size.height <= 0) {
    return null;
  }
  const corner = stored.corner as StoredFloatingPosition["corner"];
  const horizontalRange = Math.max(0, available.width - size.width);
  const verticalRange = Math.max(0, available.height - size.height);
  const x = clamp(stored.x, 0, horizontalRange);
  const y = clamp(stored.y, 0, verticalRange);
  return {
    left: corner.endsWith("left")
      ? viewport.margin + x
      : viewport.width - viewport.margin - size.width - x,
    top: corner.startsWith("top")
      ? viewport.margin + y
      : viewport.height - viewport.margin - size.height - y,
  };
}

export function serializeFloatingPosition(
  position: Readonly<{ left: number; top: number }>,
  viewport: FloatingWindowViewport,
  size: Readonly<{ width: number; height: number }>,
): string | null {
  const available = usable(viewport);
  if (available.width === 0 || available.height === 0 || size.width <= 0 || size.height <= 0) {
    return null;
  }
  const horizontalRange = Math.max(0, available.width - size.width);
  const verticalRange = Math.max(0, available.height - size.height);
  const left = clamp(position.left - viewport.margin, 0, horizontalRange);
  const right = horizontalRange - left;
  const top = clamp(position.top - viewport.margin, 0, verticalRange);
  const bottom = verticalRange - top;
  const horizontal = left <= right ? "left" : "right";
  const vertical = top <= bottom ? "top" : "bottom";
  return JSON.stringify({
    formatVersion: 1,
    corner: `${vertical}-${horizontal}`,
    x: horizontal === "left" ? left : right,
    y: vertical === "top" ? top : bottom,
  } satisfies StoredFloatingPosition);
}

export function serializeFloatingWindowPlacement(
  box: FloatingWindowBox,
  viewport: FloatingWindowViewport,
): string | null {
  const available = usable(viewport);
  if (
    available.width === 0
    || available.height === 0
    || box.width <= 0
    || box.height <= 0
  ) return null;
  const width = clamp(box.width, 1, available.width);
  const height = clamp(box.height, 1, available.height);
  const horizontalRange = Math.max(0, available.width - width);
  const verticalRange = Math.max(0, available.height - height);
  return JSON.stringify({
    formatVersion: 1,
    left: horizontalRange === 0
      ? 0
      : clamp((box.left - viewport.margin) / horizontalRange, 0, 1),
    top: verticalRange === 0
      ? 0
      : clamp((box.top - viewport.margin) / verticalRange, 0, 1),
    width: width / available.width,
    height: height / available.height,
  } satisfies StoredFloatingWindowPlacement);
}
