/**
 * Maps the launcher's three public global Tools to the released settings and
 * shortcut vocabulary. Hidden experiments never enter the launcher contract.
 */
import type { AppSettings, AppSettingsPatch } from "../../shared/contracts.js";
import type { GlobalTool, GlobalToolSettings } from "../../shared/launcher-contracts.js";
import {
  resolveShortcuts,
  type ShortcutAction,
  type ShortcutBinding,
} from "../../shared/keyboard-shortcuts.js";

export const TOOL_ACTION: Readonly<Record<GlobalTool, ShortcutAction>> = Object.freeze({
  "build-management": "tools.toggle",
  "quick-travel": "travel.open",
  "xunlai-storage": "storage.open",
});

export function launcherToolSettings(settings: AppSettings): GlobalToolSettings {
  const shortcuts = resolveShortcuts(settings.shortcutOverrides);
  return Object.freeze({
    "build-management": Object.freeze({ enabled: settings.buildLibrary, shortcut: shortcuts["tools.toggle"] }),
    "quick-travel": Object.freeze({ enabled: settings.travelPalette, shortcut: shortcuts["travel.open"] }),
    "xunlai-storage": Object.freeze({ enabled: settings.xunlaiStorage, shortcut: shortcuts["storage.open"] }),
  });
}

export function globalToolPatch(tool: GlobalTool, enabled: boolean): AppSettingsPatch {
  if (tool === "build-management") return { buildLibrary: enabled };
  if (tool === "quick-travel") return { travelPalette: enabled };
  return { xunlaiStorage: enabled };
}

export function allGlobalToolsPatch(enabled: boolean): AppSettingsPatch {
  return {
    gwonmacTools: enabled,
    buildLibrary: enabled,
    travelPalette: enabled,
    xunlaiStorage: enabled,
  };
}

export function shortcutOwner(
  binding: ShortcutBinding,
  settings: AppSettings,
  except: GlobalTool,
): GlobalTool | null {
  const features = launcherToolSettings(settings);
  for (const tool of Object.keys(features) as GlobalTool[]) {
    const candidate = features[tool].shortcut;
    if (
      tool !== except
      && candidate
      && candidate.key === binding.key
      && candidate.shift === binding.shift
      && candidate.option === binding.option
    ) return tool;
  }
  return null;
}
