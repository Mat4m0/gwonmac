import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const LIFECYCLE_ARGUMENTS = Object.freeze([
  "--squirrel-install",
  "--squirrel-updated",
  "--squirrel-uninstall",
  "--squirrel-obsolete",
] as const);

export type SquirrelLifecycleArgument = (typeof LIFECYCLE_ARGUMENTS)[number];

export interface SquirrelStartupEnvironment {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly execPath: string;
  readonly spawnProcess: (
    command: string,
    args: readonly string[],
    options: {
      readonly detached: true;
      readonly stdio: "ignore";
      readonly windowsHide: true;
    },
  ) => Pick<ChildProcess, "unref">;
}

export function squirrelLifecycleArgument(
  argv: readonly string[],
): SquirrelLifecycleArgument | null {
  const found = LIFECYCLE_ARGUMENTS.filter((argument) =>
    argv.includes(argument)
  );
  if (found.length > 1) {
    throw new Error("multiple Squirrel lifecycle arguments are invalid");
  }
  return found[0] ?? null;
}

export function handleSquirrelStartup(
  environment: SquirrelStartupEnvironment = {
    platform: process.platform,
    argv: process.argv.slice(1),
    execPath: process.execPath,
    spawnProcess: spawn,
  },
): boolean {
  if (environment.platform !== "win32") return false;
  const argument = squirrelLifecycleArgument(environment.argv);
  if (argument === null) return false;
  if (argument === "--squirrel-obsolete") return true;

  const updateExecutable = path.win32.resolve(
    path.win32.dirname(environment.execPath),
    "..",
    "Update.exe",
  );
  const shortcutAction = argument === "--squirrel-uninstall"
    ? "--removeShortcut"
    : "--createShortcut";
  const child = environment.spawnProcess(
    updateExecutable,
    [shortcutAction, path.win32.basename(environment.execPath)],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return true;
}
