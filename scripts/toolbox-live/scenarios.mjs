export const SCENARIOS = Object.freeze([
  "boot",
  "target",
  "movement",
  "reload",
  "map-transition",
  "performance",
]);

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
  const viewport = await page.evaluate(() => ({ width: window.innerWidth }));
  const excludedId = initial.valid ? initial.id : 0;
  let acquired = initial;
  for (const y of [395, 425, 455]) {
    await page.mouse.click(viewport.width - 250, y);
    await page.waitForTimeout(500);
    acquired = await readTarget(page);
    if (acquired.valid && acquired.id !== excludedId) break;
  }
  if (!acquired.valid || acquired.id === excludedId) {
    throw new Error("bounded party-panel clicks did not change the target");
  }
  return { initial, acquired };
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

const RUNNERS = Object.freeze({
  boot: async () => null,
  target: runTarget,
  movement: runMovement,
  reload: async () => null,
  "map-transition": runMapTransition,
});

export function runScenario(name, page) {
  const runner = RUNNERS[name];
  if (!runner) return null;
  return runner(page);
}
