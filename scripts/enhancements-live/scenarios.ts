// P4.7 — two tiers, drawn here because this is where they meet.
//
// **Automation** acts on the player's behalf. Its two capabilities are trusted
// Playwright input (`page.mouse`, `page.keyboard`, `page.locator`) and the
// parent-process command channel that main's `process.on("message")` handler
// serves. Both are gated on `GW_ENHANCEMENT_AUTOMATION=1`, which
// `src/main/enhancement-policy.ts` refuses in a packaged app.
//
// **Observation** reads. It runs against the configuration a player has —
// automation off, the Enhancement installed because `settings.nativeCursor` is on —
// and is handed no input and no command channel to hold, not merely told not to
// use them. A cursor-only run deliberately has no target-state tick stream;
// readiness comes from the independently installed cursor consumer.
//
// Before this split every live run exported `GW_ENHANCEMENT_AUTOMATION=1` and got
// an IPC channel, so the observation surface could not be exercised without the
// automation surface being present. That is the property P4.7 asks for.

import type { StdioOptions } from "node:child_process";
import type { CDPSession, Page } from "playwright";
import type { AutomationCommand } from "../../src/shared/automation.js";
import {
  ATTRIBUTE_BY_ID,
  PROFESSION_BY_ID,
} from "../../src/shared/builds/heroes.js";
import type { EnhancementDoctorReport } from "../../src/tools/enhancement-doctor.js";
import type { EnhancementObservationType } from "../../src/tools/enhancement-observations.js";
import { BENCHMARK_ARMS, isBalancedOrder } from "./benchmark.js";
import {
  advanceMutationJournal,
  prepareMutationJournal,
} from "./mutation-journal.js";
import type { WasmBreakpointObserver } from "./wasm-breakpoints.js";
import type { LiveTier } from "./session.js";

/**
 * One `--observe` address read at the width it declared. `value` is null and
 * `valid` false when the address falls outside the module's memory, so a
 * capture records the refusal rather than a zero it did not read.
 */
export type ObservationSample = Readonly<{
  type: EnhancementObservationType;
  address: number;
  value: number | null;
  valid: boolean;
}>;

/**
 * What every scenario gets: page evaluation, the typed `--observe` sampler, and
 * a clock. `evaluate` is deliberately not `page.evaluate` itself — handing the
 * page over would hand over its input as well.
 */
export type ObservationContext = Readonly<{
  evaluate: <Result>(
    body: (argument: unknown) => Result | Promise<Result>,
    argument?: unknown,
  ) => Promise<Result>;
  wait: (milliseconds: number) => Promise<void>;
  sample: (() => Promise<ObservationSample[]>) | null;
  wasmBreakpoints: WasmBreakpointObserver | null;
}>;

/**
 * The reading context plus the two capabilities that act on the player's
 * behalf. It is a superset, so a scenario written against the reading context
 * can run in either tier while the reverse is a type error.
 */
export type AutomationContext = ObservationContext &
  Readonly<{
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
  cdp: CDPSession;
  sendAutomationCommand: (command: AutomationCommand) => Promise<void>;
  sampleObservations: (() => Promise<ObservationSample[]>) | null;
  wasmBreakpoints: WasmBreakpointObserver | null;
}>;

/**
 * The assembled live result a scenario validates. Only `evidence` differs
 * between scenarios, so each `validate` below names the shape its own `run`
 * returned rather than sharing one loose type.
 */
export type LiveResult = { evidence?: unknown };

type AutomationScenario = {
  tier: "automation";
  mutates?: true;
  run(context: AutomationContext): Promise<unknown>;
  validate(result: LiveResult): void;
};

type ObservationScenario = {
  tier: "observation";
  mutates?: never;
  run(context: ObservationContext): Promise<unknown>;
  validate(result: LiveResult): void;
};

export type LiveScenario = AutomationScenario | ObservationScenario;

/**
 * Which scenario runs, how the app is launched for it, and which channels the
 * parent opens to it.
 */
export type LiveRunPlan = {
  name: string;
  scenario: LiveScenario;
  tier: LiveTier;
  mutates: boolean;
  env: NodeJS.ProcessEnv;
  stdio: StdioOptions;
};

type PortalRoute = Readonly<{ x: number; y: number; toMapId: number }>;

// GWToolbox++ portal_connections.json records this bidirectional connection.
// Keep live navigation scoped to the one route used by release acceptance.
const CERTIFIED_PORTAL_ROUTES: Readonly<
  Record<number, PortalRoute | undefined>
> = Object.freeze({
  146: Object.freeze({ x: 7378, y: 5429, toMapId: 148 }),
  148: Object.freeze({ x: 7378, y: 5429, toMapId: 146 }),
});

/**
 * The acquired target, or the absence of one.
 *
 * Every field below is read out of the Enhancement snapshot, which the renderer
 * publishes through a global declared with an open index signature: the values
 * cross into Node as `unknown`. They are converted once, here, so that the
 * scenarios and their acceptance checks work in numbers and strings rather than
 * re-deciding what a snapshot field is at every use.
 */
type TargetRead =
  | { valid: false }
  | {
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
    return state?.targetValid
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
    [viewport.width * 0.9, viewport.height * 0.366],
    [viewport.width * 0.9, viewport.height * 0.42],
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
      return (
        typeof readout === "object" &&
        readout !== null &&
        "visible" in readout &&
        readout.visible === true &&
        element !== null &&
        globalThis.getComputedStyle(element).display !== "none"
      );
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
        element !== null &&
        globalThis.getComputedStyle(element).display !== "none",
      text: element?.textContent ?? "",
      // What the runtime says it published, projected to the two fields the
      // acceptance check compares against the DOM above. An absent field is
      // reported as not-visible and an empty line, which is what the check
      // already treated it as.
      runtime:
        typeof readout === "object" && readout !== null
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
    !evidence?.acquired.valid ||
    (evidence.initial.valid && evidence.initial.id === evidence.acquired.id)
  ) {
    throw new Error("target scenario did not acquire a different target");
  }
}

async function runMovement({ page }: { page: Page }) {
  const before = await page.evaluate(() => ({
    x: Number(window.gwCompanionState?.playerX),
    y: Number(window.gwCompanionState?.playerY),
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
    x: Number(window.gwCompanionState?.playerX),
    y: Number(window.gwCompanionState?.playerY),
  }));
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  // Negated rather than `distance <= 5`: a snapshot without player coordinates
  // — the state the client is in while a map loads — makes this NaN, and NaN
  // fails every ordered comparison, so the old spelling let the run report a
  // movement it never measured.
  if (!(distance > 5)) {
    throw new Error(
      "bounded two-button movement did not change player coordinates",
    );
  }
  return { gesture: "two-button-forward", before, after, distance };
}

async function runMapTransition({ page }: { page: Page }) {
  const readState = () =>
    page.evaluate(() => {
      const state = window.gwCompanionState;
      return {
        status: state?.status ?? null,
        reason: state?.reason ?? null,
        mapId: Number(state?.mapId),
        instance: state?.instanceName ?? null,
        playerId: Number(state?.playerId),
        x: Number(state?.playerX),
        y: Number(state?.playerY),
        targetValid: state?.targetValid === true,
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
  const after = await page.evaluate(() => ({
    mapId: Number(window.gwCompanionState?.mapId),
    instance: window.gwCompanionState?.instanceName ?? null,
    playerId: Number(window.gwCompanionState?.playerId),
    targetValid: window.gwCompanionState?.targetValid === true,
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
  Object.freeze({
    seconds: 12,
    ask: "use a salvage kit, then hover a salvageable item",
  }),
  Object.freeze({
    seconds: 8,
    ask: "press Escape and return to the plain arrow",
  }),
  Object.freeze({
    seconds: 12,
    ask: "use an identification kit, then hover an unidentified item",
  }),
  Object.freeze({
    seconds: 8,
    ask: "press Escape and return to the plain arrow",
  }),
  Object.freeze({ seconds: 12, ask: "drag an inventory item and hold it" }),
  Object.freeze({
    seconds: 10,
    ask: "open the world map and hover a travel destination",
  }),
]);
const CURSOR_SAMPLE_INTERVAL_MS = 50;
const CURSOR_MAX_CHANGES = 192;

async function runCursorCapture({
  sample,
  evaluate,
  wait,
}: ObservationContext) {
  if (!sample) {
    throw new Error("cursor-capture requires at least one --observe address");
  }
  const changes: {
    atMs: number;
    phase: number;
    values: ObservationSample[];
    applied: Record<string, unknown> | null;
  }[] = [];
  const startedAt = Date.now();
  let overflow = 0;
  let previous = "";
  for (const [index, phase] of CURSOR_PHASES.entries()) {
    console.log(
      JSON.stringify({
        checkpoint: "cursor-phase",
        phase: index + 1,
        of: CURSOR_PHASES.length,
        seconds: phase.seconds,
        please: phase.ask,
      }),
    );
    const until = Date.now() + phase.seconds * 1_000;
    while (Date.now() < until) {
      const values = await sample();
      // Renderer-side effect of the same change: what the consumer published
      // and how long the CSS it handed Chromium is. No pixels, no pointers.
      const applied = await evaluate(() => {
        const cursor = window.gwCompanionRuntime?.cursor;
        const canvas = globalThis.document.getElementById("canvas");
        return typeof cursor === "object" && cursor !== null
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
    addresses:
      changes[0]?.values.map((entry) => ({
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

async function runHeroTrace({ wasmBreakpoints }: ObservationContext) {
  if (!wasmBreakpoints) {
    throw new Error("hero-trace requires --break-functions");
  }
  const session = await wasmBreakpoints.start();
  console.log(
    JSON.stringify({
      checkpoint: "hero-trace",
      operatorPaced: true,
      please: "perform exactly one party or template action now",
    }),
  );
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    process.stdin.resume();
  });
  process.stdin.pause();
  return session.finish();
}

const TEMPLATE_FUNCTIONS = Object.freeze([
  16959, 9134, 7172, 6870, 9268, 8706, 6940,
] as const);
const SECONDARY_PROFESSION_FUNCTIONS = Object.freeze([
  16994, 16995, 16991, 16988, 16959, 9276, 6914,
] as const);
const ATTRIBUTE_FUNCTIONS = Object.freeze([9134, 7172, 6870] as const);
const HERO_BEHAVIOR_FUNCTIONS = Object.freeze([9147, 6875] as const);
const HERO_SKILL_TOGGLE_FUNCTIONS = Object.freeze([9150, 6878] as const);
const HERO_PANEL_FUNCTIONS = Object.freeze([14052, 15898] as const);

export const HERO_MAPPING_FUNCTIONS = Object.freeze([
  ...new Set([
    ...TEMPLATE_FUNCTIONS,
    ...SECONDARY_PROFESSION_FUNCTIONS,
    ...ATTRIBUTE_FUNCTIONS,
    ...HERO_BEHAVIOR_FUNCTIONS,
    ...HERO_SKILL_TOGGLE_FUNCTIONS,
    ...HERO_PANEL_FUNCTIONS,
  ]),
] as const);

const HERO_MAPPING_TASKS = Object.freeze([
  Object.freeze({
    id: "secondary-profession",
    title: "Change Koss's secondary profession",
    instruction:
      "Apply a saved template to Koss whose secondary profession differs from his current one.",
    functions: SECONDARY_PROFESSION_FUNCTIONS,
  }),
  Object.freeze({
    id: "player-template",
    title: "Apply a player template",
    instruction: "Apply one saved skill template to your own character.",
    functions: TEMPLATE_FUNCTIONS,
  }),
  Object.freeze({
    id: "hero-template",
    title: "Apply a Koss template",
    instruction:
      "Apply a saved template to Koss without changing his current secondary profession.",
    functions: TEMPLATE_FUNCTIONS,
  }),
  Object.freeze({
    id: "hero-attributes",
    title: "Change Koss's attributes",
    instruction:
      "Change at least one attribute rank for Koss and confirm the change.",
    functions: ATTRIBUTE_FUNCTIONS,
  }),
  Object.freeze({
    id: "behavior-fight",
    title: "Set Koss to Fight",
    instruction: "Use Koss's command panel to select Fight.",
    functions: HERO_BEHAVIOR_FUNCTIONS,
  }),
  Object.freeze({
    id: "behavior-guard",
    title: "Set Koss to Guard",
    instruction: "Use Koss's command panel to select Guard.",
    functions: HERO_BEHAVIOR_FUNCTIONS,
  }),
  Object.freeze({
    id: "behavior-avoid",
    title: "Set Koss to Avoid Combat",
    instruction: "Use Koss's command panel to select Avoid Combat.",
    functions: HERO_BEHAVIOR_FUNCTIONS,
  }),
  Object.freeze({
    id: "skill-disable",
    title: "Disable Koss's first skill",
    instruction: "Disable skill slot 1 in Koss's command panel.",
    functions: HERO_SKILL_TOGGLE_FUNCTIONS,
  }),
  Object.freeze({
    id: "skill-enable",
    title: "Enable Koss's first skill",
    instruction: "Enable the same skill slot again.",
    functions: HERO_SKILL_TOGGLE_FUNCTIONS,
  }),
  Object.freeze({
    id: "panel-show",
    title: "Show Koss's command panel",
    instruction: "Open Koss's command panel if it is currently closed.",
    functions: HERO_PANEL_FUNCTIONS,
  }),
  Object.freeze({
    id: "panel-hide",
    title: "Hide Koss's command panel",
    instruction: "Close Koss's command panel.",
    functions: HERO_PANEL_FUNCTIONS,
  }),
] as const);

type MappingDecision = "done" | "skip" | "finish";

async function installHeroMappingPanel(page: Page) {
  await page.evaluate((tasks) => {
    type MappingPanel = {
      decision: MappingDecision | null;
      show(index: number): void;
      mark(index: number, outcome: "done" | "skipped", hits: number): void;
      complete(): void;
      consume(): MappingDecision | null;
    };
    const mappingWindow = window as unknown as {
      __gwHeroMapping?: MappingPanel;
    };
    document.querySelector("#gw-hero-mapping")?.remove();
    const host = document.createElement("section");
    host.id = "gw-hero-mapping";
    host.setAttribute("aria-label", "Hero primitive mapping session");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        --panel: rgba(20, 22, 26, .96);
        --raised: #20242a;
        --line: #3b414a;
        --ink: #f4f6f8;
        --muted: #b9c0c9;
        --accent: #d4a85b;
        --success: #75c893;
        position: fixed;
        inset: 18px 18px auto auto;
        z-index: 30;
        width: min(390px, calc(100vw - 36px));
        color: var(--ink);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      .panel {
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--panel);
        box-shadow: 0 6px 8px rgba(0, 0, 0, .28);
      }
      header { padding: 16px 18px 14px; border-bottom: 1px solid var(--line); }
      h1 { margin: 0; font-size: 15px; letter-spacing: -.01em; }
      .progress { margin: 5px 0 0; color: var(--muted); font-size: 12px; }
      ol { max-height: 310px; margin: 0; padding: 8px 10px; overflow: auto; list-style: none; }
      li {
        display: grid;
        grid-template-columns: 22px 1fr auto;
        gap: 9px;
        align-items: start;
        padding: 8px;
        border-radius: 8px;
        color: var(--muted);
      }
      li.active { background: var(--raised); color: var(--ink); }
      li.complete { color: var(--ink); }
      .state {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 1px solid var(--line);
        border-radius: 50%;
        font-size: 11px;
      }
      .active .state { border-color: var(--accent); color: var(--accent); }
      .complete .state { border-color: var(--success); color: var(--success); }
      .title { display: block; font-weight: 600; }
      .instruction { display: none; margin-top: 3px; color: var(--muted); }
      .active .instruction { display: block; }
      .hits { color: var(--muted); font-size: 11px; white-space: nowrap; }
      footer { padding: 14px 18px 16px; border-top: 1px solid var(--line); }
      .current { margin: 0 0 12px; color: var(--muted); }
      .actions { display: flex; gap: 8px; }
      button {
        min-height: 34px;
        padding: 0 13px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: transparent;
        color: var(--ink);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button:hover { background: var(--raised); }
      button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      button:active { transform: translateY(1px); }
      .primary { border-color: var(--accent); background: var(--accent); color: #17130c; }
      .primary:hover { background: #e0b96f; }
      .finish { margin-left: auto; color: var(--muted); }
      @media (prefers-reduced-motion: reduce) {
        button:active { transform: none; }
      }
    `;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <header>
        <h1>Hero primitive mapping</h1>
        <p class="progress" aria-live="polite"></p>
      </header>
      <ol></ol>
      <footer>
        <p class="current" aria-live="polite">Preparing scoped debugger…</p>
        <div class="actions">
          <button class="primary" type="button">Done</button>
          <button class="skip" type="button">Skip</button>
          <button class="finish" type="button">Finish session</button>
        </div>
      </footer>
    `;
    shadow.append(style, panel);
    const list = shadow.querySelector("ol")!;
    const progress = shadow.querySelector<HTMLElement>(".progress")!;
    const current = shadow.querySelector<HTMLElement>(".current")!;
    const done = shadow.querySelector<HTMLButtonElement>(".primary")!;
    const skip = shadow.querySelector<HTMLButtonElement>(".skip")!;
    const finish = shadow.querySelector<HTMLButtonElement>(".finish")!;
    for (const [index, task] of tasks.entries()) {
      const row = document.createElement("li");
      row.dataset.index = String(index);
      const state = document.createElement("span");
      state.className = "state";
      state.textContent = String(index + 1);
      const copy = document.createElement("span");
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = task.title;
      const instruction = document.createElement("span");
      instruction.className = "instruction";
      instruction.textContent = task.instruction;
      copy.append(title, instruction);
      const hits = document.createElement("span");
      hits.className = "hits";
      row.append(state, copy, hits);
      list.append(row);
    }
    const api: MappingPanel = {
      decision: null,
      show(index) {
        api.decision = null;
        for (const row of list.querySelectorAll("li")) {
          row.classList.toggle("active", row.dataset.index === String(index));
        }
        progress.textContent = `Step ${index + 1} of ${tasks.length}`;
        current.textContent = tasks[index]?.instruction ?? "";
      },
      mark(index, outcome, hitCount) {
        const row = list.querySelector<HTMLElement>(`[data-index="${index}"]`);
        if (!row) return;
        row.classList.remove("active");
        row.classList.add("complete");
        row.querySelector(".state")!.textContent =
          outcome === "done" ? "✓" : "–";
        row.querySelector(".hits")!.textContent =
          outcome === "done" ? `${hitCount} hits` : "skipped";
      },
      complete() {
        api.decision = null;
        progress.textContent = "Capture complete";
        current.textContent =
          "Review the list, then finish to save the combined report.";
        done.hidden = true;
        skip.hidden = true;
        finish.textContent = "Save & close";
      },
      consume() {
        const value = api.decision;
        api.decision = null;
        return value;
      },
    };
    done.addEventListener("click", () => {
      api.decision = "done";
    });
    skip.addEventListener("click", () => {
      api.decision = "skip";
    });
    finish.addEventListener("click", () => {
      api.decision = "finish";
    });
    mappingWindow.__gwHeroMapping = api;
    document.body.append(host);
  }, HERO_MAPPING_TASKS);
}

async function mappingDecision(page: Page): Promise<MappingDecision> {
  await page.waitForFunction(
    () => {
      const mapping = (
        window as unknown as {
          __gwHeroMapping?: { decision: MappingDecision | null };
        }
      ).__gwHeroMapping;
      return mapping?.decision !== null && mapping?.decision !== undefined;
    },
    null,
    { timeout: 30 * 60_000, polling: 100 },
  );
  return page.evaluate(() => {
    const mapping = (
      window as unknown as {
        __gwHeroMapping?: {
          consume(): MappingDecision | null;
        };
      }
    ).__gwHeroMapping;
    return mapping?.consume() ?? "finish";
  });
}

async function mappingState(page: Page) {
  return page.evaluate(() => {
    const party = window.gwCompanionTeam;
    const state = window.gwCompanionState;
    const heroIds =
      party?.status === "ready" && Array.isArray(party.heroIds)
        ? ([...party.heroIds] as number[])
        : [];
    const heroAgentIds =
      party?.status === "ready" && Array.isArray(party.heroAgentIds)
        ? ([...party.heroAgentIds] as number[])
        : [];
    return {
      mapId: state?.status === "ready" ? state.mapId : null,
      playerAgentId: state?.status === "ready" ? state.playerId : null,
      heroIds,
      heroAgentIds,
    };
  });
}

async function runHeroMappingSession({
  page,
  wasmBreakpoints,
}: AutomationContext) {
  if (!wasmBreakpoints) {
    throw new Error("hero mapping requires its certified breakpoint set");
  }
  await installHeroMappingPanel(page);
  const steps = [];
  for (const [index, task] of HERO_MAPPING_TASKS.entries()) {
    const session = await wasmBreakpoints.start(task.functions);
    await page.evaluate((step) => {
      (
        window as unknown as {
          __gwHeroMapping?: { show(index: number): void };
        }
      ).__gwHeroMapping?.show(step);
    }, index);
    const before = await mappingState(page);
    const decision = await mappingDecision(page);
    const trace = await session.finish();
    const after = await mappingState(page);
    const outcome: "done" | "skipped" =
      decision === "done" ? "done" : "skipped";
    steps.push({ task, outcome, before, after, trace });
    await page.evaluate(
      ({ step, result, hits }) => {
        (
          window as unknown as {
            __gwHeroMapping?: {
              mark(
                index: number,
                outcome: "done" | "skipped",
                hits: number,
              ): void;
            };
          }
        ).__gwHeroMapping?.mark(step, result, hits);
      },
      { step: index, result: outcome, hits: trace.hits.length },
    );
    if (decision === "finish") break;
  }
  await page.evaluate(() => {
    (
      window as unknown as {
        __gwHeroMapping?: { complete(): void };
      }
    ).__gwHeroMapping?.complete();
  });
  await mappingDecision(page);
  return {
    functions: HERO_MAPPING_FUNCTIONS,
    plannedSteps: HERO_MAPPING_TASKS.length,
    steps,
  };
}

async function runTeamReadback({ evaluate, wait }: AutomationContext) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const team = await evaluate(() => {
      const value = window.gwCompanionTeam;
      return value?.status === "ready"
        ? (value as unknown as {
            status: "ready";
            sequence: number;
            tickCount: number;
            members: Array<{
              agentId: number;
              heroId: number;
              primary: number;
              secondary: number;
              level: number;
              behavior: number;
              disabledSkills: number;
              attributes: Array<{ id: number; rank: number }>;
              skills: number[];
            }>;
            player: {
              attributes: Array<{ id: number; rank: number }>;
              skills: number[];
            };
          })
        : null;
    });
    if (team) return team;
    await wait(100);
  }
  throw new Error("team readback did not become ready");
}

type LiveTeamMember = Readonly<{
  agentId: number;
  heroId: number;
  primary: number;
  secondary: number;
  level: number;
  behavior: number;
  disabledSkills: number;
  attributes: readonly Readonly<{ id: number; rank: number }>[];
  skills: readonly number[];
}>;

function journalMembers(members: readonly LiveTeamMember[]) {
  return members.map(({ agentId, ...member }) => {
    void agentId;
    return member;
  });
}

async function runTeamWriteRoundtrip({ evaluate, wait }: AutomationContext) {
  const read = () =>
    evaluate(() => {
      const state = window.gwCompanionState;
      const team = window.gwCompanionTeam;
      return state?.status === "ready" &&
        state.instanceType === 0 &&
        team?.status === "ready" &&
        Array.isArray(team.members)
          ? {
            clientBuild: Number(window.gwCompanionRuntime?.buildId ?? 0),
            mapId: Number(state.mapId),
            hardMode: team.hardMode === true,
            members: team.members as unknown as LiveTeamMember[],
            command: team.command as
              | {
                  id: number;
                  status: number;
                  phase: number;
                  completedSteps: number;
                  error: number;
                  warnings: number;
                }
              | undefined,
          }
        : null;
    });
  const apply = (
    desired: LiveTeamMember,
    roster: readonly LiveTeamMember[],
    hardMode: boolean,
  ) => {
    const profession = (id: number) => {
      const value = PROFESSION_BY_ID.get(id);
      if (!value) throw new Error(`unknown live profession ${id}`);
      return value;
    };
    const target = {
      hero: desired.heroId,
      build: {
        professions: [
          profession(desired.primary),
          desired.secondary === 0 ? null : profession(desired.secondary),
        ],
        attributes: Object.fromEntries(
          desired.attributes.map(({ id, rank }) => {
            const attribute = ATTRIBUTE_BY_ID.get(id);
            if (!attribute) throw new Error(`unknown live attribute ${id}`);
            return [attribute, rank];
          }),
        ),
        skills: desired.skills,
      },
      behaviour: (["fight", "guard", "avoid"] as const)[desired.behavior],
      disabled: Array.from({ length: 8 }, (_, slot) => slot)
        .filter((slot) => (desired.disabledSkills & (1 << slot)) !== 0),
    };
    const plan = {
      mode: hardMode ? "hard" : "normal",
      members: [
        { hero: null, build: null, behaviour: null, disabled: [] },
        ...roster
          .filter((member) => member.heroId !== 0)
          .map((member) =>
            member.heroId === desired.heroId
              ? target
              : {
                  hero: member.heroId,
                  build: null,
                  behaviour: (["fight", "guard", "avoid"] as const)[
                    member.behavior
                  ],
                  disabled: Array.from({ length: 8 }, (_, slot) => slot)
                    .filter(
                      (slot) =>
                        (member.disabledSkills & (1 << slot)) !== 0,
                    ),
                },
          ),
      ],
    };
    return evaluate((argument) => {
      const runtime = window.gwCompanionRuntime;
      const operation = runtime?.applyTeam;
      if (typeof operation !== "function") {
        throw new Error("team reconciler is unavailable");
      }
      return Number(Reflect.apply(operation, runtime, [argument]));
    }, plan);
  };
  const waitForCommand = async (commandId: number, heroId: number) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      await wait(100);
      const current = await read();
      if (current?.command?.id !== commandId) continue;
      if (current.command.status === 3) {
        throw new Error(
          `team command ${commandId} failed at phase ${current.command.phase} after ${current.command.completedSteps} acknowledged steps (error ${current.command.error})`,
        );
      }
      if (current.command.status === 2) {
        const member = current.members.find(
          (candidate) => candidate.heroId === heroId,
        );
        if (!member) throw new Error("hero disappeared after reconciliation");
        return { command: current.command, member };
      }
    }
    throw new Error(`hero build command ${commandId} was not acknowledged`);
  };

  const initial = await read();
  const hero = initial?.members.find((member) => member.heroId !== 0);
  if (!initial || !hero) {
    throw new Error("hero build proof requires an owned hero in an outpost");
  }

  const attributeSource = hero.attributes.findIndex(({ rank }) => rank === 2);
  const attributeTarget = hero.attributes.findIndex(
    ({ rank }, index) => index !== attributeSource && rank === 1,
  );
  if (attributeSource < 0 || attributeTarget < 0) {
    throw new Error(
      "the selected hero has no equal-cost attribute redistribution",
    );
  }
  const changedAttributes = hero.attributes.map((attribute, index) => ({
    ...attribute,
    rank: index === attributeSource
      ? 1
      : index === attributeTarget
        ? 2
        : attribute.rank,
  }));

  const firstDifferent = hero.skills.findIndex(
    (skill, index) => index > 0 && skill !== hero.skills[0],
  );
  if (firstDifferent < 0) {
    throw new Error("the selected hero has no two distinct skills to swap");
  }
  const changedSkills = [...hero.skills];
  [changedSkills[0], changedSkills[firstDifferent]] = [
    changedSkills[firstDifferent]!,
    changedSkills[0]!,
  ];
  const changedDesired = {
    ...hero,
    attributes: changedAttributes,
    skills: changedSkills,
    behavior: hero.behavior === 0 ? 1 : 0,
    disabledSkills: hero.disabledSkills ^ 1,
  };
  await prepareMutationJournal({
    scenario: "hero-build-reconcile",
    clientBuild: initial.clientBuild,
    mapId: initial.mapId,
    before: journalMembers(initial.members),
    planned: journalMembers(
      initial.members.map((member) =>
        member.heroId === hero.heroId ? changedDesired : member
      ),
    ),
  });
  const changedCommandId = await apply(
    changedDesired,
    initial.members,
    initial.hardMode,
  );
  let changed;
  try {
    changed = await waitForCommand(changedCommandId, hero.heroId);
  } catch (error) {
    const restoreCommandId = await apply(
      hero,
      initial.members,
      initial.hardMode,
    );
    const emergencyRestore = await waitForCommand(
      restoreCommandId,
      hero.heroId,
    );
    await advanceMutationJournal(
      "restored",
      emergencyRestore.command.completedSteps,
    );
    throw error;
  }
  await advanceMutationJournal(
    "mutated",
    changed.command.completedSteps,
  );
  const restoreCommandId = await apply(
    hero,
    initial.members,
    initial.hardMode,
  );
  const restored = await waitForCommand(restoreCommandId, hero.heroId);
  await advanceMutationJournal(
    "restored",
    restored.command.completedSteps,
  );
  return {
    mapId: initial.mapId,
    heroId: hero.heroId,
    initial: hero,
    changedDesired,
    changed,
    restored,
  };
}

async function runTeamRosterRoundtrip({ evaluate, wait }: AutomationContext) {
  const read = () =>
    evaluate(() => {
      const state = window.gwCompanionState;
      const team = window.gwCompanionTeam;
      return state?.status === "ready"
        && state.instanceType === 0
        && team?.status === "ready"
        && Array.isArray(team.members)
        ? {
            clientBuild: Number(window.gwCompanionRuntime?.buildId ?? 0),
            mapId: Number(state.mapId),
            hardMode: team.hardMode === true,
            members: team.members as unknown as LiveTeamMember[],
            command: team.command as {
              id: number;
              status: number;
              phase: number;
              completedSteps: number;
              error: number;
              warnings: number;
            },
          }
        : null;
    });
  const submit = (members: readonly LiveTeamMember[], hardMode: boolean) =>
    evaluate((argument) => {
      const runtime = window.gwCompanionRuntime;
      if (typeof runtime?.applyTeam !== "function") {
        throw new Error("team reconciler is unavailable");
      }
      return Number(Reflect.apply(runtime.applyTeam, runtime, [argument]));
    }, {
      mode: hardMode ? "hard" : "normal",
      members: [
        { hero: null, build: null, behaviour: null, disabled: [] },
        ...members
          .filter((member) => member.heroId !== 0)
          .map((member) => ({
            hero: member.heroId,
            build: null,
            behaviour: (["fight", "guard", "avoid"] as const)[
              member.behavior
            ],
            disabled: Array.from({ length: 8 }, (_, slot) => slot)
              .filter(
                (slot) => (member.disabledSkills & (1 << slot)) !== 0,
              ),
          })),
      ],
    });
  const waitFor = async (commandId: number, expectedHeroIds: number[]) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      await wait(100);
      const current = await read();
      if (current?.command.id !== commandId) continue;
      if (current.command.status === 3) {
        throw new Error(
          `roster command ${commandId} failed at phase ${current.command.phase} after ${current.command.completedSteps} acknowledged steps (error ${current.command.error})`,
        );
      }
      if (current.command.status === 2) {
        const heroIds = current.members
          .filter((member) => member.heroId !== 0)
          .map((member) => member.heroId);
        if (JSON.stringify(heroIds) !== JSON.stringify(expectedHeroIds)) {
          throw new Error("roster acknowledgement disagrees with readback");
        }
        return current.command;
      }
    }
    throw new Error(`roster command ${commandId} was not acknowledged`);
  };

  const initial = await read();
  const initialHeroIds = initial?.members
    .filter((member) => member.heroId !== 0)
    .map((member) => member.heroId) ?? [];
  if (!initial || initialHeroIds.length === 0) {
    throw new Error("roster proof requires at least one hero in a PvE outpost");
  }
  const player = initial.members.filter((member) => member.heroId === 0);
  await prepareMutationJournal({
    scenario: "hero-roster-reconcile",
    clientBuild: initial.clientBuild,
    mapId: initial.mapId,
    before: journalMembers(initial.members),
    planned: journalMembers(player),
  });
  const removedId = await submit(player, initial.hardMode);
  const removed = await waitFor(removedId, []);
  await advanceMutationJournal("mutated", removed.completedSteps);
  const restoredId = await submit(initial.members, initial.hardMode);
  const restored = await waitFor(restoredId, initialHeroIds);
  await advanceMutationJournal("restored", restored.completedSteps);
  return { initialHeroIds, removed, restored };
}

const noEvidence = async () => null;
const acceptEvidence = () => {};

export const SCENARIOS: Readonly<Record<string, LiveScenario>> = Object.freeze({
  // Reaching a playable character is itself a keypress, so the scenarios that
  // only need the client up are automation too. `tier` names what the run does,
  // not how interesting its evidence is.
  boot: Object.freeze({
    tier: "automation",
    run: noEvidence,
    validate: acceptEvidence,
  }),
  target: Object.freeze({
    tier: "automation",
    run: runTarget,
    validate(result: { evidence?: Awaited<ReturnType<typeof runTarget>> }) {
      validateTargetAcquisition(result.evidence);
    },
  }),
  "target-readout": Object.freeze({
    tier: "automation",
    run: runTargetReadout,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runTargetReadout>>;
    }) {
      const evidence = result.evidence;
      validateTargetAcquisition(evidence);
      const expected = `${Math.round(evidence.acquired.distance)} ${evidence.acquired.range}`;
      if (
        evidence.presentation.count !== 1 ||
        evidence.presentation.visible !== true ||
        evidence.presentation.runtime?.visible !== true ||
        evidence.presentation.runtime.line !== expected ||
        !evidence.presentation.text.includes(
          String(Math.round(evidence.acquired.distance)),
        ) ||
        !evidence.presentation.text.includes(evidence.acquired.range)
      ) {
        throw new Error("target readout did not render the acquired target");
      }
    },
  }),
  movement: Object.freeze({
    tier: "automation",
    run: runMovement,
    validate(result: { evidence?: Awaited<ReturnType<typeof runMovement>> }) {
      if (!((result.evidence?.distance ?? 0) > 5)) {
        throw new Error("movement scenario did not move the player");
      }
    },
  }),
  reload: Object.freeze({
    tier: "automation",
    run: noEvidence,
    validate: acceptEvidence,
  }),
  // The one observation-tier scenario today: it reads typed addresses and the
  // cursor the renderer published, and asks a human for every state change.
  "cursor-capture": Object.freeze({
    tier: "observation",
    run: runCursorCapture,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runCursorCapture>>;
    }) {
      if (!((result.evidence?.changeCount ?? 0) > 1)) {
        throw new Error("cursor capture observed no state transition");
      }
    },
  }),
  "hero-trace": Object.freeze({
    tier: "observation",
    run: runHeroTrace,
    validate(result: { evidence?: Awaited<ReturnType<typeof runHeroTrace>> }) {
      if (!((result.evidence?.hits.length ?? 0) > 0)) {
        throw new Error("hero trace observed none of the candidate functions");
      }
    },
  }),
  "hero-map": Object.freeze({
    tier: "automation",
    run: runHeroMappingSession,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runHeroMappingSession>>;
    }) {
      const evidence = result.evidence;
      if (
        !evidence ||
        evidence.steps.length === 0 ||
        evidence.steps.every((step) => step.outcome === "skipped")
      ) {
        throw new Error("hero mapping session recorded no completed action");
      }
    },
  }),
  "team-readback": Object.freeze({
    tier: "automation",
    run: runTeamReadback,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runTeamReadback>>;
    }) {
      const team = result.evidence;
      if (
        !team ||
        !Array.isArray(team.members) ||
        team.members.length < 1 ||
        !Array.isArray(team.player?.skills) ||
        team.player.skills.length !== 8 ||
        !Array.isArray(team.player?.attributes)
      ) {
        throw new Error(
          "team readback did not publish a complete player build",
        );
      }
    },
  }),
  "hero-build-reconcile": Object.freeze({
    tier: "automation",
    mutates: true,
    run: runTeamWriteRoundtrip,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runTeamWriteRoundtrip>>;
    }) {
      const evidence = result.evidence;
      if (
        !evidence ||
        evidence.changed.command.status !== 2 ||
        evidence.changed.command.completedSteps < 4 ||
        evidence.changed.command.warnings !== 0 ||
        JSON.stringify(evidence.changed.member) !==
          JSON.stringify(evidence.changedDesired) ||
        evidence.restored.command.status !== 2 ||
        evidence.restored.command.warnings !== 0 ||
        evidence.restored.command.completedSteps < 3 ||
        JSON.stringify(evidence.restored.member) !==
          JSON.stringify(evidence.initial)
      ) {
        throw new Error(
          "hero build reconciler did not complete and restore the hero",
        );
      }
    },
  }),
  "hero-roster-reconcile": Object.freeze({
    tier: "automation",
    mutates: true,
    run: runTeamRosterRoundtrip,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runTeamRosterRoundtrip>>;
    }) {
      const evidence = result.evidence;
      if (
        !evidence
        || evidence.removed.status !== 2
        || evidence.removed.completedSteps < evidence.initialHeroIds.length
        || evidence.restored.status !== 2
        || evidence.restored.completedSteps < evidence.initialHeroIds.length
      ) {
        throw new Error("hero roster was not removed and restored");
      }
    },
  }),
  "map-transition": Object.freeze({
    tier: "automation",
    run: runMapTransition,
    validate(result: {
      evidence?: Awaited<ReturnType<typeof runMapTransition>>;
    }) {
      const evidence = result.evidence;
      if (
        evidence?.loading.status !== "waiting" ||
        evidence.loading.reason === null ||
        !["loading", "game"].includes(evidence.loading.reason) ||
        evidence.loading.exposesMap ||
        evidence.loading.exposesPlayer ||
        evidence.loading.exposesTarget ||
        evidence.before.mapId === evidence.after.mapId ||
        evidence.after.mapId !== evidence.route.toMapId
      ) {
        throw new Error("map transition exposed stale or unchanged state");
      }
    },
  }),
  performance: Object.freeze({
    tier: "automation",
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
      evidence?: Awaited<
        ReturnType<typeof import("./performance.js").runPerformanceScenario>
      >;
    }) {
      const evidence = result.evidence;
      const off = evidence?.arms?.[BENCHMARK_ARMS.dispatcherOff];
      const on = evidence?.arms?.[BENCHMARK_ARMS.observerOn];
      if (!evidence || !off || !on) {
        throw new Error("performance scenario recorded no comparable arms");
      }
      if (!isBalancedOrder(evidence.order)) {
        throw new Error(
          `performance scenario measured in a biased order: ${JSON.stringify(
            evidence.order,
          )}`,
        );
      }
      if (
        off.frames.count < 2_500 ||
        off.ticks !== 0 ||
        on.frames.count < 2_500 ||
        on.ticks < 2_500 ||
        (evidence.comparison.p95RegressionPercent > 2 &&
          evidence.comparison.p99RegressionPercent > 2) ||
        evidence.comparison.p95DeltaMs > 1
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
 * — `nativeCursor` on, `targetReadout` off, `GW_ENHANCEMENT_AUTOMATION` unset even
 * when the caller's own environment exports it — and gets no IPC channel, so
 * `child.send` does not exist to be called.
 *
 * Returns null for an unknown scenario name.
 */
export function liveRunPlan(
  name: string,
  {
    baseEnv,
    userData,
    cachedOnly,
  }: {
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
  if (cachedOnly) env.GW_REQUIRE_CACHED_CLIENT = "1";
  return {
    name,
    scenario,
    tier: scenario.tier,
    mutates: scenario.mutates === true,
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
  preflight: Pick<
    EnhancementDoctorReport,
    "readyForCachedLive" | "credentials" | "targetReadout" | "nativeCursor"
  >,
  { cachedOnly }: { cachedOnly: boolean },
):
  | "cached-client-incomplete"
  | "saved-login-missing"
  | "target-readout-disabled"
  | "native-cursor-disabled"
  | null {
  if (cachedOnly && !preflight.readyForCachedLive) {
    return "cached-client-incomplete";
  }
  if (preflight.credentials !== "saved") return "saved-login-missing";
  if (plan.name === "target-readout" && !preflight.targetReadout) {
    return "target-readout-disabled";
  }
  // An observation run enables nothing: the Enhancement installs only because the
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
  tier: LiveTier,
  capabilities: LiveCapabilities,
): AutomationContext | ObservationContext {
  const {
    page,
    cdp,
    sendAutomationCommand,
    sampleObservations,
    wasmBreakpoints,
  } = capabilities;
  const observation: ObservationContext = {
    evaluate: (body, argument) => page.evaluate(body, argument),
    wait: (milliseconds) => page.waitForTimeout(milliseconds),
    sample: sampleObservations,
    wasmBreakpoints,
  };
  return Object.freeze(
    tier === "automation"
      ? { ...observation, page, cdp, sendAutomationCommand }
      : observation,
  );
}
