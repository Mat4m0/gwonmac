import { app } from "electron";
import {
  TOOLBOX_TOOLS,
  type AppSettings,
  type AppSettingsPatch,
  type ToolboxSelection,
} from "../shared/contracts.js";

export const TOOLBOX_AUTOMATION_ENABLED =
  !app.isPackaged && process.env.GW_TOOLBOX_AUTOMATION === "1";

/**
 * There is deliberately no stored `toolboxEnabled` master switch. "Is the
 * Toolbox active" is *derived* below from "is any tool on", so the two cannot
 * disagree — a persisted master flag could say no while a tool it governs says
 * yes, and nothing would be able to tell which one the session obeyed.
 */
export const toolboxEnabledFor = (settings: AppSettings): boolean =>
  TOOLBOX_AUTOMATION_ENABLED || TOOLBOX_TOOLS.some((tool) => settings[tool]);

/** Copy only the selected tools into the launch contract. */
export const toolboxSelectionFor = (
  settings: AppSettings,
): ToolboxSelection =>
  Object.fromEntries(
    TOOLBOX_TOOLS.map((tool) => [tool, settings[tool]]),
  ) as ToolboxSelection;

/**
 * Whether a settings write asks for a different set of tools than the ones
 * this launch was started with. Because the module is chosen before the
 * renderer exists, a `true` here is a change the running session cannot honour
 * — so the write and a relaunch have to be one action.
 */
export const toolboxSelectionChanged = (
  settings: AppSettings,
  patch: AppSettingsPatch,
): boolean =>
  TOOLBOX_TOOLS.some(
    (tool) => patch[tool] !== undefined && patch[tool] !== settings[tool],
  );
