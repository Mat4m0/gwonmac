/**
 * Quit ordering: the registry of cleanup tasks and the one pass that runs them.
 *
 * Tasks run in reverse registration order, so a subsystem is torn down before
 * whatever it was built on. The pass runs at most once and cannot be re-entered
 * by a second quit request, and a task that throws is recorded and stepped over
 * rather than abandoning the tasks behind it — a socket left open because a
 * settings write failed is exactly the quit that strands a process. Diagnostics
 * are flushed last, once every task has had its chance to record something.
 *
 * Sandbox enabling lives here for the same reason: it is the other thing that
 * must happen at a fixed point in the application's life, before `ready` or not
 * at all.
 */
import { app } from "electron";
import { errorCode } from "../shared/errors.js";
import { flushDiagnostics, logEvent } from "./diagnostics.js";

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
  logEvent({ k: "quit.cleanupStarted" });
  const tasks = [...cleanups].reverse();
  cleanups.length = 0;
  for (const task of tasks) {
    try {
      await task();
    } catch (err) {
      logEvent({ k: "quit.cleanupFailed", code: errorCode(err) });
      // The prose stays on the developer console, which is not exported.
      console.error("quit cleanup failed", err);
    }
  }
  logEvent({ k: "quit.cleanupCompleted" });
  await flushDiagnostics();
}

/** Call before ready. Enables Chromium renderer sandboxing. */
export function enableSandboxBeforeReady(): void {
  app.enableSandbox();
}

export function wireLifecycle(): void {
  app.on("before-quit", (event) => {
    if (quitting) return;
    logEvent({ k: "app.beforeQuit" });
    event.preventDefault();
    void runQuitCleanup().finally(() => app.exit(0));
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
