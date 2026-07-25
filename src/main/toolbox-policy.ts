import { app } from "electron";
import type { AppSettings } from "../shared/contracts.js";

export const TOOLBOX_AUTOMATION_ENABLED =
  !app.isPackaged && process.env.GW_TOOLBOX_AUTOMATION === "1";

/**
 * The Toolbox serves a transformed WASM main, so it is chosen once per launch:
 * automation forces it on, and every other user opts in through `nativeCursor`.
 */
export const toolboxEnabledFor = (settings: AppSettings): boolean =>
  TOOLBOX_AUTOMATION_ENABLED || settings.nativeCursor;
