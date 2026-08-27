/**
 * The development spike's one fail-closed conversion from certified Compass
 * geometry and pathing trapezoids to CSS-space boundary segments. It accepts
 * no pointers and requires a proved scale and one matching map generation.
 */

export type CompassFrameObservation = Readonly<{
  status: "ready";
  generation: number;
  frameId: number;
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
}> | Readonly<{ status: "waiting"; reason: string }>;

export type PathingTrapezoid = Readonly<{
  topLeftX: number;
  topRightX: number;
  bottomLeftX: number;
  bottomRightX: number;
  topY: number;
  bottomY: number;
}>;

export type PathingObservation = Readonly<{
  status: "ready";
  generation: number;
  playerX: number;
  playerY: number;
  trapezoids: readonly PathingTrapezoid[];
}> | Readonly<{ status: "waiting"; reason: string }>;

export type CompassCalibration = Readonly<{
  status: "proven";
  orientation: "north-up";
  worldUnitsPerPixel: number;
}> | Readonly<{ status: "uncertain"; reason: string }>;

export type CompassPathingLine = Readonly<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;

export type CompassPathingProjection = Readonly<{
  generation: number;
  frameId: number;
  circle: Readonly<{ centerX: number; centerY: number; radius: number }>;
  lines: readonly CompassPathingLine[];
}>;

type Point = Readonly<{ x: number; y: number }>;
const MAX_TRAPEZOIDS = 4_096;
const MAX_WORLD_COORDINATE = 1_000_000;
const MAX_VIEWPORT_EDGE = 32_768;
const SCALE_TOLERANCE = 0.01;

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function validGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validTrapezoid(value: PathingTrapezoid): boolean {
  const coordinates = [
    value.topLeftX, value.topRightX, value.bottomLeftX,
    value.bottomRightX, value.topY, value.bottomY,
  ];
  return finite(coordinates)
    && coordinates.every((coordinate) => Math.abs(coordinate) <= MAX_WORLD_COORDINATE)
    && value.topY > value.bottomY
    && value.topLeftX <= value.topRightX
    && value.bottomLeftX <= value.bottomRightX;
}

/** Clip one segment to a circle. `null` means no visible part remains. */
export function clipSegmentToCircle(
  start: Point,
  end: Point,
  center: Point,
  radius: number,
): readonly [Point, Point] | null {
  if (!finite([start.x, start.y, end.x, end.y, center.x, center.y, radius])
    || radius <= 0) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return fx * fx + fy * fy <= radius * radius
    ? Object.freeze([start, end])
    : null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  const startInside = c <= 0;
  const endX = end.x - center.x;
  const endY = end.y - center.y;
  const endInside = endX * endX + endY * endY <= radius * radius;
  if (discriminant < 0) return startInside && endInside
    ? Object.freeze([start, end])
    : null;
  const root = Math.sqrt(discriminant);
  const enter = (-b - root) / (2 * a);
  const leave = (-b + root) / (2 * a);
  const from = startInside ? 0 : Math.max(0, enter);
  const to = endInside ? 1 : Math.min(1, leave);
  if (from > to || to < 0 || from > 1) return null;
  const point = (at: number): Point => Object.freeze({
    x: start.x + dx * at,
    y: start.y + dy * at,
  });
  return Object.freeze([point(from), point(to)]);
}

export function projectCompassPathing(
  frame: CompassFrameObservation,
  pathing: PathingObservation,
  calibration: CompassCalibration,
  canvas: HTMLCanvasElement,
): CompassPathingProjection | null {
  if (
    frame.status !== "ready"
    || pathing.status !== "ready"
    || calibration.status !== "proven"
    || calibration.orientation !== "north-up"
    || !frame.visible
    || !validGeneration(frame.generation)
    || frame.generation !== pathing.generation
    || frame.frameId <= 0
    || pathing.trapezoids.length === 0
    || pathing.trapezoids.length > MAX_TRAPEZOIDS
    || !finite([
      frame.viewportWidth, frame.viewportHeight, frame.left, frame.bottom,
      frame.right, frame.top, pathing.playerX, pathing.playerY,
      calibration.worldUnitsPerPixel,
    ])
    || frame.viewportWidth <= 0 || frame.viewportWidth > MAX_VIEWPORT_EDGE
    || frame.viewportHeight <= 0 || frame.viewportHeight > MAX_VIEWPORT_EDGE
    || frame.left >= frame.right || frame.bottom >= frame.top
    || frame.right <= 0 || frame.top <= 0
    || frame.left >= frame.viewportWidth || frame.bottom >= frame.viewportHeight
    || calibration.worldUnitsPerPixel <= 0
    || Math.abs(pathing.playerX) > MAX_WORLD_COORDINATE
    || Math.abs(pathing.playerY) > MAX_WORLD_COORDINATE
    || pathing.trapezoids.some((trapezoid) => !validTrapezoid(trapezoid))
  ) return null;
  const width = frame.right - frame.left;
  const height = frame.top - frame.bottom;
  if (Math.abs(width / height - 1) > SCALE_TOLERANCE) return null;
  const canvasRect = canvas.getBoundingClientRect();
  if (!finite([
    canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height,
  ]) || canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  const scaleX = canvasRect.width / frame.viewportWidth;
  const scaleY = canvasRect.height / frame.viewportHeight;
  if (Math.abs(scaleX / scaleY - 1) > SCALE_TOLERANCE) return null;

  const center = Object.freeze({
    x: (frame.left + frame.right) / 2,
    y: (frame.bottom + frame.top) / 2,
  });
  const radius = Math.min(width, height) / 2;
  const worldPoint = (x: number, y: number): Point => Object.freeze({
    x: center.x + (x - pathing.playerX) / calibration.worldUnitsPerPixel,
    y: center.y + (y - pathing.playerY) / calibration.worldUnitsPerPixel,
  });
  const cssPoint = (point: Point): Point => Object.freeze({
    x: canvasRect.left + point.x * scaleX,
    y: canvasRect.top + (frame.viewportHeight - point.y) * scaleY,
  });
  const lines: CompassPathingLine[] = [];
  for (const trapezoid of pathing.trapezoids) {
    const points = [
      worldPoint(trapezoid.topLeftX, trapezoid.topY),
      worldPoint(trapezoid.topRightX, trapezoid.topY),
      worldPoint(trapezoid.bottomRightX, trapezoid.bottomY),
      worldPoint(trapezoid.bottomLeftX, trapezoid.bottomY),
    ];
    for (let index = 0; index < points.length; index += 1) {
      const clipped = clipSegmentToCircle(
        points[index]!,
        points[(index + 1) % points.length]!,
        center,
        radius,
      );
      if (clipped === null) continue;
      const start = cssPoint(clipped[0]);
      const end = cssPoint(clipped[1]);
      lines.push(Object.freeze({ x1: start.x, y1: start.y, x2: end.x, y2: end.y }));
    }
  }
  if (lines.length === 0) return null;
  const cssCenter = cssPoint(center);
  return Object.freeze({
    generation: frame.generation,
    frameId: frame.frameId,
    circle: Object.freeze({
      centerX: cssCenter.x,
      centerY: cssCenter.y,
      radius: radius * scaleX,
    }),
    lines: Object.freeze(lines),
  });
}
