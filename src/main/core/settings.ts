import { readdir, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  DEFAULT_SETTINGS,
  TOOLBOX_TOOLS,
  type AppSettings,
  type AppSettingsPatch,
} from "../../shared/contracts.js";
import { isDigest } from "../../shared/digest.js";
import { AppError } from "../../shared/errors.js";
import { writeAtomicJson } from "./atomic-file.js";

const RENDER_SCALES = new Set<AppSettings["renderScale"]>([1, 1.5, 2]);
const TOUCH_MODES = new Set<AppSettings["touchMode"]>([
  "dbltap",
  "translate",
  "augment",
  "off",
]);
const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const SETTINGS_FORMAT = 1;
const CORRUPT_BACKUPS_KEPT = 3;

function asBool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") {
    throw new AppError("bad_settings", `settings.${field} must be a boolean`);
  }
  return v;
}

/**
 * Reject unknown types; ignore unknown fields; fill missing from defaults.
 *
 * A file with no `formatVersion` is what the public alpha wrote. v0 and v1
 * are the same shape — only the marker is new — so the legacy read is the
 * ordinary read, and an alpha profile keeps every value it had. A version
 * this build does not know is refused rather than reinterpreted; `loadSettings`
 * then moves it aside intact instead of trusting a shape it cannot read.
 */
export function parseSettings(raw: unknown): AppSettings {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("bad_settings", "settings must be an object");
  }
  const src = raw as Record<string, unknown>;
  if (src.formatVersion !== undefined && src.formatVersion !== SETTINGS_FORMAT) {
    throw new AppError(
      "bad_settings",
      `settings.formatVersion ${JSON.stringify(src.formatVersion)} is not readable`,
    );
  }
  const out: AppSettings = { ...DEFAULT_SETTINGS };

  if ("renderScale" in src) {
    if (!RENDER_SCALES.has(src.renderScale as AppSettings["renderScale"])) {
      throw new AppError("bad_settings", `settings.renderScale has unknown type/value`);
    }
    out.renderScale = src.renderScale as AppSettings["renderScale"];
  }
  for (const tool of TOOLBOX_TOOLS) {
    if (tool in src) {
      out[tool] = asBool(src[tool], tool);
    }
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
  if ("autoCheckUpdates" in src) {
    out.autoCheckUpdates = asBool(src.autoCheckUpdates, "autoCheckUpdates");
  }
  if ("lastUpdateCheckAt" in src) {
    const at = src.lastUpdateCheckAt;
    if (
      at !== null &&
      !(typeof at === "number" && Number.isSafeInteger(at) && at >= 0)
    ) {
      throw new AppError(
        "bad_settings",
        "settings.lastUpdateCheckAt must be null or epoch milliseconds",
      );
    }
    out.lastUpdateCheckAt = at;
  }
  if ("compatibilityNoticeSeenFor" in src) {
    const seen = src.compatibilityNoticeSeenFor;
    if (seen !== null && !isDigest(seen)) {
      throw new AppError(
        "bad_settings",
        "settings.compatibilityNoticeSeenFor must be null or a client sha256",
      );
    }
    out.compatibilityNoticeSeenFor = seen;
  }
  return out;
}

export function parseSettingsPatch(raw: unknown): AppSettingsPatch {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("bad_settings", "settings patch must be an object");
  }
  const src = raw as Record<string, unknown>;
  const unknownKey = Object.keys(src).find((key) => !SETTINGS_KEYS.has(key));
  if (unknownKey) {
    throw new AppError(
      "bad_settings",
      `settings patch has unknown field ${JSON.stringify(unknownKey)}`,
    );
  }
  const parsed = parseSettings(src);
  const patch: AppSettingsPatch = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    if (Object.hasOwn(src, key)) {
      Object.assign(patch, { [key]: parsed[key] });
    }
  }
  return patch;
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
  await pruneCorruptBackups(path);
  await onRecovered?.(backupPath);
  return { ...DEFAULT_SETTINGS };
}

/**
 * Keep the three newest `settings.json.corrupt-<epoch>` files and drop the
 * rest. A backup exists so a player can get a lost setting back; nothing reads
 * the fourth-oldest one, and they accumulated for the life of the profile.
 * The epoch is in the name, so ordering needs no stat, and only names this
 * module writes are ever removed.
 */
async function pruneCorruptBackups(settingsPath: string): Promise<void> {
  const directory = dirname(settingsPath);
  const prefix = `${basename(settingsPath)}.corrupt-`;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  const stale = names
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, at: Number(name.slice(prefix.length)) }))
    .filter(({ at }) => Number.isSafeInteger(at))
    .sort((left, right) => right.at - left.at)
    .slice(CORRUPT_BACKUPS_KEPT);
  await Promise.all(
    stale.map(({ name }) =>
      unlink(join(directory, name)).catch(() => undefined),
    ),
  );
}

export async function saveSettings(path: string, value: AppSettings): Promise<AppSettings> {
  const cleaned = parseSettings(value);
  await writeAtomicJson(path, { formatVersion: SETTINGS_FORMAT, ...cleaned });
  return cleaned;
}
