import { readFileSync } from "node:fs";
import path from "node:path";

export const packageVersion = (
  JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
    version: string;
  }
).version;

declare global {
  var __resetRestart: {
    quit: boolean;
    relaunch: boolean;
    options: Electron.MessageBoxOptions | null;
    messages?: Electron.MessageBoxOptions[];
    originalQuit: Electron.App["quit"];
    originalRelaunch: Electron.App["relaunch"];
  };
  var __updateInstallCalls: number;
}
