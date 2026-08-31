// Automation and observation are separate tiers, defined here because this is
// where they meet.
//
// **Automation** acts on the player's behalf. Its two capabilities are trusted
// Playwright input (`page.mouse`, `page.keyboard`, `page.locator`) and the
// parent-process command channel that main's `process.on("message")` handler
// serves. Both are gated on `GW_ENHANCEMENT_AUTOMATION=1`, which
// `src/main/certification/enhancement-policy.ts` refuses in a packaged app.
//
// **Observation** reads. Its fixed cursor-observer program selects only the
// cursor, independent of saved product settings, and it is handed no input or
// command channel to hold. It deliberately has no target-state tick stream;
// readiness comes from the cursor projection itself.
//
// Before this split every live run exported `GW_ENHANCEMENT_AUTOMATION=1` and got
// an IPC channel, so the observation surface could not be exercised without the
// automation surface being present. That separation is the property this
// module protects.
import type { StdioOptions } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CDPSession, Page } from "playwright";
import type { AutomationCommand } from "../../src/shared/automation.js";
import type { EnhancementProgram } from "../../src/shared/enhancement-contracts.js";
import type { CharacterSwitchDiagnostics } from "../../src/renderer/character-switch-model.js";
import type { EnhancementDoctorReport } from "../../src/tools/enhancement-workspace.js";
import { BENCHMARK_ARMS, isBalancedOrder } from "./benchmark.js";
import { runToolboxFoundation, runToolboxHeroPanel } from "./toolbox-scenarios.js";
import { operatorCheckpoint } from "./scenario-checkpoint.js";
import {
  runCharacterSwitchScenario,
  validateCharacterSwitchScenario,
} from "./character-switch-scenario.js";

export type LiveTier = "automation" | "observation" | "graphics-observation";
export type LiveReadiness = "frontend" | "observer" | "toolbox" | "cursor" | "storage";

/** Serializable readiness predicate shared by preflight and the final wait. */
function liveReadinessSatisfied(required: LiveReadiness): boolean {
  if (required === "frontend") return true;
  if (required === "observer") {
    const state = window.gwCompanionState;
    return state?.status === "ready" && (state.tickCount ?? 0) > 5;
  }
  if (required === "toolbox") {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && toolbox.status === "ready"
      && toolbox.heroAvailable === true;
  }
  if (required === "storage") {
    return typeof window.gwCompanionRuntime?.xunlaiAccess === "boolean";
  }
  const cursor = window.gwCompanionRuntime?.cursor;
  return window.gwCompanionRuntime?.status === "installed"
    && typeof cursor === "object"
    && cursor !== null
    && "valid" in cursor
    && cursor.valid === true;
}

/**
 * What every scenario gets: fixed closed projection reads and a clock.
 * There is no generic page evaluator: arbitrary renderer code is an action
 * capability even when the context withholds Playwright's input objects.
 */
export type ObservationContext = Readonly<{
  readCursorProjection: () => Promise<CompanionDeveloperRuntime["cursor"]>;
  readCharacterSwitchDiagnostics: () => Promise<CharacterSwitchDiagnostics | null>;
  wait: (milliseconds: number) => Promise<void>;
}>;

/**
 * The reading context plus the two capabilities that act on the player's
 * behalf. It is a superset, so a scenario written against the reading context
 * can run in either tier while the reverse is a type error.
 */
export type AutomationContext = ObservationContext & Readonly<{
  page: Page;
  cdp: CDPSession;
  sendAutomationCommand: (command: AutomationCommand) => Promise<void>;
}>;

/**
 * Everything the runner can hand a scenario. `scenarioContext` decides which of
 * it survives into the object the scenario actually holds.
 */
export type LiveCapabilities = Readonly<{
  page: Page;
  currentPage?: () => Promise<Page>;
  cdp: CDPSession;
  sendAutomationCommand: (command: AutomationCommand) => Promise<void>;
}>;

/**
 * The assembled live result a scenario validates. Only `evidence` differs
 * between scenarios, so each `validate` below names the shape its own `run`
 * returned rather than sharing one loose type.
 */
export type LiveResult = { evidence?: unknown; rendererErrorCount?: number };

type AutomationScenario = {
  tier: "automation";
  program: EnhancementProgram;
  readiness: LiveReadiness;
  run(context: AutomationContext): Promise<unknown>;
  validate(result: LiveResult): void;
};

type ObservationScenario = {
  tier: "observation";
  program: EnhancementProgram;
  readiness: LiveReadiness;
  run(context: ObservationContext): Promise<unknown>;
  validate(result: LiveResult): void;
};

type GraphicsObservationScenario = {
  tier: "graphics-observation";
  program: EnhancementProgram;
  readiness: LiveReadiness;
  validate(result: LiveResult): void;
};

export type LiveScenario =
  | AutomationScenario
  | ObservationScenario
  | GraphicsObservationScenario;

/**
 * Which scenario runs, how the app is launched for it, and which channels the
 * parent opens to it.
 */
export type LiveRunPlan = {
  name: string;
  scenario: LiveScenario;
  tier: LiveTier;
  env: NodeJS.ProcessEnv;
  stdio: StdioOptions;
};

type PortalRoute = Readonly<{ x: number; y: number; toMapId: number }>;

// GWToolbox++ portal_connections.json records this bidirectional connection.
// Keep live navigation scoped to the one route used by release acceptance.
const CERTIFIED_PORTAL_ROUTES: Readonly<Record<number, PortalRoute | undefined>> =
  Object.freeze({
    146: Object.freeze({ x: 7378, y: 5429, toMapId: 148 }),
    148: Object.freeze({ x: 7378, y: 5429, toMapId: 146 }),
  });

/** @returns how many keypresses the bootstrap synthesized */
export async function waitForPlayable(
  page: Page,
  tier: LiveTier,
  readiness: LiveReadiness,
): Promise<number> {
  // Main creates a game renderer only after the launcher owns a playable
  // client. Readiness therefore begins at the game-owned first-frame boundary;
  // update and preparation state intentionally never crosses this preload.
  await page.waitForFunction(
    () => {
      const stage = window.gwAutomation?.read().stage;
      return stage === "client.frontend" || stage?.startsWith("game.");
    },
    null,
    { timeout: 60_000, polling: 100 },
  );
  let inputs = 0;
  const ready = () => page.evaluate(liveReadinessSatisfied, readiness);
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
      checkpoint: "waiting-for-enhancement",
      please: "bring the client to a playable character",
    }));
  }
  await page.waitForFunction(
    liveReadinessSatisfied,
    readiness,
    { timeout: 30 * 60_000, polling: 250 },
  );
  return inputs;
}

/**
 * The acquired target, or the absence of one.
 *
 * Every field below is read out of the exact Enhancement snapshot. The ready
 * discriminant is checked once here so scenarios cannot accidentally treat a
 * waiting or installation-failure state as a partial target.
 */
type TargetRead = { valid: false } | {
  valid: true;
  id: number;
  type: string;
  x: number;
  y: number;
  distance: number;
  range: string;
};

async function readTarget(page: Page): Promise<TargetRead> {
  return page.evaluate((): TargetRead => {
    const state = window.gwCompanionState;
    return state?.status === "ready" && state.targetValid
      ? {
          valid: true,
          id: Number(state.targetId),
          type: String(state.targetKind),
          x: Number(state.targetX),
          y: Number(state.targetY),
          distance: Number(state.distance),
          range: String(state.rangeName),
        }
      : { valid: false };
  });
}

async function runTarget({ page }: { page: Page }) {
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
  const candidates: ReadonlyArray<readonly [number, number]> = [
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

async function runTargetReadout({ page }: { page: Page }) {
  const target = await runTarget({ page });
  await page.waitForFunction(
    () => {
      const readout = window.gwCompanionRuntime?.readout;
      const element = globalThis.document.getElementById("enhancement-target");
      return typeof readout === "object"
        && readout !== null
        && "visible" in readout
        && readout.visible === true
        && element !== null
        && globalThis.getComputedStyle(element).display !== "none";
    },
    null,
    { timeout: 5_000, polling: 50 },
  );
  const presentation = await page.evaluate(() => {
    const elements = [
      ...globalThis.document.querySelectorAll("#enhancement-target"),
    ];
    const element = elements[0] ?? null;
    const readout = window.gwCompanionRuntime?.readout;
    return {
      count: elements.length,
      visible:
        element !== null
        && globalThis.getComputedStyle(element).display !== "none",
      text: element?.textContent ?? "",
      // What the runtime says it published, projected to the two fields the
      // acceptance check compares against the DOM above. An absent field is
      // reported as not-visible and an empty line, which is what the check
      // already treated it as.
      runtime: typeof readout === "object" && readout !== null
        ? {
            visible: "visible" in readout && readout.visible === true,
            line: "line" in readout ? String(readout.line) : "",
          }
        : null,
    };
  });
  return { ...target, presentation };
}

/**
 * A scenario that produced no evidence at all is a scenario that acquired no
 * target, so the absence is refused here rather than crashing the check.
 */
function validateTargetAcquisition(
  evidence: { initial: TargetRead; acquired: TargetRead } | undefined,
): asserts evidence is {
  initial: TargetRead;
  acquired: Extract<TargetRead, { valid: true }>;
} {
  if (
    !evidence?.acquired.valid
    || (
      evidence.initial.valid
      && evidence.initial.id === evidence.acquired.id
    )
  ) {
    throw new Error("target scenario did not acquire a different target");
  }
}

async function runMovement({ page }: { page: Page }) {
  const before = await page.evaluate(() => {
    const state = window.gwCompanionState;
    return {
      x: Number(state?.status === "ready" ? state.playerX : undefined),
      y: Number(state?.status === "ready" ? state.playerY : undefined),
    };
  });
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
  const after = await page.evaluate(() => {
    const state = window.gwCompanionState;
    return {
      x: Number(state?.status === "ready" ? state.playerX : undefined),
      y: Number(state?.status === "ready" ? state.playerY : undefined),
    };
  });
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  // Negated rather than `distance <= 5`: a snapshot without player coordinates
  // — the state the client is in while a map loads — makes this NaN, and NaN
  // fails every ordered comparison, so the old spelling let the run report a
  // movement it never measured.
  if (!(distance > 5)) {
    throw new Error("bounded two-button movement did not change player coordinates");
  }
  return { gesture: "two-button-forward", before, after, distance };
}

async function runMapTransition({ page }: { page: Page }) {
  const readState = () => page.evaluate(() => {
    const state = window.gwCompanionState;
    const ready = state?.status === "ready" ? state : null;
    return {
      status: state?.status ?? null,
      reason: state && "reason" in state ? state.reason : null,
      mapId: Number(ready?.mapId),
      instance: ready?.instanceName ?? null,
      playerId: Number(ready?.playerId),
      x: Number(ready?.playerX),
      y: Number(ready?.playerY),
      targetValid: ready?.targetValid === true,
      // The point of the scenario: a loading snapshot must carry no map,
      // player, or target field at all. An absent state exposes nothing, which
      // is the same answer.
      exposesMap: state !== undefined && "mapId" in state,
      exposesPlayer: state !== undefined && "playerId" in state,
      exposesTarget: state !== undefined && "targetId" in state,
    };
  });
  const before = await readState();
  const portal = CERTIFIED_PORTAL_ROUTES[before.mapId];
  if (!portal) {
    throw new Error(`no certified portal route for map ${before.mapId}`);
  }
  const trace = [{ x: before.x, y: before.y }];
  const move = async (milliseconds: number) => {
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
  const turn = async (key: string, milliseconds: number) => {
    await page.keyboard.down(key);
    try {
      await page.waitForTimeout(milliseconds);
    } finally {
      await page.keyboard.up(key);
    }
  };
  const angleBetween = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
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
      const state = window.gwCompanionState;
      return state?.status === "ready" && state.mapId !== mapId;
    },
    before.mapId,
    { timeout: 5 * 60_000, polling: 100 },
  );
  const after = await page.evaluate(() => {
    const state = window.gwCompanionState;
    const ready = state?.status === "ready" ? state : null;
    return {
      mapId: Number(ready?.mapId),
      instance: ready?.instanceName ?? null,
      playerId: Number(ready?.playerId),
      targetValid: ready?.targetValid === true,
    };
  });
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

// Human-assisted cursor evidence reads only the renderer's bounded cursor
// projection. No address, pointer, pixel payload, or arbitrary memory value is
// accepted or persisted.
const CURSOR_PHASES = Object.freeze([
  Object.freeze({ seconds: 20, ask: "leave the plain arrow over open ground" }),
  Object.freeze({ seconds: 12, ask: "open the inventory and hover an item" }),
  Object.freeze({ seconds: 12, ask: "use a salvage kit, then hover a salvageable item" }),
  Object.freeze({ seconds: 8, ask: "press Escape and return to the plain arrow" }),
  Object.freeze({ seconds: 12, ask: "use an identification kit, then hover an unidentified item" }),
  Object.freeze({ seconds: 8, ask: "press Escape and return to the plain arrow" }),
  Object.freeze({ seconds: 12, ask: "drag an inventory item and hold it" }),
  Object.freeze({ seconds: 10, ask: "open the world map and hover a travel destination" }),
  // Whether the client hides its own cursor during mouse-look — and does not
  // during a map pan — decides if pointer lock can be gated on the client's
  // cursor state instead of a new certified world-map read (input.ts).
  Object.freeze({ seconds: 12, ask: "in the world, hold right-click and rotate the camera" }),
  Object.freeze({ seconds: 12, ask: "open the world map and right-drag to pan it" }),
]);
const CURSOR_SAMPLE_INTERVAL_MS = 50;
const CURSOR_MAX_CHANGES = 192;

async function runCursorCapture({ readCursorProjection, wait }: ObservationContext) {
  const changes: {
    atMs: number;
    phase: number;
    cursor: CompanionDeveloperRuntime["cursor"];
  }[] = [];
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
      const cursor = await readCursorProjection();
      const key = JSON.stringify(cursor);
      if (key !== previous) {
        previous = key;
        if (changes.length < CURSOR_MAX_CHANGES) {
          changes.push({
            atMs: Date.now() - startedAt,
            phase: index + 1,
            cursor,
          });
        } else {
          overflow += 1;
        }
      }
      await wait(CURSOR_SAMPLE_INTERVAL_MS);
    }
  }
  return {
    phases: CURSOR_PHASES.length,
    sampleIntervalMs: CURSOR_SAMPLE_INTERVAL_MS,
    changeCount: changes.length + overflow,
    overflow,
    changes,
  };
}

const noEvidence = async () => null;
const acceptEvidence = () => {};

async function runXunlaiStorage({ page }: AutomationContext) {
  const xunlaiAccess = await page.evaluate(
    () => window.gwCompanionRuntime?.xunlaiAccess ?? null,
  );
  const attempt = () => page.evaluate(() => {
    const detail: { error?: unknown } = {};
    const event = new CustomEvent("gw:storage-open", {
      cancelable: true,
      detail,
    });
    window.dispatchEvent(event);
    return {
      handled: event.defaultPrevented,
      error: detail.error instanceof Error
        ? detail.error.message
        : detail.error
          ? String(detail.error)
          : null,
    };
  });
  const commandOutcomes: Awaited<ReturnType<typeof attempt>>[] = [];
  const recoveries: Awaited<ReturnType<typeof runMovement>>[] = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    commandOutcomes.push(await attempt());
    if (xunlaiAccess !== true) continue;
    await page.waitForTimeout(750);
    await page.locator("#canvas").focus();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    recoveries.push(await runMovement({ page }));
  }
  return { xunlaiAccess, commandOutcomes, recoveries };
}

export const SCENARIOS: Readonly<Record<string, LiveScenario>> = Object.freeze({
  // Reaching a playable character is itself a keypress, so the scenarios that
  // only need the client up are automation too. `tier` names what the run does,
  // not how interesting its evidence is.
  boot: Object.freeze({
    tier: "automation",
    program: "none",
    readiness: "frontend",
    run: noEvidence,
    validate: acceptEvidence,
  }),
  "graphics-probe": Object.freeze({
    tier: "graphics-observation",
    program: "none",
    readiness: "frontend",
    validate(result: LiveResult) {
      if (!result.evidence) {
        throw new Error("graphics probe recorded no baseline");
      }
    },
  }),
  "cartography-probe": Object.freeze({
    tier: "graphics-observation",
    // Exercise the same sealed Core client chain a player launches. A custom
    // developer observer profile produces a different derivative and would
    // correctly be refused by Cartography's finite build registry.
    program: "none",
    readiness: "observer",
    validate(result: LiveResult) {
      if (!result.evidence) {
        throw new Error("cartography probe recorded no evidence");
      }
    },
  }),
  target: Object.freeze({
    tier: "automation",
    program: "target-observer",
    readiness: "observer",
    run: runTarget,
    validate(result: { evidence?: Awaited<ReturnType<typeof runTarget>> }) {
      validateTargetAcquisition(result.evidence);
    },
  }),
  "target-readout": Object.freeze({
    tier: "automation",
    program: "target-observer",
    readiness: "observer",
    run: runTargetReadout,
    validate(result: { evidence?: Awaited<ReturnType<typeof runTargetReadout>> }) {
      const evidence = result.evidence;
      validateTargetAcquisition(evidence);
      const expected =
        `${Math.round(evidence.acquired.distance)} ${evidence.acquired.range}`;
      if (
        evidence.presentation.count !== 1
        || evidence.presentation.visible !== true
        || evidence.presentation.runtime?.visible !== true
        || evidence.presentation.runtime.line !== expected
        || !evidence.presentation.text.includes(
          String(Math.round(evidence.acquired.distance)),
        )
        || !evidence.presentation.text.includes(evidence.acquired.range)
      ) {
        throw new Error("target readout did not render the acquired target");
      }
    },
  }),
  "toolbox-foundation": Object.freeze({
    tier: "automation",
    program: "toolbox-foundation",
    readiness: "toolbox",
    run: runToolboxFoundation,
    validate(result: { evidence?: Awaited<ReturnType<typeof runToolboxFoundation>> }) {
      const evidence = result.evidence;
      if (
        !evidence
        || evidence.delta !== 1
        || evidence.heroId === 0
        || evidence.panelState !== 1
        || evidence.cursorEventDelta < 1
        || evidence.cursorGenerationDelta < 1
        || evidence.cursorRefreshDelta < 1
        || !evidence.cursorChanged
      ) {
        throw new Error("toolbox foundation live proof did not settle correctly");
      }
    },
  }),
  "toolbox-hero-panel": Object.freeze({
    tier: "automation",
    program: "toolbox-foundation",
    readiness: "toolbox",
    run: runToolboxHeroPanel,
    validate(result: { evidence?: Awaited<ReturnType<typeof runToolboxHeroPanel>> }) {
      const evidence = result.evidence;
      if (
        !evidence
        || evidence.heroId === 0
        || evidence.panelState !== 1
      ) {
        throw new Error("hero panel observation did not settle correctly");
      }
    },
  }),
  "xunlai-storage": Object.freeze({
    tier: "automation",
    program: "xunlai-storage",
    readiness: "storage",
    run: runXunlaiStorage,
    validate(result: { evidence?: Awaited<ReturnType<typeof runXunlaiStorage>> }) {
      const evidence = result.evidence;
      if (!evidence || typeof evidence.xunlaiAccess !== "boolean") {
        throw new Error("Xunlai storage did not publish a confirmed access result");
      }
      const outcomesMatch = evidence.commandOutcomes.every(
        (outcome) =>
          outcome.handled
          && (evidence.xunlaiAccess
            ? outcome.error === null
            : outcome.error !== null),
      );
      if (!outcomesMatch) {
        throw new Error("Xunlai command outcome did not match certified access");
      }
      if (
        evidence.xunlaiAccess
          ? evidence.recoveries.length !== 2
            || evidence.recoveries.some((recovery) => !(recovery.distance > 5))
          : evidence.recoveries.length !== 0
      ) {
        throw new Error(
          "Xunlai storage did not surrender world interaction after closing",
        );
      }
    },
  }),
  "reconnect-discovery": Object.freeze({
    tier: "automation",
    program: "reconnect-probe",
    readiness: "frontend",
    async run({ page }: AutomationContext) {
      await operatorCheckpoint(
        "Choose one run: (1) start in an outpost, or (2) start in an explorable area. "
        + "Use Command-Q → Reload Guild Wars with automatic return enabled. Do not add input. "
        + "When the character is playable, choose Help → Diagnostics → "
        + "Copy Reload Trace, then return here.",
      );
      const transcript = await page.evaluate(() => window.gwNative.clipboard.readText());
      const outputDirectory = path.join(
        process.cwd(),
        "test-results",
        "enhancements-live",
      );
      await mkdir(outputDirectory, { recursive: true });
      const output = path.join(outputDirectory, "reconnect-discovery.txt");
      await writeFile(output, transcript, "utf8");
      return Object.freeze({ transcript, output });
    },
    validate(result: { evidence?: { transcript: string; output: string } }) {
      if (
        !result.evidence?.transcript.startsWith("gwonmac reload trace —")
        || !result.evidence.transcript.includes("gameReload.requested")
        || !/relog\.finished outcome=(restored|outpost)/
          .test(result.evidence.transcript)
      ) {
        throw new Error("relog qualification did not reach a certified terminal branch");
      }
    },
  }),
  movement: Object.freeze({
    tier: "automation",
    program: "target-observer",
    readiness: "observer",
    run: runMovement,
    validate(result: { evidence?: Awaited<ReturnType<typeof runMovement>> }) {
      if (!((result.evidence?.distance ?? 0) > 5)) {
        throw new Error("movement scenario did not move the player");
      }
    },
  }),
  reload: Object.freeze({
    tier: "automation",
    program: "target-observer",
    readiness: "observer",
    run: noEvidence,
    validate: acceptEvidence,
  }),
  // Observation scenarios receive fixed typed projections and no page, input,
  // CDP, or parent-process command handle.
  "cursor-capture": Object.freeze({
    tier: "observation",
    program: "cursor-observer",
    readiness: "cursor",
    run: runCursorCapture,
    validate(result: { evidence?: Awaited<ReturnType<typeof runCursorCapture>> }) {
      if (!((result.evidence?.changeCount ?? 0) > 1)) {
        throw new Error("cursor capture observed no state transition");
      }
    },
  }),
  "character-switch": Object.freeze({
    tier: "observation",
    program: "none",
    readiness: "frontend",
    run: runCharacterSwitchScenario,
    validate: validateCharacterSwitchScenario,
  }),
  "map-transition": Object.freeze({
    tier: "automation",
    program: "target-observer",
    readiness: "observer",
    run: runMapTransition,
    validate(result: { evidence?: Awaited<ReturnType<typeof runMapTransition>> }) {
      const evidence = result.evidence;
      if (
        evidence?.loading.status !== "waiting"
        || evidence.loading.reason === null
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
    program: "target-observer",
    readiness: "observer",
    // Imported here rather than at the top of this file: performance.ts is the
    // benchmark harness and the only holder of AUTOMATION_COMMAND, so an
    // observation run never loads the command vocabulary at all.
    run: async ({ page, cdp, sendAutomationCommand }: AutomationContext) =>
      (await import("./performance.js")).runPerformanceScenario(
        page,
        cdp,
        sendAutomationCommand,
      ),
    // The budget lives here, with the benchmark it gates. The order does too:
    // a run that measured each arm once, in a fixed sequence, is refused here
    // rather than trusted to have said so in a field.
    validate(result: {
      evidence?: Awaited<ReturnType<
        typeof import("./performance.js").runPerformanceScenario
      >>;
    }) {
      const evidence = result.evidence;
      const off = evidence?.arms?.[BENCHMARK_ARMS.dispatcherOff];
      const on = evidence?.arms?.[BENCHMARK_ARMS.observerOn];
      if (!evidence || !off || !on) {
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
 * observation run boots the app exactly as a player's cursor-only session does
 * — `nativeCursor` on, `GW_ENHANCEMENT_AUTOMATION` unset even
 * when the caller's own environment exports it — and gets no IPC channel, so
 * `child.send` does not exist to be called.
 *
 * Returns null for an unknown scenario name.
 */
export function liveRunPlan(
  name: string,
  { baseEnv, userData, cachedOnly }: {
    baseEnv: NodeJS.ProcessEnv;
    userData: string;
    cachedOnly: boolean;
  },
): LiveRunPlan | null {
  const scenario = SCENARIOS[name];
  if (!scenario) return null;
  const automation = scenario.tier === "automation";
  const env: NodeJS.ProcessEnv = { ...baseEnv, GW_EXPECT_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  if (automation) env.GW_ENHANCEMENT_AUTOMATION = "1";
  else delete env.GW_ENHANCEMENT_AUTOMATION;
  if (scenario.program === "none") delete env.GW_ENHANCEMENT_PROGRAM;
  else env.GW_ENHANCEMENT_PROGRAM = scenario.program;
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
export function liveRunRefusal(
  plan: LiveRunPlan,
  preflight: Pick<EnhancementDoctorReport, "readyForCachedLive">,
  { cachedOnly }: { cachedOnly: boolean },
): "cached-client-incomplete" | null {
  if (cachedOnly && !preflight.readyForCachedLive) {
    return "cached-client-incomplete";
  }
  return null;
}

/**
 * What a scenario is handed. Observation gets only fixed typed projections
 * and a clock. Automation additionally gets the page, the CDP
 * session and the command channel — the two capabilities that act on the
 * player's behalf are objects it holds, not flags it is asked to respect.
 *
 * Overloaded on the tier so that pairing is a compile error and not only a
 * convention: an observation scenario cannot be handed the automation context.
 */
export function scenarioContext(
  tier: "automation",
  capabilities: LiveCapabilities,
): AutomationContext;
export function scenarioContext(
  tier: "observation",
  capabilities: LiveCapabilities,
): ObservationContext;
export function scenarioContext(
  tier: "automation" | "observation",
  capabilities: LiveCapabilities,
): AutomationContext | ObservationContext {
  const {
    page,
    currentPage = async () => page,
    cdp,
    sendAutomationCommand,
  } = capabilities;
  const observation: ObservationContext = {
    readCursorProjection: async () => (await currentPage()).evaluate(() =>
      window.gwCompanionRuntime?.cursor ?? null),
    readCharacterSwitchDiagnostics: async () => (await currentPage()).evaluate(() =>
      window.gwCharacterSwitch?.diagnostics() ?? null),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
  return Object.freeze(
    tier === "automation"
      ? { ...observation, page, cdp, sendAutomationCommand }
      : observation,
  );
}
