import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  defaultGuildWarsProfile,
  inspectToolboxWorkspace,
} from "../build/tools/toolbox-doctor.js";
import {
  parseToolboxObservations,
} from "../build/tools/toolbox-observations.js";
import {
  liveRunPlan,
  liveRunRefusal,
  scenarioContext,
  waitForPlayable,
} from "./toolbox-live/scenarios.mjs";
import {
  validateCommonAcceptance,
} from "./toolbox-live/acceptance.mjs";
import { projectLiveResult } from "./toolbox-live/result.mjs";

if (process.env.GW_LIVE_SMOKE !== "1") {
  console.error("toolbox:live requires GW_LIVE_SMOKE=1");
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
const plan = liveRunPlan(scenario, {
  baseEnv: process.env,
  userData,
  cachedOnly: !allowUpdate,
});
if (!plan) {
  console.error(`unknown Toolbox live scenario: ${scenario}`);
  process.exit(2);
}
const selectedScenario = plan.scenario;
const observeArgument = process.argv.indexOf("--observe");
const observations = parseToolboxObservations(
  observeArgument >= 0 ? process.argv[observeArgument + 1] ?? null : null,
);
const preflight = await inspectToolboxWorkspace(userData);
const blocked = liveRunRefusal(plan, preflight, { cachedOnly: !allowUpdate });
if (blocked) {
  console.error(JSON.stringify({ preflight, blocked }));
  process.exit(2);
}
const failureDir = path.join(root, "test-results", "toolbox-live");

const child = spawn(
  electronBin,
  [".", "--remote-debugging-port=0"],
  {
    cwd: root,
    env: plan.env,
    stdio: plan.stdio,
  },
);

// Only an automation run has a channel to send on; observation runs are spawned
// without one, so this is never handed to an observation scenario.
function sendAutomationCommand(command) {
  return new Promise((resolve, reject) => {
    child.send(command, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sampleObservations(targetPage) {
  if (observations.length === 0) return [];
  return targetPage.evaluate((requested) => {
    const buffer = window.gwToolboxRuntime?.memory?.buffer;
    if (!(buffer instanceof ArrayBuffer)) return [];
    const view = new DataView(buffer);
    const widths = { u8: 1, u16: 2, u32: 4, i32: 4, f32: 4 };
    return requested.map(({ type, address }) => {
      const width = widths[type];
      if (address + width > view.byteLength) {
        return { type, address, value: null, valid: false };
      }
      let value;
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
const captureProcessOutput = (chunk) => {
  processOutput = `${processOutput}${chunk.toString()}`.slice(
    -MAX_PROCESS_OUTPUT_BYTES,
  );
};
child.stdout.on("data", captureProcessOutput);
child.stderr.on("data", captureProcessOutput);

const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Electron did not expose its debugging endpoint")),
    30_000,
  );
  const inspect = (chunk) => {
    const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(chunk.toString());
    if (!match) return;
    clearTimeout(timer);
    resolve(match[1]);
  };
  child.stderr.on("data", inspect);
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    reject(new Error(`Electron exited before connection (${code}/${signal})`));
  });
});

let browser;
let page;
let cdp;
const rendererErrors = [];
let keepAlive = leaveOpen;
let result = null;
try {
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent("page");
  cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  let loginInputs = await waitForPlayable(page, plan.tier);
  if (scenario === "reload") {
    await page.reload({ waitUntil: "domcontentloaded" });
    loginInputs += await waitForPlayable(page, plan.tier);
  }

  const before = await page.evaluate(() => ({
    tickCount: window.gwToolboxState?.tickCount ?? null,
    at: performance.now(),
  }));
  await page.waitForTimeout(2_000);
  const cadence = await page.evaluate((start) => ({
    ticks: start.tickCount === null
      ? 0
      : window.gwToolboxState.tickCount >= start.tickCount
        ? window.gwToolboxState.tickCount - start.tickCount
        : window.gwToolboxState.tickCount + (2 ** 32 - start.tickCount),
    elapsedMs: performance.now() - start.at,
  }), before);
  const observationsBefore = await sampleObservations(page);
  const scenarioEvidence = await selectedScenario.run(
    scenarioContext(plan.tier, {
      page,
      cdp,
      sendAutomationCommand,
      sampleObservations: observations.length > 0
        ? () => sampleObservations(page)
        : null,
    }),
  );

  result = await projectLiveResult(page, cadence, scenario);
  result.tier = plan.tier;
  result.loginInputs = loginInputs;
  if (scenarioEvidence) result.evidence = scenarioEvidence;
  if (observations.length > 0) {
    result.observations = {
      before: observationsBefore,
      after: await sampleObservations(page),
    };
  }
  result.preflight = {
    cached: !allowUpdate,
    snapshotComplete: preflight.snapshot?.complete === true,
    transformedCache: preflight.client.transformedCache,
    targetReadout: preflight.targetReadout,
  };
  result.rendererErrors = [...rendererErrors];
  validateCommonAcceptance(result, preflight.client.buildId, {
    coreObservation: plan.tier === "automation",
  });
  selectedScenario.validate(result);
  console.log(JSON.stringify(result));

  if (leaveOpen) {
    console.log("Toolbox live acceptance passed; leaving Electron open.");
    keepAlive = true;
  } else {
    if (!page.isClosed()) {
      await page
        .evaluate(() => window.gwNative.app.requestQuit())
        .catch((error) => {
          if (!page.isClosed()) throw error;
        });
    }
    const shutdown = child.exitCode !== null || child.signalCode !== null
      ? { code: child.exitCode, signal: child.signalCode }
      : await new Promise((resolve) => {
          child.once("exit", (code, signal) => resolve({ code, signal }));
        });
    if (shutdown.code !== 0 || shutdown.signal !== null) {
      throw new Error(`unclean shutdown: ${JSON.stringify(shutdown)}`);
    }
    console.log(JSON.stringify({ shutdown: "clean" }));
  }
} catch (error) {
  keepAlive = true;
  await mkdir(failureDir, { recursive: true });
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(failureDir, "failure.png") })
      .catch(() => undefined);
  }
  await writeFile(
    path.join(failureDir, "failure.json"),
    JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      result,
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
  await new Promise((resolve) => child.once("exit", resolve));
}
