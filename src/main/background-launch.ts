/**
 * The development-only background launch policy shared by app windows.
 *
 * Electron E2E tests create many real macOS windows. The test fixture enables
 * this policy so those windows keep rendering without appearing over the
 * developer's work. Focus-dependent tests disable it explicitly.
 */
import { app } from "electron";

export const BACKGROUND_LAUNCH =
  !app.isPackaged && process.env.GW_BACKGROUND_LAUNCH === "1";
