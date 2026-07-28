import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
} from "../src/tools/enhancement-doctor.js";
import type { AutomationCommand } from "../src/shared/automation.js";
import {
  parseEnhancementObservations,
} from "../src/tools/enhancement-observations.js";
import {
  countFunctionImports,
  sectionById,
  splitSections,
} from "../src/main/core/wasm-binary.js";
import {
  HERO_MAPPING_FUNCTIONS,
  liveRunPlan,
  liveRunRefusal,
  scenarioContext,
} from "./enhancements-live/scenarios.js";
import type { ObservationSample } from "./enhancements-live/scenarios.js";
import { waitForPlayable } from "./enhancements-live/session.js";
import {
  createWasmBreakpointObserver,
  parseBreakpointFunctions,
} from "./enhancements-live/wasm-breakpoints.js";
import {
  validateCommonAcceptance,
} from "./enhancements-live/acceptance.js";
import {
  assertMutationRecoveryClear,
} from "./enhancements-live/mutation-journal.js";
import { acquireLiveSession } from "./enhancements-live/live-session.js";
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
const observeArgument = process.argv.indexOf("--observe");
const observations = parseEnhancementObservations(
  observeArgument >= 0 ? process.argv[observeArgument + 1] ?? null : null,
);
const breakFunctionsArgument = process.argv.indexOf("--break-functions");
const breakpointFunctions = breakFunctionsArgument >= 0
  ? parseBreakpointFunctions(process.argv[breakFunctionsArgument + 1] ?? null)
  : plan.name === "hero-map"
    ? [...HERO_MAPPING_FUNCTIONS]
    : [];
if (plan.name === "hero-trace" && breakpointFunctions.length === 0) {
  console.error("hero-trace requires --break-functions index[,index]");
  process.exit(2);
}
const preflight = await inspectEnhancementWorkspace(userData);
const blocked = liveRunRefusal(plan, preflight, { cachedOnly: !allowUpdate });
if (blocked) {
  console.error(JSON.stringify({ preflight, blocked }));
  process.exit(2);
}
if (plan.mutates) await assertMutationRecoveryClear();
const expectedBuildId = preflight.client.buildId;
if (expectedBuildId === null) {
  console.error(JSON.stringify({ preflight, blocked: "client-build-unknown" }));
  process.exit(2);
}
const failureDir = path.join(root, "test-results", "enhancements-live");
const liveSession = await acquireLiveSession(userData, plan.name);

let child: ReturnType<typeof spawn>;
try {
  child = spawn(
    electronBin,
    [".", "--remote-debugging-port=0"],
    {
      cwd: root,
      env: plan.env,
      stdio: plan.stdio,
    },
  );
  await liveSession.update({ childPid: child.pid ?? null });
} catch (error) {
  await liveSession.release();
  throw error;
}

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

async function sampleObservations(
  targetPage: Page,
): Promise<ObservationSample[]> {
  if (observations.length === 0) return [];
  return targetPage.evaluate((requested) => {
    // The runtime is declared as an open record, so the module's memory arrives
    // untyped; `WebAssembly.Memory` is the thing being asked for, and asking
    // for it is also the check that the Enhancement is installed at all.
    const memory = window.gwCompanionRuntime?.memory;
    if (!(memory instanceof WebAssembly.Memory)) return [];
    const view = new DataView(memory.buffer);
    const widths = { u8: 1, u16: 2, u32: 4, i32: 4, f32: 4 };
    return requested.map(({ type, address }) => {
      const width = widths[type];
      if (address + width > view.byteLength) {
        return { type, address, value: null, valid: false };
      }
      let value: number;
      if (type === "u8") value = view.getUint8(address);
      else if (type === "u16") value = view.getUint16(address, true);
      else if (type === "u32") value = view.getUint32(address, true);
      else if (type === "i32") value = view.getInt32(address, true);
      else value = view.getFloat32(address, true);
      return {
        type,
        address,
        value: Number.isFinite(value) ? value : null,
        valid: Number.isFinite(value),
      };
    });
  }, observations);
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
await liveSession.update({ endpoint, state: "connected" });

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
try {
  await liveSession.update({ state: "running" });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Electron exposed no browser context");
  const page = context.pages()[0] ?? await context.waitForEvent("page");
  failurePage = page;
  const cdp = await context.newCDPSession(page);
  const wasmBreakpoints = breakpointFunctions.length > 0
    ? await (async () => {
        const wasm = await readFile(
          path.join(userData, "game", "artifacts", "Gw.jspi.wasm"),
        );
        const imports = sectionById(splitSections(wasm), 2);
        return createWasmBreakpointObserver(
          cdp,
          countFunctionImports(imports),
          breakpointFunctions,
        );
      })()
    : null;
  await cdp.send("Performance.enable");
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  let login = await waitForPlayable(page, plan.tier);
  if (plan.name === "reload") {
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = await waitForPlayable(page, plan.tier);
    login = {
      inputs: login.inputs + reloaded.inputs,
      checkpoints: [...login.checkpoints, ...reloaded.checkpoints],
    };
  }

  const before = await page.evaluate(() => ({
    tickCount: window.gwCompanionState?.tickCount ?? null,
    at: performance.now(),
  }));
  await page.waitForTimeout(2_000);
  const cadence = await page.evaluate((start) => {
    // The Enhancement can be gone by the second read — a reload, or a client that
    // tore the hook down — and reading through it unguarded made that a page
    // TypeError that said nothing. No tick count means no ticks measured, the
    // same answer the first read already gives for the same state.
    const tickCount = window.gwCompanionState?.tickCount ?? null;
    return {
      ticks: start.tickCount === null || tickCount === null
        ? 0
        : tickCount >= start.tickCount
          ? tickCount - start.tickCount
          : tickCount + (2 ** 32 - start.tickCount),
      elapsedMs: performance.now() - start.at,
    };
  }, before);
  const observationsBefore = await sampleObservations(page);
  const capabilities = {
    page,
    cdp,
    sendAutomationCommand,
    sampleObservations: observations.length > 0
      ? () => sampleObservations(page)
      : null,
    wasmBreakpoints,
  };
  // The tier decides both halves at once, so the automation capabilities cannot
  // reach an observation scenario even by mistake.
  const scenarioEvidence = selectedScenario.tier === "automation"
    ? await selectedScenario.run(scenarioContext("automation", capabilities))
    : await selectedScenario.run(scenarioContext("observation", capabilities));

  // Assembled once rather than mutated onto the projection: the projection is
  // what the page reported, and these are what the runner knows about it.
  const result = {
    ...await projectLiveResult(page, cadence, plan.name),
    tier: plan.tier,
    login,
    ...(scenarioEvidence ? { evidence: scenarioEvidence } : {}),
    ...(observations.length > 0
      ? {
          observations: {
            before: observationsBefore,
            after: await sampleObservations(page),
          },
        }
      : {}),
    preflight: {
      cached: !allowUpdate,
      snapshotComplete: preflight.snapshot?.complete === true,
      transformedCache: preflight.client.transformedCache,
      targetReadout: preflight.targetReadout,
    },
    rendererErrors: [...rendererErrors],
  };
  failureResult = result;
  validateCommonAcceptance(result, expectedBuildId, {
    coreObservation: plan.tier === "automation",
  });
  selectedScenario.validate(result);
  console.log(JSON.stringify(result));
  if (plan.name === "hero-map") {
    await mkdir(failureDir, { recursive: true });
    await writeFile(
      path.join(failureDir, "hero-mapping.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  if (leaveOpen) {
    await liveSession.update({ state: "passed" });
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
    await liveSession.release();
  }
} catch (error) {
  keepAlive = true;
  await liveSession.update({ state: "failed" });
  await mkdir(failureDir, { recursive: true });
  if (failurePage && !failurePage.isClosed()) {
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
await liveSession.release();
