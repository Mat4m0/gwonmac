import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  defaultGuildWarsProfile,
  inspectToolboxWorkspace,
} from "../build/tools/toolbox-doctor.js";

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
if (!["boot", "target", "movement"].includes(scenario)) {
  console.error(`unknown Toolbox live scenario: ${scenario}`);
  process.exit(2);
}
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
const rendererErrors = [];
let keepAlive = leaveOpen;
try {
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent("page");
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");

  await page.waitForFunction(
    async () => {
      const progress = await window.gwNative.progress.current();
      if (progress.error) throw new Error(progress.error);
      return progress.phase === "ready";
    },
    null,
    { timeout: 30 * 60_000, polling: 500 },
  );
  await page.waitForFunction(
    () => {
      const stage = window.gwAutomation?.read().stage;
      return stage === "client.frontend" || stage?.startsWith("game.");
    },
    null,
    { timeout: 60_000, polling: 100 },
  );
  let loginInputs = 0;
  for (const delay of [3_000, 5_000, 20_000]) {
    if (await page.evaluate(() => window.gwToolboxState?.status === "ready")) {
      break;
    }
    await page.waitForTimeout(delay);
    if (await page.evaluate(() => window.gwToolboxState?.status === "ready")) {
      break;
    }
    await page.locator("#canvas").focus();
    await page.keyboard.press("Enter");
    loginInputs += 1;
  }

  // A real game download can legitimately take longer than an automated test.
  // Do not close the app if this bound is reached; the failure path leaves it
  // open for the download/user to continue.
  await page.waitForFunction(
    () => {
      const state = window.gwToolboxState;
      return state?.status === "ready" && state.tickCount > 5;
    },
    null,
    { timeout: 30 * 60_000, polling: 250 },
  );

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

  if (scenario === "target") {
    await page.locator("#canvas").focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    try {
      await page.waitForFunction(
        () => window.gwToolboxState?.targetValid === true,
        null,
        { timeout: 3_000, polling: 100 },
      );
    } catch {
      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      await page.mouse.click(viewport.width - 250, 425);
      await page.waitForFunction(
        () => window.gwToolboxState?.targetValid === true,
        null,
        { timeout: 10_000, polling: 100 },
      );
    }
  } else if (scenario === "movement") {
    const position = await page.evaluate(() => ({
      x: window.gwToolboxState.playerX,
      y: window.gwToolboxState.playerY,
    }));
    await page.locator("#canvas").focus();
    await page.keyboard.down("w");
    await page.waitForTimeout(600);
    await page.keyboard.up("w");
    await page.waitForFunction(
      (start) => {
        const state = window.gwToolboxState;
        return state?.status === "ready"
          && Math.hypot(state.playerX - start.x, state.playerY - start.y) > 5;
      },
      position,
      { timeout: 5_000, polling: 100 },
    );
  }

  const result = await page.evaluate(({ ticks, elapsedMs, scenario: name }) => {
    const state = window.gwToolboxState;
    const runtime = window.gwToolboxRuntime;
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
      lifecycle: window.gwAutomation?.read() ?? null,
      installation: runtime?.installation ?? 0,
    };
  }, { ...cadence, scenario });
  result.loginInputs = loginInputs;
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
    || (scenario === "target" && !result.target)
    || result.installation !== 1
    || result.renderUs >= 250
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
