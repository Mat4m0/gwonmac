import { readFile, unlink } from "node:fs/promises";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "./atomic-file.js";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  mode: "normal" | "maximized" | "fullscreen";
}

export const DEFAULT_WINDOW_SIZE = {
  width: 1280,
  height: 800,
} as const;

const MODES = new Set<WindowState["mode"]>([
  "normal",
  "maximized",
  "fullscreen",
]);

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new AppError("bad_window_state", `windowState.${name} must be an integer`);
  }
  return value as number;
}

export function parseWindowState(value: unknown): WindowState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("bad_window_state", "window state must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!record.bounds || typeof record.bounds !== "object" || Array.isArray(record.bounds)) {
    throw new AppError("bad_window_state", "window state bounds are invalid");
  }
  const bounds = record.bounds as Record<string, unknown>;
  const parsed: WindowBounds = {
    x: integer(bounds.x, "bounds.x"),
    y: integer(bounds.y, "bounds.y"),
    width: integer(bounds.width, "bounds.width"),
    height: integer(bounds.height, "bounds.height"),
  };
  if (
    parsed.width < 320 ||
    parsed.height < 240 ||
    parsed.width > 32_768 ||
    parsed.height > 32_768 ||
    !MODES.has(record.mode as WindowState["mode"])
  ) {
    throw new AppError("bad_window_state", "window state values are invalid");
  }
  return { bounds: parsed, mode: record.mode as WindowState["mode"] };
}

export async function loadWindowState(
  path: string,
  onInvalid?: () => void | Promise<void>,
): Promise<WindowState | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return parseWindowState(JSON.parse(text));
  } catch {
    await clearWindowState(path);
    await onInvalid?.();
    return null;
  }
}

export async function saveWindowState(
  path: string,
  value: WindowState,
): Promise<void> {
  await writeAtomicJson(path, parseWindowState(value), 0o600);
}

export async function clearWindowState(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function intersectionArea(a: WindowBounds, b: WindowBounds): number {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  return width * height;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function fitWindowStateToDisplays(
  state: WindowState,
  workAreas: WindowBounds[],
  primaryWorkArea: WindowBounds,
): WindowState {
  const target = workAreas
    .map((area) => ({ area, overlap: intersectionArea(state.bounds, area) }))
    .sort((a, b) => b.overlap - a.overlap)[0];
  const area = target && target.overlap > 0 ? target.area : primaryWorkArea;
  const width = Math.min(Math.max(800, state.bounds.width), area.width);
  const height = Math.min(Math.max(600, state.bounds.height), area.height);
  const hasVisibleIntersection = !!target && target.overlap > 0;
  const x = hasVisibleIntersection
    ? clamp(state.bounds.x, area.x, area.x + area.width - width)
    : Math.round(area.x + (area.width - width) / 2);
  const y = hasVisibleIntersection
    ? clamp(state.bounds.y, area.y, area.y + area.height - height)
    : Math.round(area.y + (area.height - height) / 2);
  return {
    bounds: { x, y, width, height },
    mode: state.mode,
  };
}

export function defaultWindowState(primaryWorkArea: WindowBounds): WindowState {
  const width = Math.min(DEFAULT_WINDOW_SIZE.width, primaryWorkArea.width);
  const height = Math.min(DEFAULT_WINDOW_SIZE.height, primaryWorkArea.height);
  return {
    bounds: {
      x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2),
      y: Math.round(primaryWorkArea.y + (primaryWorkArea.height - height) / 2),
      width,
      height,
    },
    mode: "normal",
  };
}
