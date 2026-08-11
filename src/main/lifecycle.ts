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

/**
 * How long the whole pass may take before the process leaves anyway.
 *
 * A quit request is answered by cancelling the quit and running cleanup, so
 * until cleanup finishes the application is still there — and Cmd+Q, having
 * already been consumed, looks like it did nothing. Every task is meant to be
 * quick, but two of them are not bounded by anything of their own: the
 * renderer filesystem sync waits out `RENDERER_COMMAND_TIMEOUT_MS`, and the
 * client shutdown awaits an in-flight game update. This is the ceiling on all
 * of it, chosen to sit above one renderer command and below the point where a
 * person presses Cmd+Q a second time.
 */
export const QUIT_CLEANUP_DEADLINE_MS = 6_000;

export async function runQuitCleanup(): Promise<void> {
  if (quitting) return;
  quitting = true;
  logEvent({ k: "quit.cleanupStarted" });
  const tasks = [...cleanups].reverse();
  cleanups.length = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timed-out">((resolve) => {
    deadline = setTimeout(() => resolve("timed-out"), QUIT_CLEANUP_DEADLINE_MS);
  });
  const pass = (async () => {
    for (const task of tasks) {
      try {
        await task();
      } catch (err) {
        logEvent({ k: "quit.cleanupFailed", code: errorCode(err) });
        // The prose stays on the developer console, which is not exported.
        console.error("quit cleanup failed", err);
      }
    }
  })();
  const outcome = await Promise.race([pass.then(() => "completed" as const), expired]);
  // A task still running past the deadline keeps running; nothing here can
  // cancel it. What the deadline buys is that the process no longer waits for
  // it, and that the record says which of the two happened.
  logEvent(
    outcome === "completed"
      ? { k: "quit.cleanupCompleted" }
      : { k: "quit.cleanupTimedOut" },
  );
  try {
    // The final write is part of cleanup, not an operation after it. Reuse the
    // same deadline so a recorder blocked on the filesystem cannot strand the
    // process after every registered task has already been bounded.
    await Promise.race([flushDiagnostics(), expired]);
  } catch (err) {
    // There is nowhere durable left to report a recorder failure. Keep the
    // developer console useful without making diagnostics a prerequisite for
    // quitting or installing an already-downloaded update.
    console.error("quit diagnostics flush failed", err);
  } finally {
    clearTimeout(deadline);
  }
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
