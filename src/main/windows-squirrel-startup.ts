/**
 * Own Squirrel.Windows lifecycle invocations before product windows or native
 * persistence are allowed to exist.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export const WINDOWS_SQUIRREL_EVENTS = [
  "--squirrel-install",
  "--squirrel-updated",
  "--squirrel-uninstall",
  "--squirrel-obsolete",
] as const;
export type WindowsSquirrelEvent = (typeof WINDOWS_SQUIRREL_EVENTS)[number];
export const WINDOWS_SQUIRREL_FIRST_RUN_GRACE_MS = 15_000;

export function windowsSquirrelFirstRun(argv: readonly string[]): boolean {
  return argv.includes("--squirrel-firstrun");
}

export function windowsSquirrelEvent(
  argv: readonly string[],
): WindowsSquirrelEvent | null {
  const events = WINDOWS_SQUIRREL_EVENTS.filter((event) => argv.includes(event));
  if (events.length > 1) throw new Error("conflicting Squirrel.Windows lifecycle events");
  return events[0] ?? null;
}

export function windowsSquirrelUpdateArguments(
  event: WindowsSquirrelEvent,
  executableName: string,
): readonly string[] | null {
  if (event === "--squirrel-obsolete") return null;
  return [
    event === "--squirrel-uninstall" ? "--removeShortcut" : "--createShortcut",
    executableName,
  ];
}

interface StartupDependencies {
  readonly argv: readonly string[];
  readonly execPath: string;
  readonly executableName: string;
  readonly quit: () => void;
  readonly spawnUpdate?: (
    executable: string,
    args: readonly string[],
  ) => Pick<ChildProcess, "unref">;
}

export function handleWindowsSquirrelStartup(
  dependencies: StartupDependencies,
): boolean {
  const event = windowsSquirrelEvent(dependencies.argv);
  if (event === null) return false;
  const args = windowsSquirrelUpdateArguments(event, dependencies.executableName);
  if (args !== null) {
    const update = path.win32.resolve(
      path.win32.dirname(dependencies.execPath),
      "..",
      "Update.exe",
    );
    const spawnUpdate = dependencies.spawnUpdate ?? ((executable, commandArgs) =>
      spawn(executable, commandArgs, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }));
    try {
      spawnUpdate(update, args).unref();
    } catch {
      // The installer owns recovery. Product startup must still remain closed.
    }
  }
  dependencies.quit();
  return true;
}
