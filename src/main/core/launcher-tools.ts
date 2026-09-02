/**
 * Projects launcher feature switches from the canonical activation policy.
 * Explicit shortcut replacement resolves conflicts across every app action.
 */
import type { AppSettings, AppSettingsPatch } from "../../shared/contracts.js";
import { GLOBAL_TOOLS, GLOBAL_TOOL_FEATURES, type GlobalTool, type GlobalToolSettings } from "../../shared/launcher-contracts.js";
import { FEATURE_SELECTION_POLICIES } from "../../shared/feature-contracts.js";
import { resolveShortcuts, shortcutConflict, shortcutReserved, withShortcutOverride, type ShortcutAction, type ShortcutBinding } from "../../shared/keyboard-shortcuts.js";

export function launcherToolSettings(settings: AppSettings): GlobalToolSettings {
  return Object.freeze(Object.fromEntries(GLOBAL_TOOLS.map((tool) => [tool, Object.freeze({
    enabled: settings[FEATURE_SELECTION_POLICIES[GLOBAL_TOOL_FEATURES[tool]].activation.setting],
  })]))) as GlobalToolSettings;
}

export function globalToolPatch(tool: GlobalTool, enabled: boolean): AppSettingsPatch {
  return { [FEATURE_SELECTION_POLICIES[GLOBAL_TOOL_FEATURES[tool]].activation.setting]: enabled };
}

/** Keep the existing first-run opt-in; new controls do not change player defaults. */
export function allGlobalToolsPatch(enabled: boolean): AppSettingsPatch {
  return {
    gwonmacTools: enabled,
    buildLibrary: enabled,
    travelPalette: enabled,
    xunlaiStorage: enabled,
  };
}

/** An explicit replacement clears the previous owner across all app actions. */
export function launcherShortcutPatch(
  settings: AppSettings,
  action: ShortcutAction,
  binding: ShortcutBinding | null,
): AppSettingsPatch {
  if (binding !== null && shortcutReserved(binding)) throw new Error("That shortcut is reserved by macOS or the application");
  let overrides = settings.shortcutOverrides;
  const conflict = binding === null ? null : shortcutConflict(action, binding, resolveShortcuts(overrides));
  if (conflict) overrides = withShortcutOverride(overrides, conflict, null);
  return { shortcutOverrides: withShortcutOverride(overrides, action, binding) };
}
