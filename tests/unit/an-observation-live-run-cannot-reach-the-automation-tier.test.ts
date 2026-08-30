// The automation/observation boundary is executed rather than described.
//
// Every one of these runs the real decision functions from
// scripts/enhancements-live/scenarios.ts: the launch plan the runner spawns
// Electron with, the context object it hands the scenario, and the bootstrap
// wait, driven against a page double that records what was touched. Nothing
// here reads source text, and nothing needs a build or a game.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CDPSession, Page } from "playwright";
import {
  changedWasmCallCounts,
  liveRunPlan,
  liveRunRefusal,
  projectWasmCallCounts,
  scenarioContext,
  SCENARIOS,
  waitForPlayable,
} from "../../scripts/enhancements-live/scenarios.js";
import { validateCommonAcceptance } from "../../scripts/enhancements-live/acceptance.js";

// The register itself, not a local restatement of it: the first case below
// asserts that every entry declares one of the two tiers, and asserting that
// against a hand-written `Record<string, Scenario>` would only be asserting
// against this file.
const scenarios = SCENARIOS;

const planFor = (name: string, baseEnv: Record<string, string> = {}) => {
  const plan = liveRunPlan(name, {
    baseEnv,
    userData: "/tmp/profile",
    cachedOnly: true,
  });
  assert.ok(plan, `expected a registered scenario named ${name}`);
  return plan;
};

const asPage = (page: unknown) => page as Page;
const asCdp = (cdp: unknown) => cdp as CDPSession;

/** A page that fails the test if anything asks it to synthesize input. */
function recordingPage(ready: boolean) {
  const touched: string[] = [];
  const forbid = (name: string) => {
    touched.push(name);
    throw new Error(`the observation tier must not use page.${name}`);
  };
  return {
    touched,
    presses: 0,
    waitForFunction: async () => undefined,
    evaluate: async () => ready,
    waitForTimeout: async () => undefined,
    get keyboard() {
      forbid("keyboard");
      return null;
    },
    get mouse() {
      forbid("mouse");
      return null;
    },
    get locator() {
      forbid("locator");
      return null;
    },
  };
}

/** The same double, but with input available and counted. */
function automatablePage(ready: boolean) {
  const page = {
    presses: 0,
    waitForFunction: async () => undefined,
    evaluate: async () => ready,
    waitForTimeout: async () => undefined,
    keyboard: { press: async () => { page.presses += 1; } },
    mouse: {},
    locator: () => ({ focus: async () => undefined }),
  };
  return page;
}

describe("an observation live run cannot reach the automation tier", () => {
  it("gives every scenario exactly one tier", () => {
    const tiers = Object.entries(scenarios).map(([name, scenario]) => {
      assert.ok(
        scenario.tier === "observation"
          || scenario.tier === "graphics-observation"
          || scenario.tier === "automation",
        `${name} declares no tier`,
      );
      return scenario.tier;
    });
    // Both tiers exist, so neither branch below is dead.
    assert.ok(tiers.includes("observation"));
    assert.ok(tiers.includes("graphics-observation"));
    assert.ok(tiers.includes("automation"));
  });

  it("declares readiness independently from automation permission", () => {
    assert.equal(planFor("boot").scenario.readiness, "frontend");
    assert.equal(planFor("target").scenario.readiness, "observer");
    assert.equal(planFor("toolbox-foundation").scenario.readiness, "toolbox");
    assert.equal(planFor("cursor-capture").scenario.readiness, "cursor");
    assert.equal(planFor("graphics-probe").scenario.readiness, "frontend");
  });

  it("launches the app with the automation gate off, whatever the caller exports", () => {
    // The developer's own shell may export the variable; inheriting it would
    // silently turn an observation run back into an automation run.
    const observation = planFor("cursor-capture", { GW_ENHANCEMENT_AUTOMATION: "1" });
    assert.equal(observation.tier, "observation");
    assert.equal("GW_ENHANCEMENT_AUTOMATION" in observation.env, false);
    assert.equal(planFor("graphics-probe").scenario.program, "none");
    assert.equal(planFor("cartography-probe").scenario.program, "none");

    const automation = planFor("movement");
    assert.equal(automation.env.GW_ENHANCEMENT_AUTOMATION, "1");
  });

  it("opens no parent-process command channel for an observation run", () => {
    // main.ts serves AUTOMATION_COMMAND over the Node IPC channel. Without the
    // channel there is nothing to send on: child.send does not exist.
    assert.deepEqual(planFor("cursor-capture").stdio, ["ignore", "pipe", "pipe"]);
    assert.deepEqual(planFor("graphics-probe").stdio, ["ignore", "pipe", "pipe"]);
    assert.deepEqual(planFor("cartography-probe").stdio, ["ignore", "pipe", "pipe"]);
    assert.deepEqual(planFor("movement").stdio, [
      "ignore",
      "pipe",
      "pipe",
      "ipc",
    ]);
  });

  it("keeps the rest of the launch decision unchanged", () => {
    const plan = planFor("boot", { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin" })!;
    assert.equal(plan.env.GW_EXPECT_USER_DATA, "/tmp/profile");
    assert.equal(plan.env.GW_REQUIRE_CACHED_CLIENT, "1");
    assert.equal(plan.env.PATH, "/usr/bin");
    // Electron would run as a bare Node process and never open a window.
    assert.equal("ELECTRON_RUN_AS_NODE" in plan.env, false);
    assert.equal(
      liveRunPlan("no-such-scenario", {
        baseEnv: {},
        userData: "/tmp/profile",
        cachedOnly: true,
      }),
      null,
    );
  });

  it("keeps developer-program preflight independent from saved cursor settings", () => {
    const ready = {
      readyForCachedLive: true,
      nativeCursor: false,
    } as const;
    const options = { cachedOnly: true };
    assert.equal(liveRunRefusal(planFor("cursor-capture"), ready, options), null);
    assert.equal(liveRunRefusal(planFor("toolbox-foundation"), ready, options), null);
    assert.equal(liveRunRefusal(planFor("movement"), ready, options), null);
    // The target-readout scenario runs on its developer program, so a profile
    // with every tool off refuses nothing beyond the cache gate.
    assert.equal(liveRunRefusal(planFor("target-readout"), ready, options), null);
    assert.equal(
      liveRunRefusal(
        planFor("cursor-capture"),
        { ...ready, readyForCachedLive: false },
        options,
      ),
      "cached-client-incomplete",
    );
    assert.equal(
      liveRunRefusal(
        planFor("cursor-capture"),
        { ...ready, readyForCachedLive: false },
        { cachedOnly: false },
      ),
      null,
    );
  });

  it("hands an observation scenario no handle that can act on the player", () => {
    const capabilities = {
      page: asPage({
        evaluate: async () => "read",
        waitForTimeout: async () => undefined,
      }),
      cdp: asCdp({ send: async () => undefined }),
      sendAutomationCommand: async () => undefined,
    };
    const observation = scenarioContext("observation", capabilities);
    assert.deepEqual(
      Object.keys(observation).sort(),
      [
        "captureWasmCallCounts",
        "readCharacterListProjection",
        "readCharacterSwitchDiagnostics",
        "readCursorProjection",
        "readRendererErrorCount",
        "wait",
      ],
    );
    for (const capability of [
      "page",
      "cdp",
      "sendAutomationCommand",
      "evaluate",
    ]) {
      assert.equal(capability in observation, false);
    }
    // It is frozen, so a scenario cannot add one back for itself.
    assert.throws(() => {
      Object.assign(observation, { page: capabilities.page });
    }, TypeError);

    const automation = scenarioContext("automation", capabilities);
    // The positive half of the same property: the automation tier is handed
    // the two capabilities the loop above proved the observation tier is not.
    // `in` is what narrows the returned union, so this is the assertion and
    // the narrowing at once.
    assert.ok("page" in automation && "sendAutomationCommand" in automation);
    assert.equal(automation.page, capabilities.page);
    assert.equal(automation.sendAutomationCommand, capabilities.sendAutomationCommand);

    const graphics = planFor("graphics-probe").scenario;
    assert.equal(graphics.tier, "graphics-observation");
    assert.equal("run" in graphics, false);
  });

  it("projects only bounded numeric WASM samples and compares equal windows", () => {
    const coverage = projectWasmCallCounts({
      profile: {
        nodes: [
          { id: 1, callFrame: { functionName: "wasm-function[6508]" } },
          { id: 2, callFrame: { functionName: "wasm-function[6797]" } },
          { id: 3, callFrame: { functionName: "not-wasm" } },
          { id: 4, callFrame: { functionName: "private value that must not survive" } },
        ],
        samples: [1, 1, 1, 2, 3, 4],
      },
    });
    assert.deepEqual(coverage, [
      { functionIndex: 6508, sampleCount: 3 },
      { functionIndex: 6797, sampleCount: 1 },
    ]);
    assert.deepEqual(changedWasmCallCounts(
      [{ functionIndex: 6508, sampleCount: 2 }],
      coverage,
    ), [
      { functionIndex: 6508, sampleCount: 3, baselineCount: 2, excessCount: 1 },
      { functionIndex: 6797, sampleCount: 1, baselineCount: 0, excessCount: 1 },
    ]);
    assert.doesNotMatch(JSON.stringify(coverage), /private|not-wasm/);
  });

  it("lets an observation scenario read only its fixed projections", async () => {
    const context = scenarioContext("observation", {
      page: asPage({
        evaluate: async (_body: unknown, argument: unknown) => argument ?? "read",
        waitForTimeout: async () => "waited",
      }),
      cdp: asCdp(null),
      sendAutomationCommand: async () => undefined,
    }) as {
      readCursorProjection: () => Promise<unknown>;
      readCharacterListProjection: () => Promise<unknown>;
      readRendererErrorCount: () => number;
      wait: (ms: number) => Promise<unknown>;
    };
    assert.equal(await context.readCursorProjection(), "read");
    assert.equal(await context.readCharacterListProjection(), "read");
    assert.equal(context.readRendererErrorCount(), 0);
    assert.equal(await context.wait(1), undefined);
  });

  it("attributes the one expected renderer teardown error only to reload", () => {
    const phase = (name: string, start = 0, end = start) => ({
      name,
      sampleCount: 1,
      missedSampleCount: 0,
      rendererErrorCountStart: start,
      rendererErrorCountEnd: end,
      first: { reason: null },
      last: { reason: null },
      statuses: ["ready"],
      counts: [1],
      revisions: [1],
      transitions: ["unchanged"],
      maxStableRootReads: 3,
    });
    const names = [
      "cold-before-login",
      "login-to-character-select",
      "settled-character-select",
      "selection-changes",
      "first-outpost",
      "settled-in-world",
      "logout-to-character-select",
      "second-character",
      "renderer-reload",
      "post-reload",
    ];
    const scenario = scenarios["character-list"]!;
    const accepted = names.map((name) =>
      name === "renderer-reload" ? phase(name, 0, 1) : phase(name));
    assert.doesNotThrow(() => scenario.validate({
      rendererErrorCount: 1,
      evidence: { phases: accepted },
    }));
    assert.throws(() => scenario.validate({
      rendererErrorCount: 1,
      evidence: {
        phases: names.map((name) =>
          name === "first-outpost" ? phase(name, 0, 1) : phase(name)),
      },
    }), /closed projection/);
    assert.throws(() => scenario.validate({
      rendererErrorCount: 2,
      evidence: {
        phases: names.map((name) =>
          name === "renderer-reload" ? phase(name, 0, 2) : phase(name)),
      },
    }), /closed projection/);
  });

  it("synthesizes no bootstrap input when the client is not yet playable", async () => {
    // The pre-split runner pressed Enter up to three times to get an idle
    // client past its login screen, for every scenario.
    const page = recordingPage(false);
    assert.equal(await waitForPlayable(asPage(page), "observation", "cursor"), 0);
    assert.deepEqual(page.touched, []);
  });

  it("still nudges an automation run, so the double above would have caught it", async () => {
    const page = automatablePage(false);
    assert.equal(await waitForPlayable(asPage(page), "automation", "observer"), 3);
    assert.equal(page.presses, 3);

    const playable = automatablePage(true);
    assert.equal(await waitForPlayable(asPage(playable), "automation", "observer"), 0);
    assert.equal(playable.presses, 0);
  });

  it("does not require target-state evidence from a cursor-only observation", () => {
    const result = {
      supported: true,
      buildId: 38_771,
      installation: 1,
      hookHertz: 0,
      map: null,
      renderP95Us: 0,
      rejectedSnapshots: 0,
      rendererErrors: [],
    };
    assert.doesNotThrow(() =>
      validateCommonAcceptance(result, 38_771, { coreObservation: false }),
    );
    assert.throws(
      () => validateCommonAcceptance(result, 38_771),
      /hook cadence/,
    );
  });

  it("does not pretend a program-free boot smoke installed Enhancement", () => {
    const result = {
      supported: false,
      buildId: null,
      installation: 0,
      hookHertz: 0,
      map: null,
      renderP95Us: 0,
      rejectedSnapshots: 0,
      rendererErrors: [],
    };
    assert.doesNotThrow(() => validateCommonAcceptance(result, 38_771, {
      enhancementExpected: false,
      coreObservation: false,
    }));
  });

  it("accepts the target-readout run only when the real surface matches its snapshot", () => {
    const evidence = {
      initial: { valid: false },
      acquired: {
        valid: true,
        id: 9,
        distance: 1_248.4,
        range: "Spellcast",
      },
      presentation: {
        count: 1,
        visible: true,
        text: "Target1248Spellcast",
        runtime: { visible: true, line: "1248 Spellcast" },
      },
    };
    const scenario = scenarios["target-readout"]!;
    assert.doesNotThrow(() => scenario.validate({ evidence }));
    assert.throws(
      () =>
        scenario.validate({
          evidence: {
            ...evidence,
            presentation: {
              ...evidence.presentation,
              runtime: { visible: true, line: "1249 Spellcast" },
            },
          },
        }),
      /did not render/,
    );
    assert.throws(
      () =>
        scenario.validate({
          evidence: {
            ...evidence,
            presentation: { ...evidence.presentation, count: 0 },
          },
        }),
      /did not render/,
    );
  });
});
