import { app } from "electron";

export const TOOLBOX_AUTOMATION_ENABLED =
  !app.isPackaged && process.env.GW_TOOLBOX_AUTOMATION === "1";
