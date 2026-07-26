// P4.7 — two tiers, drawn here because this is where they meet.
//
// **Automation** acts on the player's behalf. Its two capabilities are trusted
// Playwright input (`page.mouse`, `page.keyboard`, `page.locator`) and the
// parent-process command channel that main's `process.on("message")` handler
// serves. Both are gated on `GW_TOOLBOX_AUTOMATION=1`, which
// `src/main/toolbox-policy.ts` refuses in a packaged app.
//
// **Observation** reads. It runs against the configuration a player has —
// automation off, the Toolbox installed because `settings.nativeCursor` is on —
// and is handed no input and no command channel to hold, not merely told not to
// use them. `liveRunPlan` and `scenarioContext` below are the two places that
// decide, and each scenario names its tier once.
//
// Before this split every live run exported `GW_TOOLBOX_AUTOMATION=1` and got
// an IPC channel, so the observation surface could not be exercised without the
// automation surface being present. That is the property P4.7 asks for.

import { BENCHMARK_ARMS, isBalancedOrder } from "./benchmark.mjs";

// GWToolbox++ portal_connections.json records this bidirectional connection.
// Keep live navigation scoped to the one route used by release acceptance.
const CERTIFIED_PORTAL_ROUTES = Object.freeze({
  146: Object.freeze({ x: 7378, y: 5429, toMapId: 148 }),
  148: Object.freeze({ x: 7378, y: 5429, toMapId: 146 }),
});

export async function waitForPlayable(page, tier) {
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
  const ready = () =>
    page.evaluate(() => window.gwToolboxState?.status === "ready");
  if (tier === "automation") {
    for (const delay of [3_000, 5_000, 20_000]) {
      if (await ready()) break;
      await page.waitForTimeout(delay);
      if (await ready()) break;
      await page.locator("#canvas").focus();
      await page.keyboard.press("Enter");
      inputs += 1;
    }
  } else if (!(await ready())) {
    // The observation tier synthesizes nothing, including the nudge that gets
    // an idle client past its login screen. Its scenarios are operator-assisted
    // anyway, so ask rather than press; the wait below allows half an hour.
    console.log(JSON.stringify({
      checkpoint: "waiting-for-toolbox",
      please: "bring the client to a playable character",
    }));
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

async function runTarget({ page }) {
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

async function runMovement({ page }) {
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

async function runMapTransition({ page }) {
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

// Human-assisted cursor evidence. FrCursor decodes the active cursor into two
// fixed buffers before calling an empty Emscripten sink, so typed scalar reads
// are enough to prove the buffers are live, identify which cursor is loaded,
// and settle the colour channel order. Nothing here dumps memory: the caller
// chooses at most 16 addresses and only their transitions are recorded.
const CURSOR_PHASES = Object.freeze([
  Object.freeze({ seconds: 20, ask: "leave the plain arrow over open ground" }),
  Object.freeze({ seconds: 12, ask: "open the inventory and hover an item" }),
  Object.freeze({ seconds: 12, ask: "use a salvage kit, then hover a salvageable item" }),
  Object.freeze({ seconds: 8, ask: "press Escape and return to the plain arrow" }),
  Object.freeze({ seconds: 12, ask: "use an identification kit, then hover an unidentified item" }),
  Object.freeze({ seconds: 8, ask: "press Escape and return to the plain arrow" }),
  Object.freeze({ seconds: 12, ask: "drag an inventory item and hold it" }),
  Object.freeze({ seconds: 10, ask: "open the world map and hover a travel destination" }),
]);
const CURSOR_SAMPLE_INTERVAL_MS = 50;
const CURSOR_MAX_CHANGES = 192;

async function runCursorCapture({ sample, evaluate, wait }) {
  if (!sample) {
    throw new Error("cursor-capture requires at least one --observe address");
  }
  const changes = [];
  const startedAt = Date.now();
  let overflow = 0;
  let previous = "";
  for (const [index, phase] of CURSOR_PHASES.entries()) {
    console.log(JSON.stringify({
      checkpoint: "cursor-phase",
      phase: index + 1,
      of: CURSOR_PHASES.length,
      seconds: phase.seconds,
      please: phase.ask,
    }));
    const until = Date.now() + phase.seconds * 1_000;
    while (Date.now() < until) {
      const values = await sample();
      // Renderer-side effect of the same change: what the consumer published
      // and how long the CSS it handed Chromium is. No pixels, no pointers.
      const applied = await evaluate(() => {
        const cursor = window.gwToolboxRuntime?.cursor;
        const canvas = globalThis.document.getElementById("canvas");
        return cursor
          ? { ...cursor, inline: canvas?.style.cursor.slice(0, 24) ?? "" }
          : null;
      });
      const key = JSON.stringify([values.map((entry) => entry.value), applied]);
      if (key !== previous) {
        previous = key;
        if (changes.length < CURSOR_MAX_CHANGES) {
          changes.push({
            atMs: Date.now() - startedAt,
            phase: index + 1,
            values,
            applied,
          });
        } else {
          overflow += 1;
        }
      }
      await wait(CURSOR_SAMPLE_INTERVAL_MS);
    }
  }
  return {
    addresses: changes[0]?.values.map((entry) => ({
      type: entry.type,
      address: `0x${entry.address.toString(16)}`,
    })) ?? [],
    phases: CURSOR_PHASES.length,
    sampleIntervalMs: CURSOR_SAMPLE_INTERVAL_MS,
    changeCount: changes.length + overflow,
    overflow,
    changes,
  };
}

const noEvidence = async () => null;
const acceptEvidence = () => {};

export const SCENARIOS = Object.freeze({
  // Reaching a playable character is itself a keypress, so the scenarios that
  // only need the client up are automation too. `tier` names what the run does,
  // not how interesting its evidence is.
  boot: Object.freeze({ tier: "automation", run: noEvidence, validate: acceptEvidence }),
  target: Object.freeze({
    tier: "automation",
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
    tier: "automation",
    run: runMovement,
    validate(result) {
      if (!(result.evidence?.distance > 5)) {
        throw new Error("movement scenario did not move the player");
      }
    },
  }),
  reload: Object.freeze({ tier: "automation", run: noEvidence, validate: acceptEvidence }),
  // The one observation-tier scenario today: it reads typed addresses and the
  // cursor the renderer published, and asks a human for every state change.
  "cursor-capture": Object.freeze({
    tier: "observation",
    run: runCursorCapture,
    validate(result) {
      if (!(result.evidence?.changeCount > 1)) {
        throw new Error("cursor capture observed no state transition");
      }
    },
  }),
  "map-transition": Object.freeze({
    tier: "automation",
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
    tier: "automation",
    // Imported here rather than at the top of this file: performance.mjs is the
    // benchmark harness and the only holder of AUTOMATION_COMMAND, so an
    // observation run never loads the command vocabulary at all.
    run: async ({ page, cdp, sendAutomationCommand }) =>
      (await import("./performance.mjs")).runPerformanceScenario(
        page,
        cdp,
        sendAutomationCommand,
      ),
    // The budget lives here, with the benchmark it gates. The order does too:
    // a run that measured each arm once, in a fixed sequence, is refused here
    // rather than trusted to have said so in a field.
    validate(result) {
      const evidence = result.evidence;
      const off = evidence?.arms?.[BENCHMARK_ARMS.dispatcherOff];
      const on = evidence?.arms?.[BENCHMARK_ARMS.observerOn];
      if (!off || !on) {
        throw new Error("performance scenario recorded no comparable arms");
      }
      if (!isBalancedOrder(evidence.order)) {
        throw new Error(
          `performance scenario measured in a biased order: ${
            JSON.stringify(evidence.order)
          }`,
        );
      }
      if (
        off.frames.count < 2_500
        || off.ticks !== 0
        || on.frames.count < 2_500
        || on.ticks < 2_500
        || (
          evidence.comparison.p95RegressionPercent > 2
          && evidence.comparison.p99RegressionPercent > 2
        )
        || evidence.comparison.p95DeltaMs > 1
      ) {
        throw new Error("performance scenario exceeded its acceptance budget");
      }
    },
  }),
});

/**
 * The whole tier decision for one live run: which scenario, which environment
 * the app is launched in, and which channels the parent opens to it. An
 * observation run boots the app exactly as a player's does — `nativeCursor` on,
 * `GW_TOOLBOX_AUTOMATION` unset even when the caller's own environment exports
 * it — and gets no IPC channel, so `child.send` does not exist to be called.
 *
 * Returns null for an unknown scenario name.
 */
export function liveRunPlan(name, { baseEnv, userData, cachedOnly }) {
  const scenario = SCENARIOS[name];
  if (!scenario) return null;
  const automation = scenario.tier === "automation";
  const env = { ...baseEnv, GW_EXPECT_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  if (automation) env.GW_TOOLBOX_AUTOMATION = "1";
  else delete env.GW_TOOLBOX_AUTOMATION;
  if (cachedOnly) env.GW_REQUIRE_CACHED_CLIENT = "1";
  return {
    name,
    scenario,
    tier: scenario.tier,
    env,
    stdio: automation
      ? ["ignore", "pipe", "pipe", "ipc"]
      : ["ignore", "pipe", "pipe"],
  };
}

/**
 * Why this run may not start, or null. One owner for every refusal, so a new
 * tier cannot quietly acquire a preflight the others do not have.
 */
export function liveRunRefusal(plan, preflight, { cachedOnly }) {
  if (cachedOnly && !preflight.readyForCachedLive) {
    return "cached-client-incomplete";
  }
  if (preflight.credentials !== "saved") return "saved-login-missing";
  // An observation run enables nothing: the Toolbox installs only because the
  // profile's own setting is on. Without it the run would wait half an hour for
  // a hook that is never installed, so refuse and say which setting.
  if (plan.tier === "observation" && !preflight.nativeCursor) {
    return "native-cursor-disabled";
  }
  return null;
}

/**
 * What a scenario is handed. Observation gets reads: page evaluation, the typed
 * `--observe` sampler, and a clock. Automation additionally gets the page, the
 * CDP session and the command channel — the two capabilities that act on the
 * player's behalf are objects it holds, not flags it is asked to respect.
 */
export function scenarioContext(tier, capabilities) {
  const { page, cdp, sendAutomationCommand, sampleObservations } = capabilities;
  const observation = {
    evaluate: (body, argument) => page.evaluate(body, argument),
    wait: (milliseconds) => page.waitForTimeout(milliseconds),
    sample: sampleObservations,
  };
  return Object.freeze(
    tier === "automation"
      ? { ...observation, page, cdp, sendAutomationCommand }
      : observation,
  );
}
