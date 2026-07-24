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
if (
  ![
    "boot",
    "target",
    "movement",
    "reload",
    "map-transition",
    "performance",
  ].includes(scenario)
) {
  console.error(`unknown Toolbox live scenario: ${scenario}`);
  process.exit(2);
}
const observeArgument = process.argv.indexOf("--observe");
const observations = parseToolboxObservations(
  observeArgument >= 0 ? process.argv[observeArgument + 1] ?? null : null,
);
const preflight = await inspectToolboxWorkspace(userData);
if (!allowUpdate && !preflight.readyForCachedLive) {
  console.error(JSON.stringify({ preflight, blocked: "cached-client-incomplete" }));
  process.exit(2);
}
if (preflight.credentials !== "saved") {
  console.error(JSON.stringify({ preflight, blocked: "saved-login-missing" }));
  process.exit(2);
}
const failureDir = path.join(root, "test-results", "toolbox-live");
const env = {
  ...process.env,
  GW_EXPECT_USER_DATA: userData,
  GW_TOOLBOX_AUTOMATION: "1",
  ...(allowUpdate ? {} : { GW_REQUIRE_CACHED_CLIENT: "1" }),
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  electronBin,
  [".", "--remote-debugging-port=0"],
  {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

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

async function waitForPlayable(targetPage) {
  await targetPage.waitForFunction(
    async () => {
      const progress = await window.gwNative.progress.current();
      if (progress.error) throw new Error(progress.error);
      return progress.phase === "ready";
    },
    null,
    { timeout: 30 * 60_000, polling: 500 },
  );
  await targetPage.waitForFunction(
    () => {
      const stage = window.gwAutomation?.read().stage;
      return stage === "client.frontend" || stage?.startsWith("game.");
    },
    null,
    { timeout: 60_000, polling: 100 },
  );
  let inputs = 0;
  for (const delay of [3_000, 5_000, 20_000]) {
    if (
      await targetPage.evaluate(
        () => window.gwToolboxState?.status === "ready",
      )
    ) {
      break;
    }
    await targetPage.waitForTimeout(delay);
    if (
      await targetPage.evaluate(
        () => window.gwToolboxState?.status === "ready",
      )
    ) {
      break;
    }
    await targetPage.locator("#canvas").focus();
    await targetPage.keyboard.press("Enter");
    inputs += 1;
  }
  await targetPage.waitForFunction(
    () => {
      const state = window.gwToolboxState;
      return state?.status === "ready" && state.tickCount > 5;
    },
    null,
    { timeout: 30 * 60_000, polling: 250 },
  );
  return inputs;
}

async function readTarget(targetPage) {
  return targetPage.evaluate(() => {
    const state = window.gwToolboxState;
    return state?.targetValid
      ? {
          valid: true,
          id: state.targetId,
          type: state.targetKind,
          x: state.targetX,
          y: state.targetY,
          distance: state.distance,
          range: state.rangeName,
        }
      : { valid: false };
  });
}

async function runTargetScenario(targetPage) {
  const initial = await readTarget(targetPage);
  const viewport = await targetPage.evaluate(() => ({
    width: window.innerWidth,
  }));
  const excludedId = initial.valid ? initial.id : 0;
  let acquired = initial;
  for (const y of [395, 425, 455]) {
    await targetPage.mouse.click(viewport.width - 250, y);
    await targetPage.waitForTimeout(500);
    acquired = await readTarget(targetPage);
    if (acquired.valid && acquired.id !== excludedId) break;
  }
  if (!acquired.valid || acquired.id === excludedId) {
    throw new Error("bounded party-panel clicks did not change the target");
  }
  return { initial, acquired };
}

async function runMovementScenario(targetPage) {
  const before = await targetPage.evaluate(() => ({
    x: window.gwToolboxState.playerX,
    y: window.gwToolboxState.playerY,
  }));
  const viewport = await targetPage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await targetPage.mouse.move(viewport.width / 2, viewport.height / 2);
  await targetPage.mouse.down({ button: "right" });
  await targetPage.mouse.down({ button: "left" });
  try {
    await targetPage.waitForTimeout(700);
  } finally {
    await targetPage.mouse.up({ button: "left" });
    await targetPage.mouse.up({ button: "right" });
  }
  await targetPage.waitForTimeout(500);
  const after = await targetPage.evaluate(() => ({
    x: window.gwToolboxState.playerX,
    y: window.gwToolboxState.playerY,
  }));
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  if (distance <= 5) {
    throw new Error("bounded two-button movement did not change player coordinates");
  }
  return { gesture: "two-button-forward", before, after, distance };
}

async function runMapTransitionScenario(targetPage) {
  const before = await targetPage.evaluate(() => ({
    mapId: window.gwToolboxState.mapId,
    instance: window.gwToolboxState.instanceName,
    playerId: window.gwToolboxState.playerId,
    targetValid: window.gwToolboxState.targetValid,
  }));
  console.log(JSON.stringify({
    checkpoint: "travel-to-a-different-map",
    fromMapId: before.mapId,
    timeoutSeconds: 600,
  }));
  const startedAt = Date.now();
  await targetPage.waitForFunction(
    () => window.gwToolboxState?.reason === "loading",
    null,
    { timeout: 10 * 60_000, polling: 50 },
  );
  const loading = await targetPage.evaluate(() => ({
    status: window.gwToolboxState.status,
    reason: window.gwToolboxState.reason,
    exposesMap: "mapId" in window.gwToolboxState,
    exposesPlayer: "playerId" in window.gwToolboxState,
    exposesTarget: "targetId" in window.gwToolboxState,
  }));
  await targetPage.waitForFunction(
    (mapId) => {
      const state = window.gwToolboxState;
      return state?.status === "ready" && state.mapId !== mapId;
    },
    before.mapId,
    { timeout: 5 * 60_000, polling: 100 },
  );
  const after = await targetPage.evaluate(() => ({
    mapId: window.gwToolboxState.mapId,
    instance: window.gwToolboxState.instanceName,
    playerId: window.gwToolboxState.playerId,
    targetValid: window.gwToolboxState.targetValid,
  }));
  return { before, loading, after, elapsedMs: Date.now() - startedAt };
}

function summarizeFrames(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (percentile) =>
    sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] ?? 0;
  const over = (milliseconds) =>
    samples.filter((sample) => sample > milliseconds).length;
  return {
    count: sorted.length,
    p50Ms: Number(at(0.5).toFixed(3)),
    p95Ms: Number(at(0.95).toFixed(3)),
    p99Ms: Number(at(0.99).toFixed(3)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
    over20Ms: over(20),
    over33Ms: over(100 / 3),
    over50Ms: over(50),
  };
}

async function readPerformanceMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

function summarizePerformanceMetrics(before, after) {
  const durationMs = (name) =>
    Number((((after[name] ?? 0) - (before[name] ?? 0)) * 1_000).toFixed(3));
  return {
    taskMs: durationMs("TaskDuration"),
    scriptMs: durationMs("ScriptDuration"),
    layoutMs: durationMs("LayoutDuration"),
    styleMs: durationMs("RecalcStyleDuration"),
    jsHeapUsedMiB: Number(((after.JSHeapUsedSize ?? 0) / (1024 ** 2)).toFixed(3)),
    jsHeapDeltaKiB: Number(
      (((after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0)) / 1_024)
        .toFixed(3),
    ),
  };
}

async function captureFrames(targetPage, cdp, hookEnabled) {
  await targetPage.evaluate((enabled) => {
    window.gwToolboxRuntime.setHookEnabledForBenchmark(enabled);
  }, hookEnabled);
  if (hookEnabled) {
    const tick = await targetPage.evaluate(
      () => window.gwToolboxState.tickCount,
    );
    await targetPage.waitForFunction(
      (previous) => window.gwToolboxState?.tickCount > previous,
      tick,
      { timeout: 2_000, polling: 25 },
    );
  } else {
    await targetPage.waitForTimeout(1_000);
  }
  const tickBefore = await targetPage.evaluate(
    () => window.gwToolboxState.tickCount,
  );
  const metricsBefore = await readPerformanceMetrics(cdp);
  await targetPage.evaluate(() =>
    window.gwNative.diagnostics.startCapture(1));
  let samples;
  try {
    samples = await targetPage.evaluate(
      (durationMs) => new Promise((resolve) => {
        const values = [];
        const started = performance.now();
        let previous = 0;
        const frame = (now) => {
          if (previous) values.push(now - previous);
          previous = now;
          if (now - started >= durationMs) resolve(values);
          else window.requestAnimationFrame(frame);
        };
        window.requestAnimationFrame(frame);
      }),
      60_000,
    );
  } finally {
    await targetPage.evaluate(() =>
      window.gwNative.diagnostics.stopCapture());
  }
  const tickAfter = await targetPage.evaluate(
    () => window.gwToolboxState.tickCount,
  );
  const metricsAfter = await readPerformanceMetrics(cdp);
  return {
    ...summarizeFrames(samples),
    ...summarizePerformanceMetrics(metricsBefore, metricsAfter),
    ticks: tickAfter >= tickBefore
      ? tickAfter - tickBefore
      : tickAfter + (2 ** 32 - tickBefore),
  };
}

async function runPerformanceScenario(targetPage, cdp) {
  try {
    const baseline = await captureFrames(targetPage, cdp, false);
    const hooked = await captureFrames(targetPage, cdp, true);
    const regressionPercent = baseline.p95Ms > 0
      ? ((hooked.p95Ms / baseline.p95Ms) - 1) * 100
      : Number.POSITIVE_INFINITY;
    const p99RegressionPercent = baseline.p99Ms > 0
      ? ((hooked.p99Ms / baseline.p99Ms) - 1) * 100
      : Number.POSITIVE_INFINITY;
    return {
      durationSecondsPerPhase: 60,
      baseline,
      hooked,
      p95RegressionPercent: Number(regressionPercent.toFixed(2)),
      p99RegressionPercent: Number(p99RegressionPercent.toFixed(2)),
    };
  } finally {
    await targetPage.evaluate(() => {
      window.gwToolboxRuntime.setHookEnabledForBenchmark(true);
    });
  }
}
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

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
  let loginInputs = await waitForPlayable(page);
  if (scenario === "reload") {
    await page.reload({ waitUntil: "domcontentloaded" });
    loginInputs += await waitForPlayable(page);
  }

  const before = await page.evaluate(() => ({
    tickCount: window.gwToolboxState.tickCount,
    at: performance.now(),
  }));
  await page.waitForTimeout(2_000);
  const cadence = await page.evaluate((start) => ({
    ticks:
      window.gwToolboxState.tickCount >= start.tickCount
        ? window.gwToolboxState.tickCount - start.tickCount
        : window.gwToolboxState.tickCount + (2 ** 32 - start.tickCount),
    elapsedMs: performance.now() - start.at,
  }), before);
  const observationsBefore = await sampleObservations(page);
  let scenarioEvidence = null;
  if (scenario === "target") {
    scenarioEvidence = await runTargetScenario(page);
  } else if (scenario === "movement") {
    scenarioEvidence = await runMovementScenario(page);
  } else if (scenario === "map-transition") {
    scenarioEvidence = await runMapTransitionScenario(page);
  } else if (scenario === "performance") {
    scenarioEvidence = await runPerformanceScenario(page, cdp);
  }

  const result = await page.evaluate(({ ticks, elapsedMs, scenario: name }) => {
    const state = window.gwToolboxState;
    const runtime = window.gwToolboxRuntime;
    const renderSamples = [...(runtime?.renderSamples ?? [])]
      .sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(renderSamples.length * 0.95) - 1);
    return {
      scenario: name,
      supported: runtime?.status === "installed",
      buildId: runtime?.buildId ?? null,
      hookCount: state?.tickCount ?? 0,
      hookHertz: Number(((ticks * 1_000) / elapsedMs).toFixed(2)),
      sequence: state?.sequence ?? 0,
      map: state?.status === "ready"
        ? {
            id: state.mapId,
            instance: state.instanceName,
            player: {
              id: state.playerId,
              x: state.playerX,
              y: state.playerY,
            },
          }
        : null,
      target: state?.targetValid
        ? {
            id: state.targetId,
            type: state.targetKind,
            x: state.targetX,
            y: state.targetY,
            distance: state.distance,
            range: state.rangeName,
          }
        : null,
      renderUs: Number((runtime?.lastRenderUs ?? 0).toFixed(2)),
      renderP95Us: Number((renderSamples[p95Index] ?? 0).toFixed(2)),
      snapshotReads: runtime?.snapshotReads ?? 0,
      rejectedSnapshots: runtime?.rejectedSnapshots ?? 0,
      domUpdates: runtime?.domUpdates ?? 0,
      lifecycle: window.gwAutomation?.read() ?? null,
      installation: runtime?.installation ?? 0,
    };
  }, { ...cadence, scenario });
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
  };
  result.rendererErrors = [...rendererErrors];
  if (
    !result.supported
    || result.buildId !== 38771
    || result.hookHertz < 1
    || result.hookHertz > 240
    || !result.map
    || (
      scenario === "target"
      && (
        !result.evidence.acquired.valid
        || (
          result.evidence.initial.valid
          && result.evidence.initial.id === result.evidence.acquired.id
        )
      )
    )
    || (
      scenario === "map-transition"
      && (
        result.evidence.loading.status !== "waiting"
        || result.evidence.loading.reason !== "loading"
        || result.evidence.loading.exposesMap
        || result.evidence.loading.exposesPlayer
        || result.evidence.loading.exposesTarget
        || result.evidence.before.mapId === result.evidence.after.mapId
      )
    )
    || (
      scenario === "performance"
      && (
        result.evidence.baseline.count < 3_000
        || result.evidence.baseline.ticks !== 0
        || result.evidence.hooked.count < 3_000
        || result.evidence.hooked.ticks < 3_000
        || result.evidence.p95RegressionPercent > 2
        || result.evidence.p99RegressionPercent > 2
        || (
          result.evidence.hooked.over33Ms
          > result.evidence.baseline.over33Ms + 1
        )
        || (
          result.evidence.hooked.over50Ms
          > result.evidence.baseline.over50Ms + 1
        )
      )
    )
    || result.installation !== 1
    || result.renderP95Us >= 250
    || result.rejectedSnapshots !== 0
    || rendererErrors.some((line) =>
      /unknown socket|unhandled|wasm.*trap/i.test(line),
    )
  ) {
    throw new Error(`live acceptance failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));

  if (leaveOpen) {
    console.log("Toolbox live acceptance passed; leaving Electron open.");
    keepAlive = true;
  } else {
    await page.evaluate(() => window.gwNative.app.requestQuit());
    const shutdown = await new Promise((resolve) => {
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
      rendererErrors,
      processOutput: output.slice(-200),
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
