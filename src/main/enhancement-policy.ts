import { app } from "electron";
import {
  ENHANCEMENTS,
  ENHANCEMENT_PROGRAMS,
  type AppSettings,
  type AppSettingsPatch,
  type EnhancementProgram,
  type EnhancementSelection,
} from "../shared/contracts.js";

export const ENHANCEMENT_AUTOMATION_ENABLED =
  !app.isPackaged && process.env.GW_ENHANCEMENT_AUTOMATION === "1";

const requestedProgram = process.env.GW_ENHANCEMENT_PROGRAM;

/**
 * Resolved once in main. This is intentionally independent from automation:
 * automation grants input/IPC capabilities, while the program chooses which
 * developer example is installed. Packaged applications always get `none`.
 */
export const DEVELOPER_ENHANCEMENT_PROGRAM: EnhancementProgram =
  !app.isPackaged
  && ENHANCEMENT_PROGRAMS.some((program) => program === requestedProgram)
    ? requestedProgram as EnhancementProgram
    : "none";

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
