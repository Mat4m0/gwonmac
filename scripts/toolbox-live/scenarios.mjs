import { runPerformanceScenario } from "./performance.mjs";

export async function waitForPlayable(page) {
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
  let inputs = 0;
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
    inputs += 1;
  }
  await page.waitForFunction(
    () => {
      const state = window.gwToolboxState;
      return state?.status === "ready" && state.tickCount > 5;
    },
    null,
    { timeout: 30 * 60_000, polling: 250 },
  );
  return inputs;
}

async function readTarget(page) {
  return page.evaluate(() => {
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

async function runTarget(page) {
  const initial = await readTarget(page);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const excludedId = initial.valid ? initial.id : 0;
  let acquired;
  await page.locator("#canvas").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.waitForTimeout(500);
  acquired = await readTarget(page);
  if (acquired.valid && acquired.id !== excludedId) {
    return { method: "nearest-ally-key", initial, acquired };
  }
  const candidates = [
    [viewport.width * 0.90, viewport.height * 0.366],
    [viewport.width * 0.90, viewport.height * 0.42],
  ];
  for (const [x, y] of candidates) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
    acquired = await readTarget(page);
    if (acquired.valid && acquired.id !== excludedId) break;
  }
  return { method: "bounded-party-row", initial, acquired };
}

async function runMovement(page) {
  const before = await page.evaluate(() => ({
    x: window.gwToolboxState.playerX,
    y: window.gwToolboxState.playerY,
  }));
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.down({ button: "left" });
  try {
    await page.waitForTimeout(700);
  } finally {
    await page.mouse.up({ button: "left" });
    await page.mouse.up({ button: "right" });
  }
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    x: window.gwToolboxState.playerX,
    y: window.gwToolboxState.playerY,
  }));
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  if (distance <= 5) {
    throw new Error("bounded two-button movement did not change player coordinates");
  }
  return { gesture: "two-button-forward", before, after, distance };
}

async function runMapTransition(page) {
  const before = await page.evaluate(() => ({
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
  await page.waitForFunction(
    () => window.gwToolboxState?.reason === "loading",
    null,
    { timeout: 10 * 60_000, polling: 50 },
  );
  const loading = await page.evaluate(() => ({
    status: window.gwToolboxState.status,
    reason: window.gwToolboxState.reason,
    exposesMap: "mapId" in window.gwToolboxState,
    exposesPlayer: "playerId" in window.gwToolboxState,
    exposesTarget: "targetId" in window.gwToolboxState,
  }));
  await page.waitForFunction(
    (mapId) => {
      const state = window.gwToolboxState;
      return state?.status === "ready" && state.mapId !== mapId;
    },
    before.mapId,
    { timeout: 5 * 60_000, polling: 100 },
  );
  const after = await page.evaluate(() => ({
    mapId: window.gwToolboxState.mapId,
    instance: window.gwToolboxState.instanceName,
    playerId: window.gwToolboxState.playerId,
    targetValid: window.gwToolboxState.targetValid,
  }));
  return { before, loading, after, elapsedMs: Date.now() - startedAt };
}

const noEvidence = async () => null;
const acceptEvidence = () => {};

export const SCENARIOS = Object.freeze({
  boot: Object.freeze({ run: noEvidence, validate: acceptEvidence }),
  target: Object.freeze({
    run: runTarget,
    validate(result) {
      if (
        !result.evidence?.acquired?.valid
        || (
          result.evidence.initial.valid
          && result.evidence.initial.id === result.evidence.acquired.id
        )
      ) {
        throw new Error("target scenario did not acquire a different target");
      }
    },
  }),
  movement: Object.freeze({
    run: runMovement,
    validate(result) {
      if (!(result.evidence?.distance > 5)) {
        throw new Error("movement scenario did not move the player");
      }
    },
  }),
  reload: Object.freeze({ run: noEvidence, validate: acceptEvidence }),
  "map-transition": Object.freeze({
    run: runMapTransition,
    validate(result) {
      const evidence = result.evidence;
      if (
        evidence?.loading?.status !== "waiting"
        || evidence.loading.reason !== "loading"
        || evidence.loading.exposesMap
        || evidence.loading.exposesPlayer
        || evidence.loading.exposesTarget
        || evidence.before.mapId === evidence.after.mapId
      ) {
        throw new Error("map transition exposed stale or unchanged state");
      }
    },
  }),
  performance: Object.freeze({
    run: (_page, context) =>
      runPerformanceScenario(
        context.page,
        context.cdp,
        context.sendAutomationCommand,
      ),
    validate(result) {
      const evidence = result.evidence;
      if (
        evidence?.baseline?.count < 3_000
        || evidence.baseline.ticks !== 0
        || evidence.hooked.count < 3_000
        || evidence.hooked.ticks < 3_000
        || (
          evidence.p95RegressionPercent > 2
          && evidence.p99RegressionPercent > 2
        )
        || evidence.hooked.p95Ms - evidence.baseline.p95Ms > 1
        || evidence.hooked.over33Ms > evidence.baseline.over33Ms + 1
        || evidence.hooked.over50Ms > evidence.baseline.over50Ms + 1
      ) {
        throw new Error("performance scenario exceeded its acceptance budget");
      }
    },
  }),
});

export function getScenario(name) {
  return SCENARIOS[name] ?? null;
}
