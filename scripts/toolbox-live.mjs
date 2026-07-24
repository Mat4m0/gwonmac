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
  runScenario,
  SCENARIOS,
  waitForPlayable,
} from "./toolbox-live/scenarios.mjs";
import {
  runPerformanceScenario,
} from "./toolbox-live/performance.mjs";

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
if (!SCENARIOS.includes(scenario)) {
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
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  },
);

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
  const scenarioEvidence = scenario === "performance"
    ? await runPerformanceScenario(page, cdp, sendAutomationCommand)
    : await runScenario(scenario, page);

  const result = await page.evaluate(async ({ ticks, elapsedMs, scenario: name }) => {
    const state = window.gwToolboxState;
    const runtime = window.gwToolboxRuntime;
    const diagnostics = await window.gwNative.diagnostics.current();
    const storage = await window.navigator.storage.estimate();
    const p95 = (name) => diagnostics.histograms[name]?.p95Us ?? 0;
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
      host: {
        wasmMemoryMiB: Number(
          ((runtime?.memory?.buffer?.byteLength ?? 0) / (1024 ** 2)).toFixed(1),
        ),
        browserStorageMiB: Number(
          ((storage.usage ?? 0) / (1024 ** 2)).toFixed(1),
        ),
        rendererCacheMiB: Number(
          (
            (Number(diagnostics.latest["renderer.memoryCacheBytes"]) || 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        mainRssMiB: Number(
          (
            (Number(diagnostics.latest["main.rssBytes"]) || 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        mainPeakRssMiB: Number(
          (
            (Number(diagnostics.latest["main.peakRssBytes"]) || 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        mainPeakArrayBuffersMiB: Number(
          (
            (Number(diagnostics.latest["main.peakArrayBuffersBytes"]) || 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        rendererRssMiB: Number(
          (
            (Number(diagnostics.latest["process.tab.rssBytes"]) || 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        gpuRssMiB: Number(
          (
            (Number(diagnostics.latest["process.gpu.rssBytes"]) || 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        mainEventLoopP99Us:
          Number(diagnostics.latest["main.eventLoopP99Us"]) || 0,
        submittedFps:
          Number(diagnostics.latest["renderer.submittedFps"]) || 0,
        snapshotReads: diagnostics.counters["snapshot.reads"] ?? 0,
        snapshotMiB: Number(
          (
            (diagnostics.counters["snapshot.bytes"] ?? 0)
            / (1024 ** 2)
          ).toFixed(1),
        ),
        socketSends: diagnostics.counters["socket.rendererSendCalls"] ?? 0,
        socketKiB: Number(
          (
            (diagnostics.counters["socket.rendererPayloadBytes"] ?? 0)
            / 1_024
          ).toFixed(1),
        ),
        p95Us: {
          frameSubmit: p95("renderer.visibleSubmitInterval"),
          swap: p95("renderer.swap"),
          bitmapOut: p95("renderer.bitmapOut"),
          bitmapPresent: p95("renderer.bitmapPresent"),
          snapshotRead: p95("snapshot.rendererRead"),
          socketSync: p95("socket.rendererSync"),
          socketSettle: p95("socket.rendererSettle"),
          socketWrite: p95("socket.writeCallback"),
        },
        milestonesMs: {
          wasmInstantiate: Number(
            (
              (
                (Number(diagnostics.latest["milestone.wasm.instantiate.endUs"]) || 0)
                - (
                  Number(
                    diagnostics.latest["milestone.wasm.instantiate.beginUs"],
                  ) || 0
                )
              ) / 1_000
            ).toFixed(1),
          ),
          firstFrame: Number(
            (
              (Number(diagnostics.latest["milestone.frame.firstSubmitUs"]) || 0)
              / 1_000
            ).toFixed(1),
          ),
          startupComplete: Number(
            (
              (Number(diagnostics.latest["milestone.startup.completeUs"]) || 0)
              / 1_000
            ).toFixed(1),
          ),
        },
      },
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
        || (
          result.evidence.p95RegressionPercent > 2
          && result.evidence.p99RegressionPercent > 2
        )
        || (
          result.evidence.hooked.p95Ms
          - result.evidence.baseline.p95Ms > 1
        )
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
