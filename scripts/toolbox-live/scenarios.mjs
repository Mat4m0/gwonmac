import { runPerformanceScenario } from "./performance.mjs";

// GWToolbox++ portal_connections.json records this bidirectional connection.
// Keep live navigation scoped to the one route used by release acceptance.
const CERTIFIED_PORTAL_ROUTES = Object.freeze({
  146: Object.freeze({ x: 7378, y: 5429, toMapId: 148 }),
  148: Object.freeze({ x: 7378, y: 5429, toMapId: 146 }),
});

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
  const readState = () => page.evaluate(() => {
    const state = window.gwToolboxState;
    return {
      status: state.status,
      reason: state.reason,
      mapId: state.mapId,
      instance: state.instanceName,
      playerId: state.playerId,
      x: state.playerX,
      y: state.playerY,
      targetValid: state.targetValid,
      exposesMap: "mapId" in state,
      exposesPlayer: "playerId" in state,
      exposesTarget: "targetId" in state,
    };
  });
  const before = await readState();
  const portal = CERTIFIED_PORTAL_ROUTES[before.mapId];
  if (!portal) {
    throw new Error(`no certified portal route for map ${before.mapId}`);
  }
  const trace = [{ x: before.x, y: before.y }];
  const move = async (milliseconds) => {
    await page.keyboard.down("w");
    try {
      const samples = Math.ceil(milliseconds / 25);
      for (let sample = 0; sample < samples; sample += 1) {
        await page.waitForTimeout(25);
        const state = await readState();
        if (state.status !== "ready" || state.mapId !== before.mapId) {
          return state;
        }
      }
    } finally {
      await page.keyboard.up("w");
    }
    const state = await readState();
    if (state.status === "ready" && state.mapId === before.mapId) {
      trace.push({ x: state.x, y: state.y });
    }
    return state;
  };
  const turn = async (key, milliseconds) => {
    await page.keyboard.down(key);
    try {
      await page.waitForTimeout(milliseconds);
    } finally {
      await page.keyboard.up(key);
    }
  };
  const angleBetween = (from, to) =>
    Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
  const startedAt = Date.now();
  await page.locator("#canvas").focus();
  let previous = before;
  let current = await move(350);
  let heading = { x: current.x - previous.x, y: current.y - previous.y };
  await turn("a", 250);
  previous = current;
  current = await move(350);
  const turnedHeading = {
    x: current.x - previous.x,
    y: current.y - previous.y,
  };
  const aTurnSign = Math.sign(angleBetween(heading, turnedHeading)) || 1;
  heading = turnedHeading;

  for (
    let step = 0;
    step < 40 && current.status === "ready" && current.mapId === before.mapId;
    step += 1
  ) {
    const desired = { x: portal.x - current.x, y: portal.y - current.y };
    const remaining = Math.hypot(desired.x, desired.y);
    const movement = Math.hypot(heading.x, heading.y);
    if (remaining < 160) {
      current = await move(1_000);
      continue;
    }
    if (movement < 5) {
      await turn(step % 2 === 0 ? "a" : "d", 400);
    } else {
      const correction = angleBetween(heading, desired);
      const key = Math.sign(correction) === aTurnSign ? "a" : "d";
      await turn(key, Math.min(750, Math.max(40, Math.abs(correction) * 400)));
    }
    previous = current;
    current = await move(650);
    heading = { x: current.x - previous.x, y: current.y - previous.y };
  }
  if (current.status === "ready" && current.mapId === before.mapId) {
    throw new Error(
      `portal route did not load: ${JSON.stringify({ portal, current, trace })}`,
    );
  }
  const loading = current;
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
  return {
    route: {
      fromMapId: before.mapId,
      toMapId: portal.toMapId,
      steps: trace.length,
    },
    before,
    loading,
    after,
    elapsedMs: Date.now() - startedAt,
  };
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
        || !["loading", "game"].includes(evidence.loading.reason)
        || evidence.loading.exposesMap
        || evidence.loading.exposesPlayer
        || evidence.loading.exposesTarget
        || evidence.before.mapId === evidence.after.mapId
        || evidence.after.mapId !== evidence.route.toMapId
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
        evidence?.baseline?.count < 2_500
        || evidence.baseline.ticks !== 0
        || evidence.hooked.count < 2_500
        || evidence.hooked.ticks < 2_500
        || (
          evidence.p95RegressionPercent > 2
          && evidence.p99RegressionPercent > 2
        )
        || evidence.hooked.p95Ms - evidence.baseline.p95Ms > 1
      ) {
        throw new Error("performance scenario exceeded its acceptance budget");
      }
    },
  }),
});

export function getScenario(name) {
  return SCENARIOS[name] ?? null;
}
