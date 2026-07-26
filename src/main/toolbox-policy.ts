import { app } from "electron";
import type { AppSettings, AppSettingsPatch } from "../shared/contracts.js";

export const TOOLBOX_AUTOMATION_ENABLED =
  !app.isPackaged && process.env.GW_TOOLBOX_AUTOMATION === "1";

/** The settings a tool may be declared as: the boolean ones, and only those. */
type BooleanSetting = {
  [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never;
}[keyof AppSettings];

/**
 * The tool registry. This array is the only place a Toolbox tool is declared:
 * adding one is an entry here plus its `AppSettings` key, and removing one is
 * the reverse.
 *
 * There is deliberately no stored `toolboxEnabled` master switch. "Is the
 * Toolbox active" is *derived* below from "is any tool on", so the two cannot
 * disagree — a persisted master flag could say no while a tool it governs says
 * yes, and nothing would be able to tell which one the session obeyed.
 *
 * `nativeCursor` repairs a visible defect, so it is the one tool that ships on
 * (`DEFAULT_SETTINGS`). Every tool added later defaults off.
 */
export const TOOLBOX_TOOLS = [
  "nativeCursor",
] as const satisfies readonly BooleanSetting[];

export type ToolboxTool = (typeof TOOLBOX_TOOLS)[number];

/**
 * The Toolbox serves a transformed WASM main, so it is chosen once per launch:
 * automation forces it on, and every other user gets it from their own tools.
 */
export const toolboxEnabledFor = (settings: AppSettings): boolean =>
  TOOLBOX_AUTOMATION_ENABLED || TOOLBOX_TOOLS.some((tool) => settings[tool]);

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
