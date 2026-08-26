/**
 * The persisted window placement: what counts as a valid one, and how a stored
 * one is fitted back onto the displays that exist right now. The saved display
 * work area keeps the window's relative size and position when that display's
 * resolution or usable area changes.
 *
 * `mode` is three values and minimized is not among them — a window is never
 * restored into a state the player cannot see. Placement is re-validated
 * against the current work areas on every restore, so a window last seen on a
 * monitor that is now unplugged is centred on the primary display instead of
 * opening off-screen, while one that still overlaps a display keeps its
 * position clamped inside that display's work area.
 *
 * A file this build cannot read is deleted and reported rather than
 * reinterpreted: failing to restore a window must never mean failing to open
 * one.
 */
import { readFile, unlink } from "node:fs/promises";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "./atomic-file.js";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type WindowMode = "normal" | "maximized" | "fullscreen";

export interface WindowState {
  bounds: WindowBounds;
  mode: WindowMode;
  displayWorkArea: WindowBounds;
}

export interface LegacyWindowState {
  bounds: WindowBounds;
  mode: WindowMode;
}

export type RestorableWindowState = WindowState | LegacyWindowState;

export const DEFAULT_WINDOW_SIZE = {
  width: 1280,
  height: 800,
} as const;

const DEFAULT_WINDOW_MARGIN = 64;
const WINDOW_STATE_FORMAT = 1;

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new AppError("bad_window_state", `windowState.${name} must be an integer`);
  }
  return value;
}

function parseMode(value: unknown): WindowMode {
  if (value === "normal" || value === "maximized" || value === "fullscreen") {
    return value;
  }
  throw new AppError("bad_window_state", "window state mode is invalid");
}

function parseBounds(value: unknown, name: string): WindowBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("bad_window_state", `windowState.${name} is invalid`);
  }
  const bounds = value as Record<string, unknown>;
  const parsed = {
    x: integer(bounds.x, `${name}.x`),
    y: integer(bounds.y, `${name}.y`),
    width: integer(bounds.width, `${name}.width`),
    height: integer(bounds.height, `${name}.height`),
  };
  if (
    parsed.width < 1 ||
    parsed.height < 1 ||
    parsed.width > 32_768 ||
    parsed.height > 32_768
  ) {
    throw new AppError("bad_window_state", `windowState.${name} values are invalid`);
  }
  return parsed;
}

/**
 * A file with no `formatVersion` is what the public alpha wrote. Early version
 * 1 files also contain only `{ bounds, mode }`. Both restore in absolute pixels
 * once and gain their display work area on the next save. The additive field
 * keeps the document readable by the supported Stable rollback baseline.
 */
export function parseWindowState(value: unknown): RestorableWindowState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("bad_window_state", "window state must be an object");
  }
  const record = value as Record<string, unknown>;
  const version = record.formatVersion;
  if (version !== undefined && version !== WINDOW_STATE_FORMAT) {
    throw new AppError(
      "bad_window_state",
      `windowState.formatVersion ${JSON.stringify(record.formatVersion)} is not readable`,
    );
  }
  const parsed = parseBounds(record.bounds, "bounds");
  if (parsed.width < 320 || parsed.height < 240) {
    throw new AppError("bad_window_state", "window state values are invalid");
  }
  const state: LegacyWindowState = {
    bounds: parsed,
    mode: parseMode(record.mode),
  };
  if (record.displayWorkArea !== undefined) {
    return {
      ...state,
      displayWorkArea: parseBounds(record.displayWorkArea, "displayWorkArea"),
    };
  }
  return state;
}

export async function loadWindowState(
  path: string,
  onInvalid?: () => void | Promise<void>,
): Promise<RestorableWindowState | null> {
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
  const parsed = parseWindowState({
    formatVersion: WINDOW_STATE_FORMAT,
    ...value,
  });
  await writeAtomicJson(
    path,
    { formatVersion: WINDOW_STATE_FORMAT, ...parsed },
    0o600,
  );
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

function scaledSize(
  bounds: WindowBounds,
  savedArea: WindowBounds,
  currentArea: WindowBounds,
): Pick<WindowBounds, "width" | "height"> {
  const requestedWidth = Math.round(bounds.width / savedArea.width * currentArea.width);
  const requestedHeight = Math.round(bounds.height / savedArea.height * currentArea.height);
  return {
    width: Math.min(Math.max(800, requestedWidth), currentArea.width),
    height: Math.min(Math.max(600, requestedHeight), currentArea.height),
  };
}

function restoreBounds(
  bounds: WindowBounds,
  savedArea: WindowBounds,
  currentArea: WindowBounds,
): WindowBounds {
  const size = scaledSize(bounds, savedArea, currentArea);
  const savedHorizontalRange = savedArea.width - bounds.width;
  const savedVerticalRange = savedArea.height - bounds.height;
  const horizontalRatio = savedHorizontalRange > 0
    ? clamp((bounds.x - savedArea.x) / savedHorizontalRange, 0, 1)
    : 0;
  const verticalRatio = savedVerticalRange > 0
    ? clamp((bounds.y - savedArea.y) / savedVerticalRange, 0, 1)
    : 0;
  return {
    x: currentArea.x + Math.round(
      horizontalRatio * (currentArea.width - size.width),
    ),
    y: currentArea.y + Math.round(
      verticalRatio * (currentArea.height - size.height),
    ),
    ...size,
  };
}

function centeredBounds(
  size: Pick<WindowBounds, "width" | "height">,
  area: WindowBounds,
): WindowBounds {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2),
    ...size,
  };
}

export function fitWindowStateToDisplays(
  state: RestorableWindowState,
  workAreas: WindowBounds[],
  primaryWorkArea: WindowBounds,
): WindowState {
  const savedArea = "displayWorkArea" in state
    ? state.displayWorkArea
    : null;
  const reference = savedArea ?? state.bounds;
  const target = workAreas
    .map((area) => ({ area, overlap: intersectionArea(reference, area) }))
    .sort((a, b) => b.overlap - a.overlap)[0];
  const hasTarget = !!target && target.overlap > 0;
  const area = hasTarget ? target.area : primaryWorkArea;
  const sourceArea = savedArea ?? area;
  const bounds = hasTarget
    ? restoreBounds(state.bounds, sourceArea, area)
    : centeredBounds(scaledSize(state.bounds, sourceArea, area), area);
  return {
    bounds,
    mode: state.mode,
    displayWorkArea: area,
  };
}

export function defaultWindowState(primaryWorkArea: WindowBounds): WindowState {
  const width = Math.min(
    DEFAULT_WINDOW_SIZE.width,
    Math.max(
      Math.min(800, primaryWorkArea.width),
      primaryWorkArea.width - DEFAULT_WINDOW_MARGIN,
    ),
  );
  const height = Math.min(
    DEFAULT_WINDOW_SIZE.height,
    Math.max(
      Math.min(600, primaryWorkArea.height),
      primaryWorkArea.height - DEFAULT_WINDOW_MARGIN,
    ),
  );
  return {
    bounds: {
      x: Math.round(primaryWorkArea.x + (primaryWorkArea.width - width) / 2),
      y: Math.round(primaryWorkArea.y + (primaryWorkArea.height - height) / 2),
      width,
      height,
    },
    mode: "normal",
    displayWorkArea: primaryWorkArea,
  };
}

/**
 * Offset a brand-new account window without ever placing its title bar outside
 * the active work area. Persisted bounds bypass this helper entirely.
 */
export function cascadeWindowState(
  state: WindowState,
  ordinal: number,
  workArea: WindowBounds,
  step = 32,
): WindowState {
  const offset = Math.max(0, Math.trunc(ordinal)) * step;
  return fitWindowStateToDisplays(
    {
      ...state,
      bounds: {
        ...state.bounds,
        x: state.bounds.x + offset,
        y: state.bounds.y + offset,
      },
    },
    [workArea],
    workArea,
  );
}
