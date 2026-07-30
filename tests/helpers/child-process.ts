import type { ChildProcess } from "node:child_process";

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) return true;

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

export async function stopChildProcess(
  child: ChildProcess,
  timeoutMs = 5_000,
): Promise<void> {
  if (hasExited(child)) return;

  child.kill("SIGTERM");
  if (await waitForExit(child, timeoutMs)) return;

  child.kill("SIGKILL");
  if (!(await waitForExit(child, timeoutMs))) {
    throw new Error("child process did not exit after SIGKILL");
  }
}
