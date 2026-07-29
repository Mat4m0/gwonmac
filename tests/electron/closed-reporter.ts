import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type ClosedStatus = "passed" | "failed" | "skipped" | "timed-out" | "interrupted";

interface ClosedResult {
  readonly title: string;
  readonly source: string;
  readonly attempt: number;
  readonly durationMs: number;
  readonly status: ClosedStatus;
}

function closedStatus(status: TestResult["status"]): ClosedStatus {
  if (status === "timedOut") return "timed-out";
  return status;
}

/** A bounded result inventory that never copies assertion values or error text. */
export default class ClosedReporter implements Reporter {
  private readonly outputFile: string;
  private readonly results: ClosedResult[] = [];

  constructor(options: { outputFile: string }) {
    this.outputFile = options.outputFile;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results.push({
      title: test.titlePath().filter((part) => part.length > 0).join(" › "),
      source: `${path.relative(process.cwd(), test.location.file)}:${test.location.line}`,
      attempt: result.retry,
      durationMs: result.duration,
      status: closedStatus(result.status),
    });
  }

  onEnd(result: FullResult): void {
    const counts = {
      passed: 0,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      interrupted: 0,
    };
    for (const test of this.results) {
      if (test.status === "timed-out") counts.timedOut += 1;
      else counts[test.status] += 1;
    }
    const document = JSON.stringify(
      {
        formatVersion: 1,
        status: result.status,
        counts,
        results: this.results,
      },
      null,
      2,
    );
    if (Buffer.byteLength(document) > 256 * 1024) {
      throw new Error("closed Playwright result summary exceeded 256 KiB");
    }
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, document, { encoding: "utf8", mode: 0o600 });
  }
}
