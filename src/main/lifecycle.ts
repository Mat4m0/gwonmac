import { app } from "electron";
import { flushDiagnostics, log } from "./diagnostics.js";

export type CleanupTask = () => void | Promise<void>;

const cleanups: CleanupTask[] = [];
let quitting = false;

export function isQuitting(): boolean {
  return quitting;
}

export function onAppQuit(task: CleanupTask): () => void {
  cleanups.push(task);
  return () => {
    const i = cleanups.indexOf(task);
    if (i >= 0) cleanups.splice(i, 1);
  };
}

export async function runQuitCleanup(): Promise<void> {
  if (quitting) return;
  quitting = true;
  log("app", "info", "quit.cleanupStarted");
  const tasks = [...cleanups].reverse();
  cleanups.length = 0;
  for (const task of tasks) {
    try {
      await task();
    } catch (err) {
      log("app", "error", "quit.cleanupFailed", {
        message: err instanceof Error ? err.message : String(err),
      });
      console.error("quit cleanup failed", err);
    }
  }
  log("app", "info", "quit.cleanupCompleted");
  await flushDiagnostics();
}

/** Call before ready. Enables Chromium renderer sandboxing. */
export function enableSandboxBeforeReady(): void {
  app.enableSandbox();
}

export function wireLifecycle(): void {
  app.on("before-quit", (event) => {
    if (quitting) return;
    log("app", "info", "app.beforeQuit");
    event.preventDefault();
    void runQuitCleanup().finally(() => app.exit(0));
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
