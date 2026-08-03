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
import { errorCode, GwError } from "../shared/errors.js";
import { flushDiagnostics, logEvent } from "./diagnostics.js";

export type CleanupTask = () => void | Promise<void>;

// A task that hangs must not strand the ones behind it — or the quit. Several
// cleanup steps await promises with no deadline of their own (a Steam sign-in
// sheet that quit itself would have closed, an in-flight client update), and
// before-quit cancels the default quit, so an unbounded task used to leave
// Cmd+Q doing nothing at all. Five seconds matches the renderer-command
// budget; a step that needs longer at quit is a bug in the step.
const TASK_TIMEOUT_MS = 5_000;

// The absolute ceiling between the quit request and process exit, cleanup
// finished or not. Liveness outranks tidiness: pressing quit must always
// quit.
const QUIT_WATCHDOG_MS = 15_000;

async function bounded(task: CleanupTask): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(task()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new GwError("quit_task_timeout", "quit cleanup task timed out"),
            ),
          TASK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
      await bounded(task);
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
    // preventDefault above makes app.exit the only way this process ends, so
    // it must not depend on cleanup settling: the watchdog exits regardless.
    const watchdog = setTimeout(() => app.exit(0), QUIT_WATCHDOG_MS);
    void runQuitCleanup().finally(() => {
      clearTimeout(watchdog);
      app.exit(0);
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
