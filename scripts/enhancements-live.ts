import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
// The sources, not `build/`. Importing the compiled copy made the contract a
// second source of truth: a stale `build/` typechecked against a
// `EnhancementDoctorReport` that no longer existed. `pnpm enhancements:live` loads this
// file under `scripts/ts-hook.mjs`, which is what lets a `.js` specifier reach
// the `.ts` beside it.
import {
  defaultGuildWarsProfile,
  inspectEnhancementWorkspace,
} from "../src/tools/enhancement-workspace.js";
import type { AutomationCommand } from "../src/shared/automation.js";
import {
  liveRunPlan,
  liveRunRefusal,
  scenarioContext,
  waitForPlayable,
} from "./enhancements-live/scenarios.js";
import type { GraphicsProbeSample } from "./enhancements-live/scenarios.js";
import {
  validateCommonAcceptance,
} from "./enhancements-live/acceptance.js";
import { projectLiveResult } from "./enhancements-live/result.js";

type Shutdown = { code: number | null; signal: NodeJS.Signals | null };

if (process.env.GW_LIVE_SMOKE !== "1") {
  console.error("enhancements:live requires GW_LIVE_SMOKE=1");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBin = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const userData = defaultGuildWarsProfile();
const leaveOpen = process.argv.includes("--leave-open");
const allowUpdate = process.argv.includes("--allow-update");
const scenarioArgument = process.argv.indexOf("--scenario");
const scenario = scenarioArgument >= 0
  ? process.argv[scenarioArgument + 1]
  : "target";
// `--scenario` with nothing after it names no scenario, and is refused by the
// same line that refuses a misspelled one.
const plan = scenario === undefined ? null : liveRunPlan(scenario, {
  baseEnv: process.env,
  userData,
  cachedOnly: !allowUpdate,
});
if (!plan) {
  console.error(`unknown Enhancement live scenario: ${scenario}`);
  process.exit(2);
}
const selectedScenario = plan.scenario;
const preflight = await inspectEnhancementWorkspace(
  userData,
  plan.scenario.program,
);
const blocked = liveRunRefusal(plan, preflight, { cachedOnly: !allowUpdate });
if (blocked) {
  console.error(JSON.stringify({ preflight, blocked }));
  process.exit(2);
}
const expectedBuildId = preflight.client.buildId;
if (expectedBuildId === null) {
  console.error(JSON.stringify({ preflight, blocked: "client-build-unknown" }));
  process.exit(2);
}
const failureDir = path.join(root, "test-results", "enhancements-live");
const graphicsRunId = new Date().toISOString().replaceAll(/[:.]/g, "-");
const graphicsDir = path.join(
  root,
  "test-results",
  "graphics-live",
  graphicsRunId,
);

const child = spawn(
  electronBin,
  [".", "--remote-debugging-port=0"],
  {
    cwd: root,
    env: plan.env,
    stdio: plan.stdio,
  },
);

// The two piped streams the plan asked for. Every tier pipes both, so this is
// a launch failure rather than a tier difference.
const { stdout, stderr } = child;
if (!stdout || !stderr) {
  throw new Error("Electron was spawned without piped output");
}

// Only an automation run has a channel to send on; observation runs are spawned
// without one, so this is never handed to an observation scenario.
function sendAutomationCommand(command: AutomationCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    child.send(command, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
let processOutput = "";
const captureProcessOutput = (chunk: Buffer) => {
  processOutput = `${processOutput}${chunk.toString()}`.slice(
    -MAX_PROCESS_OUTPUT_BYTES,
  );
};
stdout.on("data", captureProcessOutput);
stderr.on("data", captureProcessOutput);

/**
 * Electron announces its debugging endpoint on stderr once. Rejects if the app
 * exits first, so a launch that fails outright is not a thirty-second wait.
 */
function debuggingEndpoint(errorStream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Electron did not expose its debugging endpoint")),
      30_000,
    );
    const inspect = (chunk: Buffer) => {
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(chunk.toString());
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolve(match[1]);
    };
    errorStream.on("data", inspect);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Electron exited before connection (${code}/${signal})`));
    });
  });
}

function waitForExit(): Promise<Shutdown> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

const endpoint = await debuggingEndpoint(stderr);

let browser: Browser | undefined;
// The page the failure handler screenshots, which is the only reason a handle
// has to outlive the run. The run itself holds the page as a `const`, so the
// sampler it hands a scenario closes over a page that is definitely there.
let failurePage: Page | null = null;
const rendererErrors: string[] = [];
let keepAlive = leaveOpen;
// What the failure handler writes out. It is set as soon as the run has a
// readout, so a run that fails its acceptance still reports the readout it
// failed on.
let failureResult: unknown = null;
let graphicsCaptureCount = 0;
try {
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Electron exposed no browser context");
  const page = context.pages()[0] ?? await context.waitForEvent("page");
  failurePage = page;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  let loginInputs = await waitForPlayable(
    page,
    plan.tier,
    plan.scenario.readiness,
  );
  if (plan.name === "reload") {
    await page.reload({ waitUntil: "domcontentloaded" });
    loginInputs += await waitForPlayable(
      page,
      plan.tier,
      plan.scenario.readiness,
    );
  }

  const before = await page.evaluate(() => {
    const state = window.gwCompanionState;
    return {
      tickCount: state?.status === "ready" ? state.tickCount : null,
      at: performance.now(),
    };
  });
  await page.waitForTimeout(2_000);
  const cadence = await page.evaluate((start) => {
    // The Enhancement can be gone by the second read — a reload, or a client that
    // tore the hook down — and reading through it unguarded made that a page
    // TypeError that said nothing. No tick count means no ticks measured, the
    // same answer the first read already gives for the same state.
    const state = window.gwCompanionState;
    const tickCount = state?.status === "ready" ? state.tickCount : null;
    return {
      ticks: start.tickCount === null || tickCount === null
        ? 0
        : tickCount >= start.tickCount
          ? tickCount - start.tickCount
          : tickCount + (2 ** 32 - start.tickCount),
      elapsedMs: performance.now() - start.at,
    };
  }, before);
  const capabilities = {
    page,
    cdp,
    captureGraphicsFrame: async (sample: GraphicsProbeSample) => {
      await mkdir(graphicsDir, { recursive: true });
      graphicsCaptureCount += 1;
      const stem = `capture-${String(graphicsCaptureCount).padStart(3, "0")}`;
      const screenshot = `${stem}.png`;
      await page.screenshot({ path: path.join(graphicsDir, screenshot) });
      await writeFile(
        path.join(graphicsDir, `${stem}.json`),
        JSON.stringify(sample, null, 2),
      );
      return screenshot;
    },
    sendAutomationCommand,
  };
  if (plan.name === "graphics-probe") {
    console.log(`Graphics evidence directory: ${graphicsDir}`);
  }
  // The tier decides both halves at once, so the automation capabilities cannot
  // reach an observation scenario even by mistake.
  const scenarioEvidence = selectedScenario.tier === "automation"
    ? await selectedScenario.run(scenarioContext("automation", capabilities))
    : selectedScenario.tier === "graphics-observation"
      ? await selectedScenario.run(
          scenarioContext("graphics-observation", capabilities),
        )
      : await selectedScenario.run(scenarioContext("observation", capabilities));

  // Assembled once rather than mutated onto the projection: the projection is
  // what the page reported, and these are what the runner knows about it.
  const result = {
    ...await projectLiveResult(page, cadence, plan.name),
    tier: plan.tier,
    loginInputs,
    ...(scenarioEvidence ? { evidence: scenarioEvidence } : {}),
    preflight: {
      cached: !allowUpdate,
      snapshotComplete: preflight.snapshot?.complete === true,
      transformedCache: preflight.client.transformedCache,
    },
    rendererErrors: [...rendererErrors],
  };
  failureResult = result;
  validateCommonAcceptance(result, expectedBuildId, {
    enhancementExpected: plan.scenario.program !== "none",
    coreObservation: plan.scenario.program === "target-observer",
  });
  selectedScenario.validate(result);
  if (plan.name === "graphics-probe") {
    await mkdir(graphicsDir, { recursive: true });
    await writeFile(
      path.join(graphicsDir, "evidence.json"),
      JSON.stringify(result.evidence, null, 2),
    );
  }
  console.log(JSON.stringify(result));

  if (leaveOpen) {
    console.log("Enhancement live acceptance passed; leaving Electron open.");
    keepAlive = true;
  } else {
    if (!page.isClosed()) {
      await page
        .evaluate(() => window.gwNative.app.requestQuit())
        .catch((error: unknown) => {
          if (!page.isClosed()) throw error;
        });
    }
    const shutdown = child.exitCode !== null || child.signalCode !== null
      ? { code: child.exitCode, signal: child.signalCode }
      : await waitForExit();
    if (shutdown.code !== 0 || shutdown.signal !== null) {
      throw new Error(`unclean shutdown: ${JSON.stringify(shutdown)}`);
    }
    console.log(JSON.stringify({ shutdown: "clean" }));
  }
} catch (error) {
  keepAlive = true;
  await mkdir(failureDir, { recursive: true });
  // Every Toolbox-program scenario can expose visible chat, so none records
  // pixels on failure.
  if (
    plan.scenario.program !== "toolbox-foundation"
    && failurePage
    && !failurePage.isClosed()
  ) {
    await failurePage
      .screenshot({ path: path.join(failureDir, "failure.png") })
      .catch(() => undefined);
  }
  await writeFile(
    path.join(failureDir, "failure.json"),
    JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      result: failureResult,
      rendererErrors,
      processOutput,
    }),
  );
  console.error(error);
  console.error("Electron was left open; no active download was interrupted.");
  process.exitCode = 1;
} finally {
  if (!keepAlive) await browser?.close().catch(() => undefined);
}

if (keepAlive && child.exitCode === null) {
  await waitForExit();
}
