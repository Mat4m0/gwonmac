// P7.4 replaced the single `settings.nativeCursor` read with a tool registry,
// and the thing worth proving is what was deliberately *not* added: there is no
// stored `enhancementsEnabled` master switch. "Is the Enhancement active" is derived
// from the tools, so the two cannot disagree — and P7.6's restart is decided by
// the same registry, so a tool the session cannot honour cannot be saved
// quietly.
//
// This executes the real module. `enhancement-policy.ts` resolves its automation
// gate once at import time from `app.isPackaged` and `GW_ENHANCEMENT_AUTOMATION`,
// which `node --test` has no Electron to answer, so the loader hook below
// resolves `electron` to a stub reporting a *packaged* app — and the
// environment variable is set to the value that would open the gate. That pair
// is the posture that matters: it is the only one in which the packaged half of
// the gate decides anything, so `ENHANCEMENT_AUTOMATION_ENABLED === false` below is
// a statement about `!app.isPackaged` rather than about an unset variable, and
// every other answer in this file comes from the tool registry alone.
//
// The gate across *all four* postures is executed by
// `tests/release/packaged-enhancement-surface.test.ts`, which re-evaluates the
// built module in a child process per case. This file cannot: the gate is
// resolved at import, and one process imports it once.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type {
  AppSettings,
  AppSettingsPatch,
} from "../../src/shared/contracts.ts";
import {
  DEFAULT_SETTINGS,
  ENHANCEMENTS,
  ENHANCEMENT_CAPABILITY_PROFILES,
  enhancementCapabilityProfile,
  enhancementCapabilitiesFor,
  enhancementCapabilitiesRequested,
  enhancementHooksFor,
} from "../../src/shared/contracts.ts";

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
  enhancementSelectionChanged,
} = await import("../../src/main/enhancement-policy.ts");

const enabledFor = (settings: AppSettings) => enhancementCapabilitiesRequested(
  enhancementCapabilitiesFor(
    enhancementSelectionFor(settings),
    DEVELOPER_ENHANCEMENT_PROGRAM,
  ),
);

/** The shipped defaults with every registered tool switched off. */
const allToolsOff = (): AppSettings => {
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  for (const tool of ENHANCEMENTS) settings[tool] = false;
  return settings;
};

test("a packaged build refuses GW_ENHANCEMENT_AUTOMATION=1, so the tools decide alone", () => {
  assert.equal(process.env.GW_ENHANCEMENT_AUTOMATION, "1");
  assert.equal(ENHANCEMENT_AUTOMATION_ENABLED, false);
  assert.equal(DEVELOPER_ENHANCEMENT_PROGRAM, "none");
});

test("every tool off means the Enhancement is off, and any tool on turns it on", () => {
  const off = allToolsOff();
  assert.equal(enabledFor(off), false);

  // Written as a loop over the registry on purpose: a tool added later is
  // covered by this test the moment it is declared, and a tool that stops
  // reaching the derivation fails it.
  for (const tool of ENHANCEMENTS) {
    assert.equal(enabledFor({ ...off, [tool]: true }), true, tool);
  }
});

test("no non-tool setting can switch the Enhancement on", () => {
  // The derivation reads the registry and the registry only. Every other
  // boolean in AppSettings is somebody else's answer.
  const off = allToolsOff();
  const tools = new Set<string>(ENHANCEMENTS);
  for (const [key, value] of Object.entries(off)) {
    if (typeof value !== "boolean" || tools.has(key)) continue;
    assert.equal(enabledFor({ ...off, [key]: true }), false, key);
  }
  // Including a key that looks like the master switch this design refuses.
  assert.equal(
    enabledFor({ ...off, enhancementsEnabled: true } as AppSettings),
    false,
  );
});

test("the shipped defaults run the Enhancement with only the cursor selected", () => {
  assert.equal(enabledFor(DEFAULT_SETTINGS), true);
  assert.equal(DEFAULT_SETTINGS.nativeCursor, true);
  // Every tool but the cursor defaults off, so a build that adds one does not
  // silently start doing more on a fresh profile.
  for (const tool of ENHANCEMENTS) {
    if (tool === "nativeCursor") continue;
    assert.equal(DEFAULT_SETTINGS[tool], false, tool);
  }
  assert.equal(
    enabledFor({ ...DEFAULT_SETTINGS, nativeCursor: false }),
    false,
  );
});

test("the launch selection carries every tool and no unrelated setting", () => {
  assert.deepEqual(enhancementSelectionFor(DEFAULT_SETTINGS), {
    nativeCursor: true,
    targetReadout: false,
  });
  assert.deepEqual(
    Object.keys(enhancementSelectionFor(DEFAULT_SETTINGS)).sort(),
    [...ENHANCEMENTS].sort(),
  );
});

test("one capability plan derives hooks without losing feature identity", () => {
  const cursorOnly = enhancementCapabilitiesFor(
    { nativeCursor: true, targetReadout: false },
    "none",
  );
  const cursorTarget = enhancementCapabilitiesFor(
    { nativeCursor: true, targetReadout: true },
    "none",
  );
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
    { nativeCursor: false, targetReadout: false },
    { nativeCursor: true, targetReadout: true },
  ]) {
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "cursor-observer"),
      { nativeCursor: true, targetObservation: false, toolbox: false },
    );
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "target-observer"),
      { nativeCursor: false, targetObservation: true, toolbox: false },
    );
    assert.deepEqual(
      enhancementCapabilitiesFor(selection, "toolbox-foundation"),
      { nativeCursor: true, targetObservation: false, toolbox: true },
    );
  }
});

test("launch intent resolves to the canonical frozen capability profiles", () => {
  const cases = [
    [{ nativeCursor: true, targetReadout: false }, "none", "cursor"],
    [{ nativeCursor: false, targetReadout: true }, "none", "target"],
    [{ nativeCursor: true, targetReadout: true }, "none", "cursorTarget"],
    [{ nativeCursor: false, targetReadout: false }, "cursor-observer", "cursor"],
    [{ nativeCursor: true, targetReadout: true }, "target-observer", "target"],
    [
      { nativeCursor: false, targetReadout: false },
      "toolbox-foundation",
      "cursorToolbox",
    ],
  ] as const;
  for (const [selection, program, profile] of cases) {
    const resolved = enhancementCapabilitiesFor(selection, program);
    assert.equal(resolved, ENHANCEMENT_CAPABILITY_PROFILES[profile]);
    assert.equal(enhancementCapabilityProfile(resolved), profile);
    assert.equal(Object.isFrozen(resolved), true);
  }
  assert.equal(
    enhancementCapabilityProfile(enhancementCapabilitiesFor(
      { nativeCursor: false, targetReadout: false },
      "none",
    )),
    null,
  );
});

test("only a write that changes a tool asks the session to restart", () => {
  const on = DEFAULT_SETTINGS;
  const patches: [AppSettingsPatch, boolean][] = [
    [{}, false],
    // A write that repeats what is already saved is not a change: re-opening
    // Settings and re-saving must not offer to close the player's game.
    [{ nativeCursor: true }, false],
    [{ renderScale: 1 }, false],
    [{ dataStrategy: "full", autoCheckUpdates: true }, false],
    [{ nativeCursor: false }, true],
    [{ renderScale: 1, nativeCursor: false }, true],
  ];
  for (const [patch, expected] of patches) {
    assert.equal(
      enhancementSelectionChanged(on, patch),
      expected,
      JSON.stringify(patch),
    );
  }

  // Symmetric: turning a tool back on is just as unreachable for this session.
  for (const tool of ENHANCEMENTS) {
    const off = allToolsOff();
    assert.equal(enhancementSelectionChanged(off, { [tool]: true }), true, tool);
    assert.equal(enhancementSelectionChanged(off, { [tool]: false }), false, tool);
  }
});
