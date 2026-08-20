/**
 * The settings file: its shape rule, its recovery behaviour, and nothing about
 * what any individual setting means.
 *
 * Unknown fields are ignored on read and are not preserved on the next write;
 * this is deliberate, not a compatibility bag. Public prereleases therefore
 * follow expand/contract release ordering: the latest Stable must already own
 * every durable key and accepted value a beta or RC can write. A malformed
 * known value is refused. A format version this build does not recognise is
 * moved aside intact and defaults are used, so an unreadable profile costs a
 * player their preferences and never their downloaded game data.
 *
 * `parseSettingsPatch` rejects an unknown key outright instead of dropping it,
 * because a silently ignored key is indistinguishable to the renderer from a
 * setting that did not stick.
 */
import { readdir, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  DATA_STRATEGIES,
  DEFAULT_SETTINGS,
  LAST_UPDATE_CHECK_AT_MAX,
  RENDER_SCALES,
  UPDATE_TRACKS,
  UI_PANEL_OPACITY_MAX,
  UI_PANEL_OPACITY_MIN,
  UI_FONTS,
  UI_STYLES,
  type AppSettings,
  type AppSettingsPatch,
} from "../../shared/contracts.js";
import { isDigest } from "../../shared/digest.js";
import { AppError } from "../../shared/errors.js";
import { isShortcutOverrides } from "../../shared/keyboard-shortcuts.js";
import {
  TRAVEL_SHORTCUT_LIMIT,
  copyTravelShortcuts,
  isTravelRecentLimit,
  isTravelRecentMapIds,
  isTravelRequest,
  isTravelShortcuts,
  isTravelSynonyms,
  type TravelShortcuts,
} from "../../shared/travel.js";
import { writeAtomicJson } from "./atomic-file.js";

const RENDER_SCALE_VALUES = new Set<AppSettings["renderScale"]>(RENDER_SCALES);
const DATA_STRATEGY_VALUES = new Set<AppSettings["dataStrategy"]>(DATA_STRATEGIES);
const UI_STYLE_VALUES = new Set<AppSettings["uiStyle"]>(UI_STYLES);
const UI_FONT_VALUES = new Set<AppSettings["uiFont"]>(UI_FONTS);
const UPDATE_TRACK_VALUES = new Set<AppSettings["updateTrack"]>(UPDATE_TRACKS);
const LEGACY_TRAVEL_DISTRICTS = new Set([
  "international", "america", "europe-english", "europe-french",
  "europe-german", "europe-italian", "europe-spanish", "europe-polish",
  "europe-russian", "asia-korean", "asia-chinese", "asia-japanese",
]);

/**
 * A whole number inside a closed range.
 *
 * The bounds are the setting's meaning, not a guard: a panel below 65% opacity
 * stops being readable over moving art, and a border above 4px stops being a
 * border. Refusing out-of-range here keeps the renderer from having to decide
 * what a nonsense value should look like.
 */
function asBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new AppError(
      "bad_settings",
      `settings.${field} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}
const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const SETTINGS_FORMAT = 1;
const CORRUPT_BACKUPS_KEPT = 3;

function asBool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") {
    throw new AppError("bad_settings", `settings.${field} must be a boolean`);
  }
  return v;
}

function canonicalTravelShortcuts(value: unknown, acceptLegacy: boolean): TravelShortcuts | null {
  if (isTravelShortcuts(value)) return copyTravelShortcuts(value);
  if (!acceptLegacy || !Array.isArray(value) || value.length > TRAVEL_SHORTCUT_LIMIT) return null;
  const migrated = value.map((entry): { mapId: number } | null => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const legacy = entry as Record<string, unknown>;
    if (
      Object.keys(legacy).length !== 3
      || !LEGACY_TRAVEL_DISTRICTS.has(String(legacy.district))
      || !Number.isSafeInteger(legacy.districtNumber)
      || Number(legacy.districtNumber) < 0
      || Number(legacy.districtNumber) > 255
    ) return null;
    const canonical = { mapId: legacy.mapId };
    return isTravelRequest(canonical) ? canonical : null;
  });
  if (migrated.some((entry, index) => entry === null && value[index] !== null)) return null;
  while (migrated.length < TRAVEL_SHORTCUT_LIMIT) migrated.push(null);
  return isTravelShortcuts(migrated) ? copyTravelShortcuts(migrated) : null;
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
function parseSettingsValue(raw: unknown, acceptLegacyTravel: boolean): AppSettings {
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
    if (!RENDER_SCALE_VALUES.has(src.renderScale as AppSettings["renderScale"])) {
      throw new AppError("bad_settings", `settings.renderScale has unknown type/value`);
    }
    out.renderScale = src.renderScale as AppSettings["renderScale"];
  }
  if ("uiStyle" in src) {
    if (!UI_STYLE_VALUES.has(src.uiStyle as AppSettings["uiStyle"])) {
      throw new AppError("bad_settings", "settings.uiStyle has unknown value");
    }
    out.uiStyle = src.uiStyle as AppSettings["uiStyle"];
  }
  if ("uiFont" in src) {
    if (!UI_FONT_VALUES.has(src.uiFont as AppSettings["uiFont"])) {
      throw new AppError("bad_settings", "settings.uiFont has unknown value");
    }
    out.uiFont = src.uiFont as AppSettings["uiFont"];
  }
  if ("uiPanelOpacity" in src) {
    out.uiPanelOpacity = asBoundedInteger(
      src.uiPanelOpacity,
      "uiPanelOpacity",
      UI_PANEL_OPACITY_MIN,
      UI_PANEL_OPACITY_MAX,
    );
  }
  if ("shortcutOverrides" in src) {
    if (!isShortcutOverrides(src.shortcutOverrides)) {
      throw new AppError("bad_settings", "settings.shortcutOverrides has invalid bindings");
    }
    out.shortcutOverrides = { ...src.shortcutOverrides };
  }
  if ("travelShortcuts" in src) {
    const shortcuts = canonicalTravelShortcuts(src.travelShortcuts, acceptLegacyTravel);
    if (shortcuts === null) {
      throw new AppError("bad_settings", "settings.travelShortcuts has invalid destinations");
    }
    out.travelShortcuts = shortcuts;
  }
  if ("travelSynonyms" in src) {
    if (!isTravelSynonyms(src.travelSynonyms)) {
      throw new AppError("bad_settings", "settings.travelSynonyms has invalid entries");
    }
    out.travelSynonyms = src.travelSynonyms.map((synonym) => ({ ...synonym }));
  }
  if ("travelRecentLimit" in src) {
    if (!isTravelRecentLimit(src.travelRecentLimit)) {
      throw new AppError("bad_settings", "settings.travelRecentLimit must be 0, 3, 5, or 10");
    }
    out.travelRecentLimit = src.travelRecentLimit;
  }
  if ("travelRecentMapIds" in src) {
    if (!isTravelRecentMapIds(src.travelRecentMapIds)) {
      throw new AppError("bad_settings", "settings.travelRecentMapIds has invalid destinations");
    }
    out.travelRecentMapIds = [...src.travelRecentMapIds];
  }
  for (const setting of [
    "gwonmacTools",
    "teamManagement",
    "xunlaiStorage",
    "travelPalette",
    "targetReadout",
    "extendedMemoryEnabled",
  ] as const) {
    if (setting in src) out[setting] = asBool(src[setting], setting);
  }
  if ("showDiagnostics" in src) {
    out.showDiagnostics = asBool(src.showDiagnostics, "showDiagnostics");
  }
  if ("dataStrategy" in src) {
    if (
      !DATA_STRATEGY_VALUES.has(src.dataStrategy as AppSettings["dataStrategy"])
    ) {
      throw new AppError(
        "bad_settings",
        "settings.dataStrategy must be quick, full, or null",
      );
    }
    out.dataStrategy = src.dataStrategy as AppSettings["dataStrategy"];
  }
  if ("autoCheckUpdates" in src) {
    out.autoCheckUpdates = asBool(src.autoCheckUpdates, "autoCheckUpdates");
  }
  if ("updateTrack" in src) {
    if (!UPDATE_TRACK_VALUES.has(src.updateTrack as AppSettings["updateTrack"])) {
      throw new AppError("bad_settings", "settings.updateTrack has unknown value");
    }
    out.updateTrack = src.updateTrack as AppSettings["updateTrack"];
  }
  if ("lastUpdateCheckAt" in src) {
    const at = src.lastUpdateCheckAt;
    if (
      at !== null &&
      !(
        typeof at === "number"
        && Number.isSafeInteger(at)
        && at >= 0
        && at <= LAST_UPDATE_CHECK_AT_MAX
      )
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
  if (out.travelRecentLimit === 0) out.travelRecentMapIds = [];
  return out;
}

/** Reads released district-bearing shortcuts and returns the current canonical shape. */
export function parseSettings(raw: unknown): AppSettings {
  return parseSettingsValue(raw, true);
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
  const parsed = parseSettingsValue(src, false);
  const patch: AppSettingsPatch = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    if (Object.hasOwn(src, key)) {
      Object.assign(patch, { [key]: parsed[key] });
    }
  }
  if (patch.travelRecentLimit === 0) patch.travelRecentMapIds = [];
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
  let parsed: AppSettings;
  try {
    parsed = parseSettings(raw);
  } catch {
    return recoverCorruptSettings(path, onRecovered);
  }
  const source = raw as Record<string, unknown>;
  const needsTravelMigration = "travelShortcuts" in source
    && !isTravelShortcuts(source.travelShortcuts);
  if (needsTravelMigration) {
    await writeAtomicJson(path, { formatVersion: SETTINGS_FORMAT, ...parsed });
  }
  return parsed;
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
  const cleaned = parseSettingsValue(value, false);
  await writeAtomicJson(path, { formatVersion: SETTINGS_FORMAT, ...cleaned });
  return cleaned;
}
