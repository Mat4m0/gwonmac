// P4.7 — the automation/observation line, executed rather than described.
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
  liveRunPlan,
  liveRunRefusal,
  scenarioContext,
  SCENARIOS,
} from "../../scripts/enhancements-live/scenarios.js";
import { validateCommonAcceptance } from "../../scripts/enhancements-live/acceptance.js";
import { waitForPlayable } from "../../scripts/enhancements-live/session.js";

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
    evaluate: async (body: unknown, argument?: unknown) => {
      const source = String(body);
      if (source.includes("performance.now") && argument === undefined) return 0;
      if (source.includes("getElementById")) {
        return {
          atMs: 0,
          reason: "initial",
          input: 0,
          progress: "ready",
          stage: ready ? "game.outpost" : "client.frontend",
          enhancementStatus: ready ? "ready" : "not-installed",
          tickCount: ready ? 6 : 0,
          canvasReady: true,
          loadingVisible: false,
        };
      }
      return ready;
    },
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
    evaluate: async (body: unknown, argument?: unknown) => {
      const source = String(body);
      if (source.includes("performance.now") && argument === undefined) return 0;
      if (source.includes("getElementById")) {
        return {
          atMs: 0,
          reason: "initial",
          input: page.presses,
          progress: "ready",
          stage: ready ? "game.outpost" : "client.frontend",
          enhancementStatus: ready ? "ready" : "not-installed",
          tickCount: ready ? 6 : 0,
          canvasReady: true,
          loadingVisible: false,
        };
      }
      return ready;
    },
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
        scenario.tier === "observation" || scenario.tier === "automation",
        `${name} declares no tier`,
      );
      return scenario.tier;
    });
    // Both tiers exist, so neither branch below is dead.
    assert.ok(tiers.includes("observation"));
    assert.ok(tiers.includes("automation"));
  });

  it("launches the app with the automation gate off, whatever the caller exports", () => {
    // The developer's own shell may export the variable; inheriting it would
    // silently turn an observation run back into an automation run.
    const observation = planFor("cursor-capture", { GW_ENHANCEMENT_AUTOMATION: "1" });
    assert.equal(observation.tier, "observation");
    assert.equal("GW_ENHANCEMENT_AUTOMATION" in observation.env, false);

    const automation = planFor("movement");
    assert.equal(automation.env.GW_ENHANCEMENT_AUTOMATION, "1");
    assert.equal(planFor("hero-map").tier, "automation");
  });

  it("opens no parent-process command channel for an observation run", () => {
    // main.ts serves AUTOMATION_COMMAND over the Node IPC channel. Without the
    // channel there is nothing to send on: child.send does not exist.
    assert.deepEqual(planFor("cursor-capture").stdio, ["ignore", "pipe", "pipe"]);
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

  it("refuses an observation run against a profile with the cursor turned off", () => {
    // Nothing else would install the Enhancement for it, so the run would sit in a
    // thirty-minute wait for a hook that never arrives.
    const ready = {
      readyForCachedLive: true,
      credentials: "saved",
      nativeCursor: false,
      targetReadout: false,
    } as const;
    const options = { cachedOnly: true };
    assert.equal(
      liveRunRefusal(planFor("cursor-capture"), ready, options),
      "native-cursor-disabled",
    );
    // An automation run forces the Enhancement on regardless of the setting.
    assert.equal(liveRunRefusal(planFor("movement"), ready, options), null);
    assert.equal(
      liveRunRefusal(planFor("cursor-capture"), { ...ready, nativeCursor: true }, options),
      null,
    );
    // The two refusals that predate the split still come first.
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
      "native-cursor-disabled",
    );
    assert.equal(
      liveRunRefusal(planFor("movement"), { ...ready, credentials: "missing" }, options),
      "saved-login-missing",
    );
    assert.equal(
      liveRunRefusal(planFor("target-readout"), ready, options),
      "target-readout-disabled",
    );
    assert.equal(
      liveRunRefusal(
        planFor("target-readout"),
        { ...ready, targetReadout: true },
        options,
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
      sampleObservations: async () => [],
      wasmBreakpoints: null,
    };
    const observation = scenarioContext("observation", capabilities);
    assert.deepEqual(
      Object.keys(observation).sort(),
      ["evaluate", "sample", "wait", "wasmBreakpoints"],
    );
    for (const capability of ["page", "cdp", "sendAutomationCommand"]) {
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
  });

  it("still lets an observation scenario read", async () => {
    const context = scenarioContext("observation", {
      page: asPage({
        evaluate: async (_body: unknown, argument: unknown) => argument ?? "read",
        waitForTimeout: async () => "waited",
      }),
      cdp: asCdp(null),
      sendAutomationCommand: async () => undefined,
      sampleObservations: async () => [
        { type: "u8", address: 0, value: 7, valid: true },
      ],
      wasmBreakpoints: null,
    }) as {
      evaluate: (body: unknown, argument?: unknown) => Promise<unknown>;
      wait: (ms: number) => Promise<unknown>;
      sample: () => Promise<unknown>;
    };
    assert.equal(await context.evaluate(() => undefined), "read");
    assert.deepEqual(await context.sample(), [
      { type: "u8", address: 0, value: 7, valid: true },
    ]);
    assert.equal(await context.wait(1), "waited");
  });

  it("synthesizes no bootstrap input when the client is not yet playable", async () => {
    // The pre-split runner pressed Enter up to three times to get an idle
    // client past its login screen, for every scenario.
    const page = recordingPage(false);
    assert.equal((await waitForPlayable(asPage(page), "observation")).inputs, 0);
    assert.deepEqual(page.touched, []);
  });

  it("still nudges an automation run, so the double above would have caught it", async () => {
    const page = automatablePage(false);
    await assert.rejects(
      waitForPlayable(asPage(page), "automation"),
      /automatic login did not reach a playable character/,
    );
    assert.equal(page.presses, 4);

    const playable = automatablePage(true);
    assert.equal(
      (await waitForPlayable(asPage(playable), "automation")).inputs,
      0,
    );
    assert.equal(playable.presses, 0);
  });

  it("waits out a game load without sending input to the changing surface", async () => {
    let waits = 0;
    const page = {
      presses: 0,
      waitForFunction: async () => undefined,
      waitForTimeout: async () => {
        waits += 1;
      },
      evaluate: async (body: unknown, argument?: unknown) => {
        const source = String(body);
        if (source.includes("performance.now") && argument === undefined) return 0;
        if (source.includes("getElementById")) {
          const playable = waits >= 3;
          return {
            atMs: waits,
            reason: "initial",
            input: page.presses,
            progress: "ready",
            stage: playable ? "game.outpost" : "game.loading",
            enhancementStatus: playable ? "ready" : "waiting",
            tickCount: playable ? 6 : waits,
            canvasReady: true,
            loadingVisible: false,
          };
        }
        return true;
      },
      keyboard: { press: async () => { page.presses += 1; } },
      mouse: {},
      locator: () => ({ focus: async () => undefined }),
    };
    const result = await waitForPlayable(asPage(page), "automation");
    assert.equal(result.inputs, 0);
    assert.equal(page.presses, 0);
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
