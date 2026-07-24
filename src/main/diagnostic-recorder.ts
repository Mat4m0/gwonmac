import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  DiagnosticFields,
  DiagnosticHistogramSummary,
  DiagnosticLevel,
  DiagnosticSubsystem,
  DiagnosticSummary,
  RendererFrameBatch,
} from "../shared/diagnostics.js";
import { DIAGNOSTIC_BUCKETS_US } from "../shared/diagnostics.js";
import { gamePaths } from "./paths.js";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 2_048;
const MAX_FRAME_BYTES = 128 * 1024 * 1024;
const SENSITIVE_KEY =
  /pass|auth|cookie|token|secret|credential|username|email|account/i;
const ABSOLUTE_PATH =
  /(?<=[\s"'(=:])\/(?!\/)[^/\s"',;)}\]]+(?:\/[^/\s"',;)}\]]+)*/g;

export interface LogRecord {
  seq: number;
  tsUs: number;
  wallTime: string;
  level: DiagnosticLevel;
  subsystem: DiagnosticSubsystem;
  name: string;
  durationUs?: number;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  fields?: DiagnosticFields;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  end(fields?: DiagnosticFields, level?: DiagnosticLevel): number;
}

export interface CaptureMetadata {
  startedUs: number;
  endedUs: number;
  stopReason: "manual" | "automatic" | "buffer-full" | "export" | "shutdown";
  firstSequenceNumber: number;
  lastSequenceNumber: number;
}

class Histogram {
  private readonly buckets =
    Array<number>(DIAGNOSTIC_BUCKETS_US.length).fill(0);
  private total = 0;
  private sum = 0;
  private min = Number.POSITIVE_INFINITY;
  private max = 0;

  record(valueUs: number): void {
    if (!Number.isFinite(valueUs) || valueUs < 0) return;
    this.total += 1;
    this.sum += valueUs;
    this.min = Math.min(this.min, valueUs);
    this.max = Math.max(this.max, valueUs);
    const index = DIAGNOSTIC_BUCKETS_US.findIndex((limit) => valueUs <= limit);
    this.buckets[index < 0 ? this.buckets.length - 1 : index]! += 1;
  }

  merge(counts: number[], sumUs: number, minUs: number, maxUs: number): void {
    const count = counts.reduce((total, value) => total + value, 0);
    if (!count) return;
    counts.forEach((value, index) => {
      this.buckets[index]! += value;
    });
    this.total += count;
    this.sum += sumUs;
    this.min = Math.min(this.min, minUs);
    this.max = Math.max(this.max, maxUs);
  }

  summary(): DiagnosticHistogramSummary {
    const percentile = (percent: number): number => {
      if (!this.total) return 0;
      const wanted = Math.ceil(this.total * percent);
      let seen = 0;
      for (let index = 0; index < this.buckets.length; index++) {
        seen += this.buckets[index]!;
        if (seen >= wanted) return DIAGNOSTIC_BUCKETS_US[index]!;
      }
      return this.max;
    };
    return {
      count: this.total,
      minUs: this.total ? Math.round(this.min) : 0,
      maxUs: Math.round(this.max),
      meanUs: this.total ? Math.round(this.sum / this.total) : 0,
      p50Us: Math.round(percentile(0.5)),
      p95Us: Math.round(percentile(0.95)),
      p99Us: Math.round(percentile(0.99)),
    };
  }
}

export function redactDiagnosticText(value: string): string {
  return value
    .replaceAll(homedir(), "[home]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(
      /\b(password|authorization|cookie|token|secret)\b\s*[:=]\s*[^,\s}"']+/gi,
      "$1=[redacted]",
    )
    .replace(/([?&][^=\s"'&]+)=([^&#\s"',}]+)/g, "$1=[redacted]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    )
    .replace(ABSOLUTE_PATH, "[redacted-path]");
}

function redactFields(
  fields: DiagnosticFields | undefined,
): DiagnosticFields | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) =>
      SENSITIVE_KEY.test(key)
        ? []
        : [
            [
              key,
              typeof value === "string"
                ? redactDiagnosticText(value)
                : value,
            ],
          ],
    ),
  );
}

function canonicalEventName(value: string): string {
  return (
    redactDiagnosticText(value)
      .trim()
      .replace(/[^A-Za-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "") || "diagnostics.unnamed"
  );
}

export function runtimeVersions(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.versions).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export class FlightRecorder {
  readonly sessionId = randomUUID();
  readonly startedWall =
    new Date(Date.now() - process.uptime() * 1_000).toISOString();
  private readonly started =
    process.hrtime.bigint() -
    BigInt(Math.round(process.uptime() * 1_000_000_000));
  private readonly events: LogRecord[] = [];
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly latest: DiagnosticFields = {};
  private captureCounters: Map<string, number> | null = null;
  private captureHistograms: Map<string, Histogram> | null = null;
  private captureLatest: DiagnosticFields | null = null;
  private captureStartedUs = 0;
  private captureFirstSequenceNumber = 0;
  private captureStartedDroppedEvents = 0;
  private completedCapture: {
    metadata: CaptureMetadata;
    summary: DiagnosticSummary;
  } | null = null;
  private seq = 0;
  private droppedEvents = 0;
  private currentFile = "";
  private currentSize = 0;
  private ready: Promise<void> | null = null;
  private writes = Promise.resolve();
  private framesReady = false;
  private frameBytes = 0;

  timestampUs(): number {
    return Number((process.hrtime.bigint() - this.started) / 1_000n);
  }

  event(
    subsystem: DiagnosticSubsystem,
    level: DiagnosticLevel,
    name: string,
    fields?: DiagnosticFields,
    detail: Pick<
      LogRecord,
      "durationUs" | "traceId" | "spanId" | "parentSpanId"
    > & { timestampUs?: number } = {},
  ): void {
    const timestampUs = detail.timestampUs ?? this.timestampUs();
    const record: LogRecord = {
      seq: ++this.seq,
      tsUs: timestampUs,
      wallTime:
        new Date(
          Date.parse(this.startedWall) + timestampUs / 1_000,
        ).toISOString(),
      level,
      subsystem,
      name: canonicalEventName(name),
    };
    if (detail.durationUs !== undefined) record.durationUs = detail.durationUs;
    if (detail.traceId !== undefined) record.traceId = detail.traceId;
    if (detail.spanId !== undefined) record.spanId = detail.spanId;
    if (detail.parentSpanId !== undefined) {
      record.parentSpanId = detail.parentSpanId;
    }
    const safeFields = redactFields(fields);
    if (safeFields) record.fields = safeFields;
    if (this.events.length === MAX_EVENTS) {
      this.events.shift();
      this.count("diagnostics.evictedEvents");
    }
    this.events.push(record);
    this.writes = this.writes
      .then(() => this.append(record))
      .catch(() => {
        this.droppedEvents += 1;
      });
  }

  count(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
    if (this.captureCounters) {
      this.captureCounters.set(
        name,
        (this.captureCounters.get(name) ?? 0) + delta,
      );
    }
  }

  observe(name: string, durationUs: number): void {
    this.histogram(name).record(durationUs);
    this.captureHistogram(name)?.record(durationUs);
  }

  mergeHistogram(
    name: string,
    counts: number[],
    sumUs: number,
    minUs: number,
    maxUs: number,
  ): void {
    this.histogram(name).merge(counts, sumUs, minUs, maxUs);
    this.captureHistogram(name)?.merge(counts, sumUs, minUs, maxUs);
  }

  setLatest(name: string, value: string | number | boolean | null): void {
    this.latest[name] = value;
    if (this.captureLatest) this.captureLatest[name] = value;
  }

  setPeak(name: string, value: number): void {
    this.latest[name] = Math.max(Number(this.latest[name]) || 0, value);
    if (this.captureLatest) {
      this.captureLatest[name] = Math.max(
        Number(this.captureLatest[name]) || 0,
        value,
      );
    }
  }

  private histogram(name: string): Histogram {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram();
      this.histograms.set(name, histogram);
    }
    return histogram;
  }

  private captureHistogram(name: string): Histogram | null {
    if (!this.captureHistograms) return null;
    let histogram = this.captureHistograms.get(name);
    if (!histogram) {
      histogram = new Histogram();
      this.captureHistograms.set(name, histogram);
    }
    return histogram;
  }

  async beginCapture(): Promise<void> {
    await this.flush();
    await rm(
      path.join(gamePaths().diagnostics, `frames-${this.sessionId}.bin`),
      { force: true },
    );
    this.framesReady = false;
    this.frameBytes = 0;
    this.captureCounters = new Map();
    this.captureHistograms = new Map();
    this.captureLatest = {};
    this.captureStartedUs = this.timestampUs();
    this.captureFirstSequenceNumber = this.seq + 1;
    this.captureStartedDroppedEvents = this.droppedEvents;
    this.completedCapture = null;
  }

  endCapture(level: 1 | 2, stopReason: CaptureMetadata["stopReason"]): void {
    if (
      !this.captureCounters ||
      !this.captureHistograms ||
      !this.captureLatest
    ) {
      return;
    }
    const endedUs = this.timestampUs();
    this.completedCapture = {
      metadata: {
        startedUs: this.captureStartedUs,
        endedUs,
        stopReason,
        firstSequenceNumber: this.captureFirstSequenceNumber,
        lastSequenceNumber: this.seq,
      },
      summary: this.buildSummary(
        level,
        Math.max(0, Math.round((endedUs - this.captureStartedUs) / 1_000)),
        this.captureCounters,
        this.captureHistograms,
        this.captureLatest,
        this.droppedEvents - this.captureStartedDroppedEvents,
      ),
    };
    this.captureCounters = null;
    this.captureHistograms = null;
    this.captureLatest = null;
    this.captureStartedUs = 0;
    this.captureFirstSequenceNumber = 0;
    this.captureStartedDroppedEvents = 0;
  }

  captureResult(): {
    metadata: CaptureMetadata;
    summary: DiagnosticSummary;
  } | null {
    return this.completedCapture;
  }

  cancelCapture(): void {
    this.captureCounters = null;
    this.captureHistograms = null;
    this.captureLatest = null;
    this.captureStartedUs = 0;
    this.captureFirstSequenceNumber = 0;
    this.captureStartedDroppedEvents = 0;
  }

  span(
    subsystem: DiagnosticSubsystem,
    name: string,
    fields?: DiagnosticFields,
    parentSpanId?: string,
    traceId: string = randomUUID(),
    recordEvents = true,
  ): Span {
    const started = this.timestampUs();
    const spanId = randomUUID();
    if (recordEvents) {
      this.event(subsystem, "debug", `${name}.begin`, fields, {
        traceId,
        spanId,
        ...(parentSpanId ? { parentSpanId } : {}),
      });
    }
    let ended = false;
    return {
      traceId,
      spanId,
      end: (endFields, level = "debug") => {
        if (ended) return 0;
        ended = true;
        const durationUs = this.timestampUs() - started;
        this.observe(`${subsystem}.${name}`, durationUs);
        if (recordEvents || level !== "debug" || durationUs >= 50_000) {
          const completeFields =
            fields || endFields ? { ...fields, ...endFields } : undefined;
          this.event(subsystem, level, `${name}.end`, completeFields, {
            durationUs,
            traceId,
            spanId,
            ...(parentSpanId ? { parentSpanId } : {}),
          });
        }
        return durationUs;
      },
    };
  }

  summary(captureLevel: 0 | 1 | 2): DiagnosticSummary {
    return this.buildSummary(
      captureLevel,
      Math.round(this.timestampUs() / 1_000),
      this.counters,
      this.histograms,
      this.latest,
      this.droppedEvents,
    );
  }

  private buildSummary(
    captureLevel: 0 | 1 | 2,
    uptimeMs: number,
    counters: Map<string, number>,
    histograms: Map<string, Histogram>,
    latest: DiagnosticFields,
    droppedEvents: number,
  ): DiagnosticSummary {
    return {
      sessionId: this.sessionId,
      uptimeMs,
      captureLevel,
      droppedEvents,
      counters: Object.fromEntries(counters),
      histograms: Object.fromEntries(
        [...histograms].map(([name, histogram]) => [
          name,
          histogram.summary(),
        ]),
      ),
      latest: { ...latest },
    };
  }

  async flush(): Promise<void> {
    await this.writes;
  }

  async exportedEvents(): Promise<{
    text: string;
    firstSeq: number;
    lastSeq: number;
    firstTimestampUs: number;
    lastTimestampUs: number;
    completeFromStart: boolean;
  }> {
    await this.flush();
    const directory = gamePaths().diagnostics;
    const prefix = `session-${this.sessionId}`;
    const files = (await readdir(directory))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl"))
      .map((name) => path.join(directory, name));
    const records: LogRecord[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const line of text.split("\n")) {
        if (line) records.push(JSON.parse(line) as LogRecord);
      }
    }
    records.sort((left, right) => left.seq - right.seq);
    const first = records[0];
    const last = records.at(-1);
    return {
      text: records.map((record) => JSON.stringify(record)).join("\n"),
      firstSeq: first?.seq ?? 0,
      lastSeq: last?.seq ?? 0,
      firstTimestampUs: first?.tsUs ?? 0,
      lastTimestampUs: last?.tsUs ?? 0,
      completeFromStart:
        first?.seq === 1 &&
        records.every((record, index) => record.seq === index + 1),
    };
  }

  async appendFrames(batch: RendererFrameBatch): Promise<void> {
    if (!batch.data.length) return;
    const payloadBytes = batch.data.length * 8;
    if (this.frameBytes + payloadBytes > MAX_FRAME_BYTES) {
      this.droppedEvents += batch.data.length / batch.stride;
      return;
    }
    this.writes = this.writes.then(async () => {
      await this.ensureFile();
      const file = path.join(
        gamePaths().diagnostics,
        `frames-${this.sessionId}.bin`,
      );
      if (!this.framesReady) {
        const header = Buffer.alloc(16);
        header.write("GWFRAME1", 0, "ascii");
        header.writeUInt32LE(batch.stride, 8);
        await writeFile(file, header, { mode: 0o600 });
        this.framesReady = true;
        this.frameBytes = header.byteLength;
      }
      const bytes = Buffer.allocUnsafe(payloadBytes);
      batch.data.forEach((value, index) =>
        bytes.writeDoubleLE(value, index * 8),
      );
      await appendFile(file, bytes);
      this.frameBytes += bytes.byteLength;
    });
    await this.writes;
  }

  framePath(): string | null {
    return this.framesReady
      ? path.join(
          gamePaths().diagnostics,
          `frames-${this.sessionId}.bin`,
        )
      : null;
  }

  private async ensureFile(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const directory = gamePaths().diagnostics;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await this.pruneFiles(MAX_FILES - 1);
        this.currentFile = path.join(
          directory,
          `session-${this.sessionId}.jsonl`,
        );
        try {
          this.currentSize = (await stat(this.currentFile)).size;
        } catch {
          this.currentSize = 0;
        }
      })();
    }
    await this.ready;
  }

  private async append(record: LogRecord): Promise<void> {
    await this.ensureFile();
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.currentSize + bytes > MAX_FILE_BYTES) await this.roll();
    await appendFile(this.currentFile, line, { mode: 0o600 });
    this.currentSize += bytes;
  }

  private async roll(): Promise<void> {
    const directory = gamePaths().diagnostics;
    const stamped = path.join(
      directory,
      `session-${this.sessionId}-${Date.now()}.jsonl`,
    );
    try {
      await rename(this.currentFile, stamped);
    } catch {
      // No current file exists until the first append.
    }
    this.currentSize = 0;
    await this.pruneFiles(MAX_FILES - 1);
  }

  private async pruneFiles(keep: number): Promise<void> {
    const directory = gamePaths().diagnostics;
    const files = (await readdir(directory))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => path.join(directory, name));
    const dated = await Promise.all(
      files.map(async (file) => ({
        file,
        mtime: (await stat(file)).mtimeMs,
      })),
    );
    dated.sort((left, right) => right.mtime - left.mtime);
    await Promise.all(
      dated.slice(keep).map(({ file }) => rm(file, { force: true })),
    );
  }
}
