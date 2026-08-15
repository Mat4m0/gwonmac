/**
 * The developer-only Enhancement switches and the shipped Core selection.
 *
 * Both switches are read from the environment and both are refused in a
 * packaged application, so no shipped build can be talked into automation
 * capabilities or a developer example by the environment it was started in.
 * They stay independent on purpose: automation grants input and IPC
 * capabilities, the program chooses which example is installed, and neither
 * implies the other.
 *
 */
import { app } from "electron";
import {
  type AppSettings,
} from "../../shared/contracts.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  ENHANCEMENT_PROGRAMS,
  enhancementCapabilitiesFor,
  type EnhancementCapabilities,
  type EnhancementProgram,
  type EnhancementSelection,
} from "../../shared/enhancement-contracts.js";

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

/** Core is required product behavior, not a persisted player preference. */
export const enhancementSelectionFor = (
  settings: AppSettings,
): EnhancementSelection => Object.freeze({
  nativeCursor: true,
  tools: settings.gwonmacTools,
});

/** The exact features this launch asks main to put in the served module. */
export function requestedEnhancementCapabilities(
  settings: AppSettings,
  program: EnhancementProgram,
): EnhancementCapabilities {
  if (program !== "none") {
    return enhancementCapabilitiesFor(enhancementSelectionFor(settings), program);
  }
  if (!settings.gwonmacTools) return ENHANCEMENT_CAPABILITY_PROFILES.cursor;
  return ENHANCEMENT_CAPABILITY_PROFILES.cursorTargetPartyCommandsStorage;
}
