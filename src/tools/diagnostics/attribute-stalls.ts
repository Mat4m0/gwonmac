import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withCapture } from "./common.js";

const FRAME_MARK = "gw.frame.submit";
const SNAPSHOT_MARK = "gw.snapshot.resolve";
const DEFAULT_THRESHOLD_US = 100_000;

interface TraceEvent {
  name?: string;
  cat?: string;
  ph?: string;
  pid?: number;
  tid?: number;
  ts?: number;
  dur?: number;
  id?: string;
  args?: {
    data?: {
      startTime?: number;
      cpuProfile?: {
        nodes?: CpuNode[];
        samples?: number[];
      };
      timeDeltas?: number[];
    };
  };
}

interface CpuNode {
  id: number;
  parent?: number;
  callFrame?: {
    codeType?: string;
    functionName?: string;
    url?: string;
  };
}

interface CpuSample {
  atUs: number;
  weightUs: number;
  nodeId: number;
  nodes: Map<number, CpuNode>;
}

export interface StallAttribution {
  startUs: number;
  endUs: number;
  durationUs: number;
  snapshotResolutions: number;
  sampledUs: number;
  categories: Array<{ name: string; timeUs: number }>;
  leaves: Array<{ name: string; timeUs: number }>;
  stacks: Array<{ name: string; timeUs: number }>;
  traceEvents: Array<{ name: string; durationUs: number }>;
}

export interface StallAttributionReport {
  frameMarks: number;
  thresholdUs: number;
  stalls: StallAttribution[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function traceEvents(value: unknown): TraceEvent[] {
  if (!isRecord(value) || !Array.isArray(value.traceEvents)) {
    throw new Error("Chromium trace has no traceEvents array");
  }
  return value.traceEvents.filter(isRecord) as TraceEvent[];
}

function profileKey(event: TraceEvent): string {
  return `${event.pid}:${event.id ?? ""}`;
}

function cpuSamples(events: TraceEvent[], rendererPid: number): CpuSample[] {
  const starts = new Map<string, number>();
  const clocks = new Map<string, number>();
  const nodes = new Map<string, Map<number, CpuNode>>();
  const samples: CpuSample[] = [];

  for (const event of events) {
    if (event.pid !== rendererPid || event.name !== "Profile") continue;
    const start = event.args?.data?.startTime;
    if (typeof start !== "number" || !Number.isFinite(start)) continue;
    const key = profileKey(event);
    starts.set(key, start);
    clocks.set(key, start);
    nodes.set(key, new Map());
  }

  for (const event of events) {
    if (event.pid !== rendererPid || event.name !== "ProfileChunk") continue;
    const key = profileKey(event);
    const nodeMap = nodes.get(key);
    let clock = clocks.get(key) ?? starts.get(key);
    if (!nodeMap || clock === undefined) continue;
    const data = event.args?.data;
    for (const node of data?.cpuProfile?.nodes ?? []) {
      if (Number.isSafeInteger(node.id)) nodeMap.set(node.id, node);
    }
    const ids = data?.cpuProfile?.samples ?? [];
    const deltas = data?.timeDeltas ?? [];
    for (let index = 0; index < Math.min(ids.length, deltas.length); index++) {
      const delta = deltas[index];
      const nodeId = ids[index];
      if (
        typeof delta !== "number"
        || !Number.isFinite(delta)
        || delta < 0
        || typeof nodeId !== "number"
        || !Number.isSafeInteger(nodeId)
      ) {
        continue;
      }
      clock += delta;
      samples.push({ atUs: clock, weightUs: delta, nodeId, nodes: nodeMap });
    }
    clocks.set(key, clock);
  }
  return samples;
}

function nodeLabel(node: CpuNode | undefined): string {
  if (!node) return "(unknown)";
  const frame = node.callFrame;
  const name = frame?.functionName || "(anonymous)";
  if (frame?.codeType === "wasm") return name;
  if (!frame?.url) return name;
  const file = frame.url.split("/").at(-1);
  return file ? `${name} (${file})` : name;
}

function stackFor(sample: CpuSample): CpuNode[] {
  const stack: CpuNode[] = [];
  const seen = new Set<number>();
  let current = sample.nodes.get(sample.nodeId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    stack.push(current);
    current = current.parent === undefined
      ? undefined
      : sample.nodes.get(current.parent);
  }
  return stack.reverse();
}

function categoryFor(stack: CpuNode[]): string {
  const names = stack.map((node) => node.callFrame?.functionName ?? "");
  if (names.includes("(idle)")) return "idle";
  if (names.some((name) => /garbage|gc|scavenge|mark-compact/i.test(name))) {
    return "garbage collection";
  }
  if (
    names.some((name) =>
      /compile|compiler|turbofan|liftoff|baseline|tier-up/i.test(name)
    )
  ) {
    return "compilation";
  }
  if (stack.some((node) => node.callFrame?.codeType === "wasm")) return "WASM";
  if (stack.some((node) => node.callFrame?.codeType === "JS")) return "JavaScript";
  return "other";
}

function ranked(
  totals: Map<string, number>,
  limit = 8,
): Array<{ name: string; timeUs: number }> {
  return [...totals]
    .map(([name, timeUs]) => ({ name, timeUs }))
    .sort((left, right) => right.timeUs - left.timeUs)
    .slice(0, limit);
}

export function attributeTraceStalls(
  value: unknown,
  thresholdUs = DEFAULT_THRESHOLD_US,
): StallAttributionReport {
  if (!Number.isFinite(thresholdUs) || thresholdUs <= 0) {
    throw new Error("stall threshold must be a positive number");
  }
  const events = traceEvents(value);
  const frames = events
    .filter(
      (event) =>
        event.name === FRAME_MARK
        && typeof event.ts === "number"
        && Number.isFinite(event.ts)
        && Number.isSafeInteger(event.pid),
    )
    .sort((left, right) => left.ts! - right.ts!);
  if (frames.length < 2) {
    return { frameMarks: frames.length, thresholdUs, stalls: [] };
  }
  const rendererPid = frames[0]!.pid!;
  const rendererTid = frames[0]!.tid;
  const samples = cpuSamples(events, rendererPid);
  const snapshotTimes = events
    .filter(
      (event) =>
        event.pid === rendererPid
        && event.name === SNAPSHOT_MARK
        && typeof event.ts === "number",
    )
    .map((event) => event.ts!)
    .sort((left, right) => left - right);
  const stalls: StallAttribution[] = [];

  for (let index = 1; index < frames.length; index++) {
    const startUs = frames[index - 1]!.ts!;
    const endUs = frames[index]!.ts!;
    const durationUs = endUs - startUs;
    if (durationUs <= thresholdUs) continue;
    const categories = new Map<string, number>();
    const leaves = new Map<string, number>();
    const stacks = new Map<string, number>();
    let sampledUs = 0;
    for (const sample of samples) {
      if (sample.atUs <= startUs || sample.atUs > endUs) continue;
      const stack = stackFor(sample);
      const leaf = nodeLabel(stack.at(-1));
      const stackName = stack
        .filter((node) => node.callFrame?.functionName !== "(root)")
        .map(nodeLabel)
        .join(" → ");
      sampledUs += sample.weightUs;
      categories.set(
        categoryFor(stack),
        (categories.get(categoryFor(stack)) ?? 0) + sample.weightUs,
      );
      leaves.set(leaf, (leaves.get(leaf) ?? 0) + sample.weightUs);
      stacks.set(stackName, (stacks.get(stackName) ?? 0) + sample.weightUs);
    }
    const overlappingTraceEvents = events
      .filter((event) => {
        if (
          event.pid !== rendererPid
          || event.tid !== rendererTid
          || event.ph !== "X"
          || typeof event.ts !== "number"
          || typeof event.dur !== "number"
          || event.name === "ProfileChunk"
        ) {
          return false;
        }
        return event.ts < endUs && event.ts + event.dur > startUs;
      })
      .map((event) => ({
        name: event.name ?? "(unnamed)",
        durationUs: Math.max(
          0,
          Math.min(endUs, event.ts! + event.dur!) - Math.max(startUs, event.ts!),
        ),
      }))
      .sort((left, right) => right.durationUs - left.durationUs)
      .slice(0, 8);
    stalls.push({
      startUs,
      endUs,
      durationUs,
      snapshotResolutions: snapshotTimes.filter(
        (timestamp) => timestamp > startUs && timestamp <= endUs,
      ).length,
      sampledUs,
      categories: ranked(categories),
      leaves: ranked(leaves),
      stacks: ranked(stacks, 5),
      traceEvents: overlappingTraceEvents,
    });
  }
  return { frameMarks: frames.length, thresholdUs, stalls };
}

function milliseconds(valueUs: number): string {
  return `${(valueUs / 1000).toFixed(1)} ms`;
}

function printReport(report: StallAttributionReport): void {
  console.log(`Frame marks   ${report.frameMarks}`);
  console.log(`Threshold     ${milliseconds(report.thresholdUs)}`);
  console.log(`Long stalls   ${report.stalls.length}`);
  if (!report.frameMarks) {
    console.log("No trace-aligned frame marks; record a new Level 2 capture.");
    return;
  }
  for (const [index, stall] of report.stalls.entries()) {
    console.log("");
    console.log(
      `Stall ${index + 1}       ${milliseconds(stall.durationUs)}; `
      + `${stall.snapshotResolutions} snapshot resolutions`,
    );
    console.log(`CPU sampled   ${milliseconds(stall.sampledUs)}`);
    for (const category of stall.categories) {
      console.log(
        `  ${category.name.padEnd(18)} ${milliseconds(category.timeUs)}`,
      );
    }
    console.log("Hot leaves");
    for (const leaf of stall.leaves) {
      console.log(`  ${milliseconds(leaf.timeUs).padEnd(10)} ${leaf.name}`);
    }
    console.log("Hot stacks");
    for (const stack of stall.stacks) {
      console.log(`  ${milliseconds(stack.timeUs).padEnd(10)} ${stack.name}`);
    }
    console.log("Longest renderer events");
    for (const event of stall.traceEvents) {
      console.log(`  ${milliseconds(event.durationUs).padEnd(10)} ${event.name}`);
    }
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: pnpm diagnostics:attribute-stalls <capture.gwdiag> [threshold-ms]");
    process.exitCode = 2;
  } else {
    const thresholdMs = process.argv[3] === undefined
      ? DEFAULT_THRESHOLD_US / 1000
      : Number(process.argv[3]);
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
      throw new Error("threshold-ms must be a positive number");
    }
    await withCapture(input, async (capture, root) => {
      if (
        capture.manifest.captureLevel !== 2
        || !capture.manifest.includedFiles.includes("chromium-trace.json")
      ) {
        throw new Error("stall attribution requires a Level 2 Chromium capture");
      }
      const trace = JSON.parse(
        await readFile(path.join(root, "chromium-trace.json"), "utf8"),
      ) as unknown;
      printReport(attributeTraceStalls(trace, thresholdMs * 1000));
    });
  }
}
