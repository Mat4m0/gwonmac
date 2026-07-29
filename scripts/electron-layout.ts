import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";

export interface PackagedElectronLayout {
  readonly application: string;
  readonly asar: string;
  readonly executable: string;
  readonly resources: string;
}

export function developmentElectronExecutable(
  root: string,
  platform = process.platform,
): string {
  const dist = path.join(root, "node_modules", "electron", "dist");
  if (platform === "darwin") {
    return path.join(dist, "Electron.app", "Contents", "MacOS", "Electron");
  }
  if (platform === "win32") return path.join(dist, "electron.exe");
  if (platform === "linux") return path.join(dist, "electron");
  throw new Error(`unsupported Electron development platform: ${platform}`);
}

export function packagedElectronLayout(
  root: string,
  platform = process.platform,
  arch = process.arch,
): PackagedElectronLayout {
  const output = path.join(root, "out", `Guild Wars-${platform}-${arch}`);
  if (platform === "darwin") {
    const application = path.join(output, "Guild Wars.app");
    const resources = path.join(application, "Contents", "Resources");
    return {
      application,
      asar: path.join(resources, "app.asar"),
      executable: path.join(application, "Contents", "MacOS", "Guild Wars"),
      resources,
    };
  }
  if (platform === "win32" || platform === "linux") {
    const resources = path.join(output, "resources");
    return {
      application: output,
      asar: path.join(resources, "app.asar"),
      executable: path.join(
        output,
        platform === "win32" ? "Guild Wars.exe" : "Guild Wars",
      ),
      resources,
    };
  }
  throw new Error(`unsupported packaged Electron platform: ${platform}`);
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("close", closed);
      resolve(false);
    }, timeoutMs);
    const closed = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", closed);
  });
}

/**
 * Stop a test-owned native child without making its POSIX signal part of the
 * assertion contract. Returns only once the process has exited.
 */
export async function terminateTestChild(
  child: ChildProcess,
  timeoutMs = 5_000,
): Promise<void> {
  if (await waitForClose(child, 0)) return;
  child.kill();
  if (await waitForClose(child, timeoutMs)) return;

  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    await waitForClose(killer, timeoutMs);
  } else {
    child.kill("SIGKILL");
  }
  if (!(await waitForClose(child, timeoutMs))) {
    throw new Error("test child did not exit after platform-native termination");
  }
}
