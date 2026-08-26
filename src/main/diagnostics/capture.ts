/**
 * The capture session: its level, its deadline, and the raw Chromium trace it
 * may leave on disk.
 *
 * The active level is what the rest of the subsystem asks before recording
 * anything a capture pays for, and the level the export declares is a second
 * value on purpose — it survives the stop so an export after the fact still
 * describes the capture it is exporting. Both are owned here; nothing else
 * assigns them.
 */
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { contentTracing, type BrowserWindow, type WebContents } from "electron";
import type { RendererCommand } from "../../shared/contracts.js";
import { errorCode } from "../../shared/errors.js";
import { gamePaths } from "../paths.js";
import { sendRendererCommand } from "../renderer-commands.js";
import { windowRegistry } from "../window-registry.js";
import type { CaptureMetadata } from "./flight-recorder.js";
import { logEvent, recorder } from "./recorder.js";
import { resetEventLoopWindow } from "./samplers.js";

let captureLevel: 0 | 1 | 2 = 0;
let recordedLevel: 0 | 1 | 2 = 0;
let recordedOwnerId: number | null = null;
let tracePath = "";
let lastTracePath = "";
let lastTraceOwnerId: number | null = null;
let traceGuard: ReturnType<typeof setInterval> | null = null;
let captureTimer: ReturnType<typeof setTimeout> | null = null;
let captureStopPromise: Promise<void> | null = null;
let captureStartPromise: Promise<void> | null = null;
let captureStoppedHandler: ((win: BrowserWindow) => void | Promise<void>) | null = null;

interface CaptureOwner {
  readonly win: BrowserWindow;
  readonly contents: WebContents;
  readonly diagnosticOwnerId: number;
  readonly stopped: () => void;
}

let captureOwner: CaptureOwner | null = null;

function registeredGameWindow(win: BrowserWindow): boolean {
  const id = win.webContents.id;
  return windowRegistry.windowForWebContents(id) === win
    && windowRegistry.contextForWebContents(id)?.role === "game";
}

function releaseCaptureOwner(owner: CaptureOwner): void {
  owner.win.off("closed", owner.stopped);
  owner.contents.off("render-process-gone", owner.stopped);
  if (captureOwner === owner) captureOwner = null;
}

function ownCapture(win: BrowserWindow): CaptureOwner {
  const contents = win.webContents;
  const diagnosticOwnerId = windowRegistry.diagnosticOwnerForWindow(win);
  if (diagnosticOwnerId === null) {
    throw new Error("diagnostics capture requires an account owner");
  }
  const owner: CaptureOwner = {
    win,
    contents,
    diagnosticOwnerId,
    stopped: () => {
      void stopDiagnosticCapture("owner-gone");
    },
  };
  captureOwner = owner;
  win.once("closed", owner.stopped);
  contents.once("render-process-gone", owner.stopped);
  return owner;
}

/** The level a capture is running at right now, `0` when none is. */
export function activeCaptureLevel(): 0 | 1 | 2 {
  return captureLevel === 2 && traceGuard === null ? 0 : captureLevel;
}

/** A renderer only observes the capture that it owns. */
export function captureLevelForWindow(win: BrowserWindow): 0 | 1 | 2 {
  return captureOwner?.win === win ? activeCaptureLevel() : 0;
}

/** Whether window-local evidence belongs in the active capture. */
export function captureOwnsWebContents(id: number): boolean {
  return captureOwner?.contents.id === id && activeCaptureLevel() !== 0;
}

/** Whether account-local evidence belongs in the active capture. */
export function captureOwnsDiagnosticOwner(ownerId: number): boolean {
  return captureOwner?.diagnosticOwnerId === ownerId && activeCaptureLevel() !== 0;
}

/** The level an export declares: the last capture's, not the live one's. */
export function exportedCaptureLevel(ownerId: number): 0 | 1 | 2 {
  return ownerId === recordedOwnerId ? recordedLevel : 0;
}

/** The completed raw trace an export sanitizes, or `""` when there is none. */
export function completedTracePath(ownerId: number): string {
  return ownerId === lastTraceOwnerId ? lastTracePath : "";
}

/**
 * The renderer half of a capture. `level` crosses as a number inside a typed
 * event rather than spliced into a string of JavaScript. Its explicit owner is
 * retained for the whole capture; later focus changes cannot retarget it.
 */
const rendererCaptureCommand = (
  win: BrowserWindow,
  command: Extract<RendererCommand, { type: "diagnostics.capture" }>,
): Promise<void> =>
  sendRendererCommand(win, command).then((outcome) => {
    if (outcome !== "completed") {
      const ownerId = windowRegistry.diagnosticOwnerForWindow(win);
      if (ownerId === null) return;
      logEvent({
        k: "renderer.commandIncomplete",
        action: command.action,
        outcome,
      }, ownerId);
    }
  });

export function markPerformanceProblem(win: BrowserWindow): void {
  if (!registeredGameWindow(win)) return;
  const owner = captureOwner?.win ?? win;
  if (owner !== win) return;
  const ownerId = windowRegistry.diagnosticOwnerForWindow(owner);
  if (ownerId === null) return;
  logEvent({ k: "performance.problemMarked" }, ownerId);
  void rendererCaptureCommand(owner, {
    type: "diagnostics.capture",
    action: "problem-marked",
  });
}

export function setDiagnosticCaptureStoppedHandler(
  handler: ((win: BrowserWindow) => void | Promise<void>) | null,
): void {
  captureStoppedHandler = handler;
}

async function stopTrace(ownerId: number): Promise<boolean> {
  if (!tracePath) return false;
  if (traceGuard) clearInterval(traceGuard);
  traceGuard = null;
  const target = tracePath;
  try {
    await contentTracing.stopRecording(target);
    tracePath = "";
    lastTracePath = target;
    lastTraceOwnerId = ownerId;
    // Size is the first thing anyone asks after an export goes wrong.
    const bytes = await stat(target).then((info) => info.size, () => 0);
    recorder.setLatest("capture.traceBytes", bytes, ownerId);
    logEvent({ k: "chromiumTrace.stopped", bytes }, ownerId);
    return true;
  } catch (err) {
    logEvent({ k: "chromiumTrace.stopFailed", code: errorCode(err) }, ownerId);
    // A failed stop cannot produce a trustworthy Chromium trace. Delete the
    // exact target now, but retain it in `tracePath` if deletion itself fails
    // so quit or the next capture can retry instead of orphaning it.
    try {
      await rm(target, { force: true });
      tracePath = "";
    } catch {
      // The target remains tracked. A new capture refuses to replace it until
      // `discardTrace` can remove it.
    }
    return false;
  }
}

/**
 * A Level 2 trace is tens to hundreds of megabytes. Remove it by the exact
 * path we hold — never a glob, and never anything a session still needs.
 */
export async function discardTrace(): Promise<void> {
  const targets = [...new Set([tracePath, lastTracePath].filter(Boolean))];
  for (const target of targets) {
    // Clear a pointer only after its exact target is gone. In particular,
    // starting another Level 2 capture must not overwrite the only reference
    // to a partial target left by a failed stop.
    await rm(target, { force: true });
    if (tracePath === target) tracePath = "";
    if (lastTracePath === target) lastTracePath = "";
    if (!lastTracePath) lastTraceOwnerId = null;
  }
}

export function startDiagnosticCapture(
  win: BrowserWindow,
  level: 1 | 2,
): Promise<void> {
  if (captureLevel !== 0 || captureStopPromise || captureStartPromise) {
    return Promise.reject(new Error("a diagnostics capture is already active"));
  }
  if (!registeredGameWindow(win)) {
    return Promise.reject(
      new Error("diagnostics capture requires a registered game window"),
    );
  }
  if (level === 2 && windowRegistry.gameWindows().length !== 1) {
    return Promise.reject(
      new Error("Chromium tracing requires exactly one open game window"),
    );
  }
  const owner = ownCapture(win);
  const operation = (async () => {
    // Beginning a capture replaces the previous capture result. Its raw trace
    // must be deleted first; clearing only the pointer would orphan a file that
    // can contain Chromium process data.
    await discardTrace();
    await rendererCaptureCommand(win, {
      type: "diagnostics.capture",
      action: "reset",
    });
    await recorder.beginCapture(owner.diagnosticOwnerId);
    resetEventLoopWindow();
    captureLevel = level;
    await rendererCaptureCommand(win, {
      type: "diagnostics.capture",
      action: "started",
      level,
    });
    captureTimer = setTimeout(() => {
      void stopDiagnosticCapture("automatic");
    }, 120_000);
    logEvent({ k: "capture.started", level }, owner.diagnosticOwnerId);
    recordedLevel = level;
    if (level !== 2) return;

    try {
      const available = new Set(await contentTracing.getCategories());
      const wanted = [
        "electron",
        "blink",
        "blink.user_timing",
        "cc",
        "gpu",
        "viz",
        "net",
        "v8",
        "disabled-by-default-v8.cpu_profiler",
      ];
      const included = wanted.filter((category) => available.has(category));
      tracePath = path.join(
        gamePaths().diagnostics,
        `chromium-${recorder.sessionId}.json`,
      );
      await contentTracing.startRecording({
        included_categories: included,
        recording_mode: "record-until-full",
        trace_buffer_size_in_kb: 256 * 1024,
        enable_argument_filter: true,
      });
      traceGuard = setInterval(() => {
        void contentTracing.getTraceBufferUsage().then((usage) => {
          if (usage.percentage >= 0.8) {
            void stopDiagnosticCapture("buffer-full");
          }
        });
      }, 1_000);
    } catch (error) {
      if (captureTimer) clearTimeout(captureTimer);
      captureTimer = null;
      captureLevel = 0;
      await rendererCaptureCommand(win, {
        type: "diagnostics.capture",
        action: "stopped",
      });
      // `startRecording` may have created the target before rejecting. Remove
      // it by the tracked exact path; if cleanup itself fails, keep the pointer
      // so shutdown or the next capture can retry.
      await discardTrace().catch(() => undefined);
      recordedLevel = 0;
      recordedOwnerId = null;
      recorder.cancelCapture();
      logEvent(
        { k: "chromiumTrace.startFailed", code: errorCode(error) },
        owner.diagnosticOwnerId,
      );
      throw error;
    }
  })();
  captureStartPromise = operation
    .catch((error: unknown) => {
      releaseCaptureOwner(owner);
      throw error;
    })
    .finally(() => {
      captureStartPromise = null;
    });
  return captureStartPromise;
}

export function stopDiagnosticCapture(
  reason: CaptureMetadata["stopReason"] = "manual",
): Promise<void> {
  if (captureStopPromise) return captureStopPromise;
  if (captureStartPromise) {
    return captureStartPromise.then(
      () => stopDiagnosticCapture(reason),
      () => undefined,
    );
  }
  if (captureLevel === 0) return Promise.resolve();
  const owner = captureOwner;
  if (!owner) return Promise.reject(new Error("diagnostics capture has no owner"));
  const stoppedLevel = captureLevel;
  captureStopPromise = (async () => {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = null;
    await rendererCaptureCommand(owner.win, {
      type: "diagnostics.capture",
      action: "flush",
    });
    const traceCompleted = await stopTrace(owner.diagnosticOwnerId);
    const completedLevel =
      stoppedLevel === 2 && !traceCompleted ? 1 : stoppedLevel;
    recordedLevel = completedLevel;
    recordedOwnerId = owner.diagnosticOwnerId;
    logEvent({
      k: "capture.stopped",
      level: completedLevel,
      reason,
    }, owner.diagnosticOwnerId);
    recorder.endCapture(completedLevel, reason);
    captureLevel = 0;
    await rendererCaptureCommand(owner.win, {
      type: "diagnostics.capture",
      action: "stopped",
    });
    if (
      captureStoppedHandler &&
      (reason === "manual" ||
        reason === "automatic" ||
        reason === "buffer-full")
    ) {
      queueMicrotask(() => void captureStoppedHandler?.(owner.win));
    }
  })().finally(() => {
    releaseCaptureOwner(owner);
    captureStopPromise = null;
  });
  return captureStopPromise;
}

export function stopDiagnosticCaptureForWindow(
  win: BrowserWindow,
  reason: CaptureMetadata["stopReason"] = "manual",
): Promise<void> {
  if (!registeredGameWindow(win)) {
    return Promise.reject(
      new Error("diagnostics capture requires a registered game window"),
    );
  }
  if (captureOwner && captureOwner.win !== win) {
    return Promise.reject(
      new Error("diagnostics capture belongs to another game window"),
    );
  }
  return stopDiagnosticCapture(reason);
}
