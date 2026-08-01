/**
 * `pnpm diagnostics:attribute-frames`: attributes long visible-frame gaps in a
 * Level 1 capture to what the main process was doing around them.
 *
 * Level 1 is where gains are judged, because Level 2 traces are
 * profiler-contaminated — but until this, a Level 1 stall could be seen and not
 * explained. The join runs against main-process timestamps because the main
 * process keeps running while the renderer is frozen, so its clock is the
 * reliable side.
 *
 * A gap it cannot account for is reported as uninstrumented rather than
 * assigned to the nearest event. Continuous per-sample telemetry is excluded
 * from consideration outright: something that is always happening explains
 * nothing.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withCapture } from "./common.js";

const DEFAULT_THRESHOLD_US = 100_000;
const CORRELATION_US = 1_500_000;
const BLOCKED_MAIN_US = 200_000;

// Per-sample telemetry, emitted continuously and never the reason for a stall.
const NOISE =
  /^(process\.(chromium|main)|eventLoop\.sample|socket\.rendererSend|renderer\.metrics|read\.(begin|end)|clock\.synchronized)$/;
const WINDOW_STATE = /^window\./;

export type StallCause =
  | "composition"
  | "mainProcess"
  | "renderer"
  | "uninstrumented";

export interface FrameStall {
  startUs: number;
  endUs: number;
  durationUs: number;
  cause: StallCause;
  windowEvents: string[];
  events: string[];
  mainLoopMaxUs: number;
}

export interface FrameStallReport {
  visibleFrames: number;
  thresholdUs: number;
  instrumented: boolean;
  stalls: FrameStall[];
}

interface RecorderEvent {
  tsUs: number;
  name: string;
  fields?: Record<string, unknown> | null;
}

/** Visible-frame timestamps, in the order `frames.bin` records them. */
export function visibleFrameTimestamps(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = new TextDecoder("ascii").decode(bytes.subarray(0, 8));
  if (bytes.byteLength < 16 || format !== "GWFRAME1") {
    throw new Error("frames.bin header is invalid");
  }
  const stride = view.getUint32(8, true);
  if (stride !== 7 || (bytes.byteLength - 16) % (stride * 8) !== 0) {
    throw new Error("frames.bin stride or length is invalid");
  }
  const records = (bytes.byteLength - 16) / (stride * 8);
  const timestamps: number[] = [];
  for (let record = 0; record < records; record++) {
    const base = 16 + record * stride * 8;
    if (view.getFloat64(base + 6 * 8, true) === 0) continue;
    timestamps.push(view.getFloat64(base, true));
  }
  return timestamps;
}

export function parseRecorderEvents(text: string): RecorderEvent[] {
  const events: RecorderEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as RecorderEvent;
      if (typeof value?.tsUs === "number" && typeof value?.name === "string") {
        events.push(value);
      }
    } catch {
      // A torn final line is normal in a rolled log.
    }
  }
  return events;
}

export function attributeFrameStalls(
  frames: Uint8Array,
  events: RecorderEvent[],
  options: { thresholdUs?: number; instrumented?: boolean } = {},
): FrameStallReport {
  const thresholdUs = options.thresholdUs ?? DEFAULT_THRESHOLD_US;
  if (!Number.isFinite(thresholdUs) || thresholdUs <= 0) {
    throw new Error("stall threshold must be a positive number");
  }
  const instrumented = options.instrumented ?? false;
  const timestamps = visibleFrameTimestamps(frames);
  const stalls: FrameStall[] = [];

  for (let index = 1; index < timestamps.length; index++) {
    const startUs = timestamps[index - 1]!;
    const endUs = timestamps[index]!;
    const durationUs = endUs - startUs;
    if (durationUs <= thresholdUs) continue;
    const near = events.filter(
      (event) =>
        event.tsUs > startUs - CORRELATION_US &&
        event.tsUs < endUs + CORRELATION_US,
    );
    const windowEvents = near
      .filter((event) => WINDOW_STATE.test(event.name))
      .map((event) => `${event.name}@${(event.tsUs / 1e6).toFixed(2)}s`);
    const mainLoopMaxUs = near
      .filter((event) => event.name === "eventLoop.sample")
      .reduce((worst, event) => {
        const value = Number(event.fields?.maxUs ?? 0);
        return Number.isFinite(value) ? Math.max(worst, value) : worst;
      }, 0);
    stalls.push({
      startUs,
      endUs,
      durationUs,
      // Order matters: a window that stopped being composited explains a stall
      // that looks identical to a real one, so it is checked first.
      cause: !instrumented
        ? "uninstrumented"
        : windowEvents.length
          ? "composition"
          : mainLoopMaxUs > BLOCKED_MAIN_US
            ? "mainProcess"
            : "renderer",
      windowEvents,
      events: near
        .filter(
          (event) => !NOISE.test(event.name) && !WINDOW_STATE.test(event.name),
        )
        .map((event) => `${event.name}@${(event.tsUs / 1e6).toFixed(2)}s`),
      mainLoopMaxUs,
    });
  }
  return {
    visibleFrames: timestamps.length,
    thresholdUs,
    instrumented,
    stalls,
  };
}

const EXPLANATION: Record<StallCause, string> = {
  composition:
    "the window stopped being composited — measurement artifact, not a game stall",
  mainProcess: "the main process was blocked",
  renderer: "the renderer stalled with nothing else busy",
  uninstrumented: "this capture predates window-state recording",
};

function milliseconds(valueUs: number): string {
  return `${(valueUs / 1000).toFixed(1)} ms`;
}

function printReport(report: FrameStallReport): void {
  console.log(`Visible frames ${report.visibleFrames}`);
  console.log(`Threshold      ${milliseconds(report.thresholdUs)}`);
  console.log(`Stalls         ${report.stalls.length}`);
  if (!report.instrumented) {
    console.log(
      "Window state   not recorded in this capture; causes are inconclusive.",
    );
  }
  for (const stall of report.stalls) {
    console.log("");
    console.log(
      `Stall ${milliseconds(stall.durationUs)} at ${(stall.startUs / 1e6).toFixed(2)}s`,
    );
    console.log(`  cause        ${stall.cause} — ${EXPLANATION[stall.cause]}`);
    if (stall.windowEvents.length) {
      console.log(`  window       ${stall.windowEvents.join(", ")}`);
    }
    console.log(`  main loop max ${milliseconds(stall.mainLoopMaxUs)}`);
    for (const event of stall.events.slice(0, 8)) {
      console.log(`  event        ${event}`);
    }
    if (stall.events.length > 8) {
      console.log(`  … ${stall.events.length - 8} more nearby events`);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const input = process.argv[2];
  if (!input) {
    console.error(
      "usage: pnpm diagnostics:attribute-frames <capture.gwdiag> [threshold-ms]",
    );
    process.exitCode = 2;
  } else {
    const thresholdMs =
      process.argv[3] === undefined
        ? DEFAULT_THRESHOLD_US / 1000
        : Number(process.argv[3]);
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
      throw new Error("threshold-ms must be a positive number");
    }
    await withCapture(input, async (capture, root) => {
      if (!capture.manifest.includedFiles.includes("frames.bin")) {
        throw new Error("frame attribution requires a Level 1 or 2 capture");
      }
      printReport(
        attributeFrameStalls(
          new Uint8Array(await readFile(path.join(root, "frames.bin"))),
          parseRecorderEvents(
            await readFile(path.join(root, "events.jsonl"), "utf8"),
          ),
          {
            thresholdUs: thresholdMs * 1000,
            instrumented:
              capture.summary.latest["renderer.focused"] !== undefined,
          },
        ),
      );
    });
  }
}
