// The cursor is required Core. This executes the real launch policy and proves
// that persisted settings cannot disable it while developer programs retain
// their separate, packaged-off posture.
//
// This executes the real module. `enhancement-policy.ts` resolves its automation
// gate once at import time from `app.isPackaged` and `GW_ENHANCEMENT_AUTOMATION`,
// which `node --test` has no Electron to answer, so the loader hook below
// resolves `electron` to a stub reporting a *packaged* app — and the
// environment variable is set to the value that would open the gate. That pair
// is the posture that matters: it is the only one in which the packaged half of
// the gate decides anything, so `ENHANCEMENT_AUTOMATION_ENABLED === false` below is
// a statement about `!app.isPackaged` rather than about an unset variable, and
// every other answer in this file comes from the closed product presets alone.
//
// The gate across *all four* postures is executed by
// `tests/release/packaged-enhancement-surface.test.ts`, which re-evaluates the
// built module in a child process per case. This file cannot: the gate is
// resolved at import, and one process imports it once.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
} from "../../src/shared/contracts.ts";
import {
  ENHANCEMENTS,
  ENHANCEMENT_CAPABILITY_PRESETS,
  enhancementCapabilityProfile,
  enhancementCapabilitiesFor,
  enhancementCapabilitiesForProfile,
  enhancementCapabilitiesRequested,
  enhancementHooksFor,
} from "../../src/shared/enhancement-contracts.ts";

register(
  `data:text/javascript,${encodeURIComponent(
    `export function resolve(specifier, context, next) {
       if (specifier === "electron") {
         return {
           url: "data:text/javascript,export const app = { isPackaged: true };",
           format: "module",
           shortCircuit: true,
         };
       }
       return next(specifier, context);
     }`,
  )}`,
);

// Set before the import, because the gate is read once at module evaluation.
// Without it the assertion below passes with the `!app.isPackaged` half of the
// gate deleted, since the environment half is false either way.
process.env.GW_ENHANCEMENT_AUTOMATION = "1";
process.env.GW_ENHANCEMENT_PROGRAM = "toolbox-foundation";

const {
  DEVELOPER_ENHANCEMENT_PROGRAM,
  ENHANCEMENT_AUTOMATION_ENABLED,
  enhancementSelectionFor,
  requestedEnhancementCapabilities,
} = await import("../../src/main/certification/enhancement-policy.ts");
const { effectiveCapabilities } = await import(
  "../../src/renderer/effective-enhancement-capabilities.ts"
);

test("a packaged build refuses GW_ENHANCEMENT_AUTOMATION=1, so the tools decide alone", () => {
  assert.equal(process.env.GW_ENHANCEMENT_AUTOMATION, "1");
  assert.equal(ENHANCEMENT_AUTOMATION_ENABLED, false);
  assert.equal(DEVELOPER_ENHANCEMENT_PROGRAM, "none");
});

test("the launch selection carries required Core and no setting can disable it", () => {
  assert.deepEqual(enhancementSelectionFor(DEFAULT_SETTINGS), {
    nativeCursor: true,
    tools: false,
  });
  assert.equal(enhancementCapabilitiesRequested(enhancementCapabilitiesFor(
    enhancementSelectionFor(DEFAULT_SETTINGS),
    "none",
  )), true);
  assert.deepEqual(
    Object.keys(enhancementSelectionFor(DEFAULT_SETTINGS)).sort(),
    [...ENHANCEMENTS].sort(),
  );
});

test("one capability plan derives hooks without losing feature identity", () => {
  const cursorOnly = enhancementCapabilitiesFor(
    { nativeCursor: true, tools: false },
    "none",
  );
  // No user selection reaches cursor + target any more; it stays certified
  // developer-side vocabulary with the same hook plan as cursor-only.
  const cursorTarget = enhancementCapabilitiesForProfile("features-03");
  assert.ok(cursorTarget);
  assert.notDeepEqual(cursorOnly, cursorTarget);
  assert.deepEqual(enhancementHooksFor(cursorOnly), {
    tick: true,
    cursor: true,
    ui: false,
  });
  assert.deepEqual(
    enhancementHooksFor(cursorTarget),
    enhancementHooksFor(cursorOnly),
  );

  // Developer programs replace saved settings for one launch. Exercise both
  // opposite profiles so live evidence cannot accidentally depend on either.
  for (const selection of [
    { nativeCursor: false, tools: false },
    { nativeCursor: true, tools: false },
  ]) {
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "cursor-observer"),
      { nativeCursor: true, targetObservation: false, partyObservation: false, teamApply: false, travelAction: false, xunlaiAction: false, chatAliases: false },
    );
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "target-observer"),
      { nativeCursor: false, targetObservation: true, partyObservation: false, teamApply: false, travelAction: false, xunlaiAction: false, chatAliases: false },
    );
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "toolbox-foundation"),
      { nativeCursor: false, targetObservation: false, partyObservation: true, teamApply: false, travelAction: false, xunlaiAction: false, chatAliases: false },
    );
    // The read foundation and the write program differ by exactly this bit,
    // and no saved setting reaches the second: choosing the panel can never
    // carry the ability to send a packet in with it.
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "toolbox-commands"),
      { nativeCursor: false, targetObservation: false, partyObservation: true, teamApply: true, travelAction: true, xunlaiAction: true, chatAliases: true },
    );
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "xunlai-storage"),
      { nativeCursor: false, targetObservation: false, partyObservation: false, teamApply: false, travelAction: true, xunlaiAction: true, chatAliases: true },
    );
  }
});

test("launch intent resolves to the canonical frozen capability profiles", () => {
  const cases = [
    [{ nativeCursor: true, tools: false }, "none", "features-01"],
    [{ nativeCursor: true, tools: true }, "none", "features-7f"],
    [{ nativeCursor: false, tools: false }, "cursor-observer", "features-01"],
    [{ nativeCursor: true, tools: false }, "target-observer", "features-02"],
    [{ nativeCursor: false, tools: false }, "toolbox-foundation", "features-04"],
    [{ nativeCursor: false, tools: false }, "xunlai-storage", "features-70"],
  ] as const;
  for (const [selection, program, profile] of cases) {
    const resolved = enhancementCapabilitiesFor(selection, program);
    assert.deepEqual(resolved, enhancementCapabilitiesForProfile(profile));
    assert.equal(enhancementCapabilityProfile(resolved), profile);
    assert.equal(Object.isFrozen(resolved), true);
  }
  // Cursor + target keeps its identity even though no launch path selects it.
  const cursorTarget = enhancementCapabilitiesForProfile("features-03");
  assert.ok(cursorTarget);
  assert.equal(
    enhancementCapabilityProfile(cursorTarget),
    "features-03",
  );
  assert.equal(
    enhancementCapabilityProfile(enhancementCapabilitiesFor(
      { nativeCursor: false, tools: false },
      "none",
    )),
    null,
  );
});

test("Tools prepares every certified capability independent of child toggles", () => {
  for (const settings of [
    { teamManagement: false, xunlaiStorage: false, targetReadout: false },
    { teamManagement: false, xunlaiStorage: true, targetReadout: false },
    { teamManagement: true, xunlaiStorage: true, targetReadout: true },
  ]) {
    assert.equal(requestedEnhancementCapabilities({
      ...DEFAULT_SETTINGS,
      ...settings,
      gwonmacTools: true,
    }, "none"), ENHANCEMENT_CAPABILITY_PRESETS.all);
  }
});

test("renderer consumes main's effective subset instead of launch intent", () => {
  const available = { status: "available" as const };
  const unavailable = {
    status: "unavailable" as const,
    reason: "preparation-failed" as const,
  };
  assert.deepEqual(effectiveCapabilities({
    appVersion: "test",
    healthToken: null,
    extendedMemory: null,
    compatibility: {
      clientSha256: "a".repeat(64),
      features: {
        gameFileSaving: available,
        nativeCursor: available,
        targetObservation: available,
        partyObservation: available,
        teamApply: unavailable,
        travelAction: unavailable,
        xunlaiAction: unavailable,
        chatAliases: unavailable,
      },
    },
  }), enhancementCapabilitiesForProfile("features-07"));
});
