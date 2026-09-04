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
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SETTINGS,
  CONTROLLER_PROMPT_STYLES,
  LAST_UPDATE_CHECK_AT_MAX,
  RENDERER_WRITABLE_SETTINGS,
  RENDER_SCALES,
  UPDATE_TRACKS,
  UI_PANEL_OPACITY_MAX,
  UI_PANEL_OPACITY_MIN,
  UI_FONTS,
  UI_STYLES,
  type AppSettings,
  type AppSettingsPatch,
  type RendererSettingsPatch,
} from "../../shared/contracts.js";
import { isDigest } from "../../shared/digest.js";
import { AppError } from "../../shared/errors.js";
import { isShortcutOverrides } from "../../shared/keyboard-shortcuts.js";
import {
  cloneSkillKeyBindings,
  isSkillKeyBindings,
} from "../../shared/skill-key-bindings.js";
import {
  cloneSkillCooldownColor,
  isSkillCooldownColor,
} from "../../shared/skill-cooldowns.js";
import { isStoredTravelShortcuts } from "../../shared/travel.js";
import {
  DEFAULT_CUSTOM_UI_THEME,
  normaliseCustomUiTheme,
} from "../../shared/ui-theme.js";
import {
  CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX,
  CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN,
  CARTOGRAPHY_OPACITY_MAX,
  CARTOGRAPHY_OPACITY_MIN,
  normaliseCartographyPresetLibrary,
  normaliseCartographyPresetRef,
} from "../../shared/cartography-overlay.js";
import { writeAtomicJson } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

const RENDER_SCALE_VALUES = new Set<AppSettings["renderScale"]>(RENDER_SCALES);
const UI_STYLE_VALUES = new Set<AppSettings["uiStyle"]>(UI_STYLES);
const UI_FONT_VALUES = new Set<AppSettings["uiFont"]>(UI_FONTS);
const CONTROLLER_PROMPT_STYLE_VALUES = new Set<AppSettings["controllerPromptStyle"]>(
  CONTROLLER_PROMPT_STYLES,
);
const UPDATE_TRACK_VALUES = new Set<AppSettings["updateTrack"]>(UPDATE_TRACKS);

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
const LEGACY_DATA_STRATEGIES: ReadonlySet<unknown> = new Set([null, "quick", "full"]);

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
  const out: AppSettings = {
    ...DEFAULT_SETTINGS,
    uiCustomTheme: { ...DEFAULT_CUSTOM_UI_THEME },
  };

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
  if ("uiCustomTheme" in src) {
    const theme = normaliseCustomUiTheme(src.uiCustomTheme);
    if (!theme) {
      throw new AppError("bad_settings", "settings.uiCustomTheme is invalid");
    }
    out.uiCustomTheme = theme;
  }
  if ("uiFont" in src) {
    if (!UI_FONT_VALUES.has(src.uiFont as AppSettings["uiFont"])) {
      throw new AppError("bad_settings", "settings.uiFont has unknown value");
    }
    out.uiFont = src.uiFont as AppSettings["uiFont"];
  }
  if ("controllerPromptStyle" in src) {
    if (!CONTROLLER_PROMPT_STYLE_VALUES.has(
      src.controllerPromptStyle as AppSettings["controllerPromptStyle"],
    )) {
      throw new AppError("bad_settings", "settings.controllerPromptStyle has unknown value");
    }
    out.controllerPromptStyle = src.controllerPromptStyle as AppSettings["controllerPromptStyle"];
  }
  if ("uiPanelOpacity" in src) {
    out.uiPanelOpacity = asBoundedInteger(
      src.uiPanelOpacity,
      "uiPanelOpacity",
      UI_PANEL_OPACITY_MIN,
      UI_PANEL_OPACITY_MAX,
    );
  }
  if ("cartographyPresetLibrary" in src) {
    const library = normaliseCartographyPresetLibrary(src.cartographyPresetLibrary);
    if (library === null) {
      throw new AppError("bad_settings", "settings.cartographyPresetLibrary is invalid");
    }
    out.cartographyPresetLibrary = library;
  }
  for (const setting of [
    "cartographyWalkabilityOpacity",
    "cartographyGridOpacity",
  ] as const) {
    if (setting in src) {
      out[setting] = asBoundedInteger(
        src[setting],
        setting,
        CARTOGRAPHY_OPACITY_MIN,
        CARTOGRAPHY_OPACITY_MAX,
      );
    }
  }
  if ("cartographyControlIdleOpacity" in src) {
    out.cartographyControlIdleOpacity = asBoundedInteger(
      src.cartographyControlIdleOpacity,
      "cartographyControlIdleOpacity",
      CARTOGRAPHY_CONTROL_IDLE_OPACITY_MIN,
      CARTOGRAPHY_CONTROL_IDLE_OPACITY_MAX,
    );
  }
  if ("cartographyRevealMode" in src) {
    const mode = src.cartographyRevealMode;
    if (mode !== "off" && mode !== "normal" && mode !== "birds-eye") {
      throw new AppError("bad_settings", "settings.cartographyRevealMode is invalid");
    }
    out.cartographyRevealMode = mode;
  }
  if ("shortcutOverrides" in src) {
    if (!isShortcutOverrides(src.shortcutOverrides)) {
      throw new AppError("bad_settings", "settings.shortcutOverrides has invalid bindings");
    }
    out.shortcutOverrides = { ...src.shortcutOverrides };
  }
  if ("skillKeyBindings" in src) {
    if (!isSkillKeyBindings(src.skillKeyBindings)) {
      throw new AppError("bad_settings", "settings.skillKeyBindings has invalid bindings");
    }
    out.skillKeyBindings = cloneSkillKeyBindings(src.skillKeyBindings);
  }
  // Before labels had their own switch, configuring any label enabled the
  // overlay. Preserve that expressed choice for existing profiles while a
  // new profile with no labels keeps the feature off.
  if (!("skillKeyLabelsEnabled" in src)) {
    out.skillKeyLabelsEnabled = out.skillKeyBindings.some((binding) => binding !== null);
  }
  if ("skillCooldownColor" in src) {
    if (!isSkillCooldownColor(src.skillCooldownColor)) {
      throw new AppError("bad_settings", "settings.skillCooldownColor has an invalid color");
    }
    out.skillCooldownColor = cloneSkillCooldownColor(src.skillCooldownColor);
  }
  if ("travelShortcuts" in src) {
    if (!isStoredTravelShortcuts(src.travelShortcuts)) {
      throw new AppError("bad_settings", "settings.travelShortcuts has invalid destinations");
    }
    out.travelShortcuts = src.travelShortcuts.map((shortcut) =>
      shortcut === null ? null : { ...shortcut }
    );
  }
  // Stable releases before Build Library became the owner of Apply Team used
  // `teamManagement` for the same player opt-out. Dormant profiles can retain
  // that released shape indefinitely, so this read alias is permanent.
  if (!("buildLibrary" in src) && "teamManagement" in src) {
    out.buildLibrary = asBool(src.teamManagement, "teamManagement");
  }
  for (const setting of [
    "gwonmacTools",
    "cartographyEnabled",
    "cartographyOverlayEnabled",
    "cartographyGridEnabled",
    "cartographyCompassGridEnabled",
    "compassRangeIndicatorsEnabled",
    "compassRangeEarshotEnabled",
    "compassRangeCastEnabled",
    "compassRangeSpiritEnabled",
    "compassRangeSpiritExtendedEnabled",
    "buildLibrary",
    "tradeChat",
    "xunlaiStorage",
    "quickItemMove",
    "travelPalette",
    "chatFiltersEnabled",
    "chatFilterAllyDrops",
    "chatFilterHallOfHeroes",
    "chatFilterTitleAchievements",
    "characterSwitchEnabled",
    "characterSwitchProfession",
    "characterSwitchLevel",
    "characterSwitchLocation",
    "targetReadout",
    "skillKeyLabelsEnabled",
    "skillCooldownOverlayEnabled",
    "extendedMemoryEnabled",
    "autoRelogAfterReload",
  ] as const) {
    if (setting in src) out[setting] = asBool(src[setting], setting);
  }
  if ("showDiagnostics" in src) {
    out.showDiagnostics = asBool(src.showDiagnostics, "showDiagnostics");
  }
  if ("dataStrategy" in src && !LEGACY_DATA_STRATEGIES.has(src.dataStrategy)) {
    throw new AppError(
      "bad_settings",
      "settings.dataStrategy must be quick, full, or null",
    );
  }
  // Hard cutover: every readable legacy value becomes the rollback-safe value.
  out.dataStrategy = "full";
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

/** The generic renderer bridge cannot bypass Travel's compare-and-refuse path. */
export function parseRendererSettingsPatch(raw: unknown): RendererSettingsPatch {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("bad_settings", "settings patch must be an object");
  }
  const src = raw as Record<string, unknown>;
  const allowed = new Set<string>([
    ...RENDERER_WRITABLE_SETTINGS,
    "cartographyPresetSelection",
  ]);
  const unknownKey = Object.keys(src).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new AppError(
      "bad_settings",
      `game renderer cannot update ${JSON.stringify(unknownKey)}`,
    );
  }
  const hasSelection = Object.hasOwn(src, "cartographyPresetSelection");
  if (hasSelection && Object.keys(src).length !== 1) {
    throw new AppError(
      "bad_settings",
      "settings preset selection must be one atomic operation",
    );
  }
  if (hasSelection) {
    const selection = normaliseCartographyPresetRef(src.cartographyPresetSelection);
    if (selection === null) {
      throw new AppError("bad_settings", "settings.cartographyPresetSelection is invalid");
    }
    return { cartographyPresetSelection: selection };
  }
  const parsed = parseSettingsPatch(src);
  const patch: Partial<Pick<AppSettings, (typeof RENDERER_WRITABLE_SETTINGS)[number]>> = {};
  for (const key of RENDERER_WRITABLE_SETTINGS) {
    if (Object.hasOwn(src, key)) Object.assign(patch, { [key]: parsed[key] });
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
  const backupPath = await quarantineCorruptDocument(path);
  if (backupPath) await onRecovered?.(backupPath);
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(path: string, value: AppSettings): Promise<AppSettings> {
  const cleaned = parseSettings(value);
  await writeAtomicJson(path, {
    formatVersion: SETTINGS_FORMAT,
    ...cleaned,
    // Rollback projection only. `buildLibrary` remains the sole runtime and
    // type-system source of truth.
    teamManagement: cleaned.buildLibrary,
  });
  return cleaned;
}
