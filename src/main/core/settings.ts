import { readFile, rename } from "node:fs/promises";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "./atomic-file.js";

const RENDER_SCALES = new Set<AppSettings["renderScale"]>([1, 1.5, 2]);
const CURSOR_THEMES = new Set<AppSettings["cursorTheme"]>([
  "system",
  "guild-wars",
  "guild-wars-2",
]);
const TOUCH_MODES = new Set<AppSettings["touchMode"]>([
  "dbltap",
  "translate",
  "augment",
  "off",
]);

function asBool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") {
    throw new AppError("bad_settings", `settings.${field} must be a boolean`);
  }
  return v;
}

/** Reject unknown types; ignore unknown fields; fill missing from defaults. */
export function parseSettings(raw: unknown): AppSettings {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("bad_settings", "settings must be an object");
  }
  const src = raw as Record<string, unknown>;
  const out: AppSettings = { ...DEFAULT_SETTINGS };

  if ("renderScale" in src) {
    if (!RENDER_SCALES.has(src.renderScale as AppSettings["renderScale"])) {
      throw new AppError("bad_settings", `settings.renderScale has unknown type/value`);
    }
    out.renderScale = src.renderScale as AppSettings["renderScale"];
  }
  if ("pointerLock" in src) out.pointerLock = asBool(src.pointerLock, "pointerLock");
  if ("cursorTheme" in src) {
    if (!CURSOR_THEMES.has(src.cursorTheme as AppSettings["cursorTheme"])) {
      throw new AppError("bad_settings", "settings.cursorTheme has unknown type/value");
    }
    out.cursorTheme = src.cursorTheme as AppSettings["cursorTheme"];
  }
  if ("touchMode" in src) {
    if (!TOUCH_MODES.has(src.touchMode as AppSettings["touchMode"])) {
      throw new AppError("bad_settings", `settings.touchMode has unknown type/value`);
    }
    out.touchMode = src.touchMode as AppSettings["touchMode"];
  }
  if ("showDiagnostics" in src) {
    out.showDiagnostics = asBool(src.showDiagnostics, "showDiagnostics");
  }
  if ("dataStrategy" in src) {
    if (
      src.dataStrategy !== null &&
      src.dataStrategy !== "quick" &&
      src.dataStrategy !== "full"
    ) {
      throw new AppError(
        "bad_settings",
        "settings.dataStrategy must be quick, full, or null",
      );
    }
    out.dataStrategy = src.dataStrategy;
  }
  return out;
}

export async function loadSettings(
  path: string,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<AppSettings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { ...DEFAULT_SETTINGS };
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return recoverCorruptSettings(path, onRecovered);
  }
  try {
    return parseSettings(raw);
  } catch {
    return recoverCorruptSettings(path, onRecovered);
  }
}

async function recoverCorruptSettings(
  path: string,
  onRecovered: ((backupPath: string) => void | Promise<void>) | undefined,
): Promise<AppSettings> {
  const backupPath = `${path}.corrupt-${Date.now()}`;
  try {
    await rename(path, backupPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
    return { ...DEFAULT_SETTINGS };
  }
  await onRecovered?.(backupPath);
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(path: string, value: AppSettings): Promise<AppSettings> {
  const cleaned = parseSettings(value);
  await writeAtomicJson(path, cleaned);
  return cleaned;
}
