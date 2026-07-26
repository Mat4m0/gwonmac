import { app } from "electron";
import {
  ENHANCEMENTS,
  type AppSettings,
  type AppSettingsPatch,
  type EnhancementSelection,
} from "../shared/contracts.js";

export const ENHANCEMENT_AUTOMATION_ENABLED =
  !app.isPackaged && process.env.GW_ENHANCEMENT_AUTOMATION === "1";

/**
 * There is deliberately no stored `enhancementsEnabled` master switch. "Is the
 * Enhancement active" is *derived* below from "is any tool on", so the two cannot
 * disagree — a persisted master flag could say no while a tool it governs says
 * yes, and nothing would be able to tell which one the session obeyed.
 */
export const enhancementsEnabledFor = (settings: AppSettings): boolean =>
  ENHANCEMENT_AUTOMATION_ENABLED || ENHANCEMENTS.some((tool) => settings[tool]);

/** Copy only the selected tools into the launch contract. */
export const enhancementSelectionFor = (
  settings: AppSettings,
): EnhancementSelection =>
  Object.fromEntries(
    ENHANCEMENTS.map((tool) => [tool, settings[tool]]),
  ) as EnhancementSelection;

/**
 * Whether a settings write asks for a different set of tools than the ones
 * this launch was started with. Because the module is chosen before the
 * renderer exists, a `true` here is a change the running session cannot honour
 * — so the write and a relaunch have to be one action.
 */
export const enhancementSelectionChanged = (
  settings: AppSettings,
  patch: AppSettingsPatch,
): boolean =>
  ENHANCEMENTS.some(
    (tool) => patch[tool] !== undefined && patch[tool] !== settings[tool],
  );
