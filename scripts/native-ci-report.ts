import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STEP_OUTCOMES = new Set(["success", "failure", "skipped", "cancelled"]);
const RESULT_STATUSES = new Set([
  "passed",
  "failed",
  "skipped",
  "timed-out",
  "interrupted",
]);

interface StepResult {
  readonly name: string;
  readonly outcome: string;
}

interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  interrupted: number;
}

interface ClosedTestSummary {
  readonly suite: "stable" | "fault";
  readonly counts: TestCounts;
  readonly earliestFailure?: {
    readonly title: string;
    readonly source: string;
    readonly status: string;
  };
}

function assertToken(value: string, pattern: RegExp, name: string): void {
  if (!pattern.test(value)) throw new Error(`invalid ${name}`);
}

export function parseSteps(values: readonly string[]): StepResult[] {
  return values.map((value) => {
    const separator = value.indexOf("=");
    const name = value.slice(0, separator);
    const outcome = value.slice(separator + 1);
    assertToken(name, /^[a-z][a-z0-9-]*$/u, "step name");
    if (!STEP_OUTCOMES.has(outcome)) throw new Error("invalid step outcome");
    return { name, outcome };
  });
}

function emptyCounts(): TestCounts {
  return {
    passed: 0,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
  };
}

function safeString(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

async function readClosedSummary(
  root: string,
  suite: "stable" | "fault",
): Promise<ClosedTestSummary | undefined> {
  const summaryPath = path.join(
    root,
    "test-results",
    `electron-${suite}`,
    "summary.json",
  );
  let document: string;
  try {
    document = await readFile(summaryPath, "utf8");
  } catch {
    return undefined;
  }
  if (Buffer.byteLength(document) > 256 * 1024) {
    throw new Error(`${suite} result summary exceeded 256 KiB`);
  }
  const parsed = JSON.parse(document) as {
    formatVersion?: unknown;
    counts?: Record<string, unknown>;
    results?: Array<Record<string, unknown>>;
  };
  if (parsed.formatVersion !== 1 || !parsed.counts || !Array.isArray(parsed.results)) {
    throw new Error(`invalid ${suite} result summary`);
  }
  const counts = emptyCounts();
  for (const key of Object.keys(counts) as Array<keyof TestCounts>) {
    const value = parsed.counts[key];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error(`invalid ${suite} result count`);
    }
    counts[key] = value as number;
  }
  const failed = parsed.results.find((result) =>
    result.status !== "passed" && result.status !== "skipped");
  let earliestFailure: ClosedTestSummary["earliestFailure"];
  if (failed) {
    if (
      !safeString(failed.title, /^[^\r\n]{1,240}$/u)
      || !safeString(failed.source, /^[A-Za-z0-9_./-]+:[1-9][0-9]*$/u)
      || !safeString(failed.status, /^[a-z-]+$/u)
      || !RESULT_STATUSES.has(failed.status)
    ) {
      throw new Error(`unsafe ${suite} failure summary`);
    }
    earliestFailure = {
      title: failed.title,
      source: failed.source,
      status: failed.status,
    };
  }
  return { suite, counts, ...(earliestFailure ? { earliestFailure } : {}) };
}

function validateIdentity(
  target: string,
  sha: string,
  runId: string,
  attempt: string,
): void {
  assertToken(target, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "target");
  assertToken(sha, /^[0-9a-f]{40}$/u, "commit SHA");
  assertToken(runId, /^[1-9][0-9]*$/u, "run ID");
  assertToken(attempt, /^[1-9][0-9]*$/u, "run attempt");
}

async function collect(
  root: string,
  target: string,
  sha: string,
  runId: string,
  attempt: string,
  steps: StepResult[],
): Promise<void> {
  validateIdentity(target, sha, runId, attempt);
  const summaries = (
    await Promise.all([
      readClosedSummary(root, "stable"),
      readClosedSummary(root, "fault"),
    ])
  ).filter((summary): summary is ClosedTestSummary => summary !== undefined);
  const document = JSON.stringify(
    {
      formatVersion: 1,
      target,
      sha,
      runId: Number(runId),
      runAttempt: Number(attempt),
      steps,
      earliestFailedStep: steps.find((step) => step.outcome === "failure")?.name
        ?? null,
      testSummaries: summaries,
    },
    null,
    2,
  );
  if (Buffer.byteLength(document) > 256 * 1024) {
    throw new Error("native failure manifest exceeded 256 KiB");
  }
  const output = path.join(root, "test-results", "failure-manifest.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, document, { encoding: "utf8", mode: 0o600 });
}

async function summarize(
  root: string,
  target: string,
  sha: string,
  runId: string,
  attempt: string,
  steps: StepResult[],
): Promise<void> {
  validateIdentity(target, sha, runId, attempt);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) throw new Error("GITHUB_STEP_SUMMARY is unavailable");
  const summaries = (
    await Promise.all([
      readClosedSummary(root, "stable"),
      readClosedSummary(root, "fault"),
    ])
  ).filter((summary): summary is ClosedTestSummary => summary !== undefined);
  const counts = summaries.reduce((total, summary) => {
    for (const key of Object.keys(total) as Array<keyof TestCounts>) {
      total[key] += summary.counts[key];
    }
    return total;
  }, emptyCounts());
  const failure = steps.find((step) => step.outcome === "failure");
  const testFailure = summaries.find((summary) => summary.earliestFailure)
    ?.earliestFailure;
  const artifactName = target === "linux-x64-keyring"
    ? `linux-keyring-test-results-${runId}-${attempt}`
    : `native-test-results-${target}-${runId}-${attempt}`;
  const lines = [
    `## Native verification: ${target}`,
    "",
    `- Commit: \`${sha}\``,
    `- Run attempt: ${attempt}`,
    `- Tests: ${counts.passed} passed, ${counts.failed + counts.timedOut} failed, `
      + `${counts.skipped} skipped, 0 flaky`,
    `- Earliest failed step: ${failure?.name ?? "none"}`,
    `- Earliest failed test: ${testFailure?.title ?? "none"}`,
    `- Failure evidence: ${failure ? artifactName : "not created"}`,
    "",
  ];
  await appendFile(summaryPath, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  const [command, target, sha, runId, attempt, ...stepValues] = process.argv.slice(2);
  if (
    (command !== "collect" && command !== "summary")
    || !target
    || !sha
    || !runId
    || !attempt
  ) {
    throw new Error(
      "usage: native-ci-report.ts <collect|summary> <target> <sha> "
        + "<run-id> <attempt> <step=outcome>...",
    );
  }
  const steps = parseSteps(stepValues);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (command === "collect") {
    await collect(root, target, sha, runId, attempt, steps);
  } else {
    await summarize(root, target, sha, runId, attempt, steps);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
