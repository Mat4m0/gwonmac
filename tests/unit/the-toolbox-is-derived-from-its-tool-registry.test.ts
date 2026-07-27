// P7.4 replaced the single `settings.nativeCursor` read with a tool registry,
// and the thing worth proving is what was deliberately *not* added: there is no
// stored `toolboxEnabled` master switch. "Is the Toolbox active" is derived
// from the tools, so the two cannot disagree — and P7.6's restart is decided by
// the same registry, so a tool the session cannot honour cannot be saved
// quietly.
//
// This executes the real module. `toolbox-policy.ts` resolves its automation
// gate once at import time from `app.isPackaged` and `GW_TOOLBOX_AUTOMATION`,
// which `node --test` has no Electron to answer, so the loader hook below
// resolves `electron` to a stub reporting a *packaged* app — and the
// environment variable is set to the value that would open the gate. That pair
// is the posture that matters: it is the only one in which the packaged half of
// the gate decides anything, so `TOOLBOX_AUTOMATION_ENABLED === false` below is
// a statement about `!app.isPackaged` rather than about an unset variable, and
// every other answer in this file comes from the tool registry alone.
//
// The gate across *all four* postures is executed by
// `tests/release/packaged-toolbox-surface.test.ts`, which re-evaluates the
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
  TOOLBOX_TOOLS,
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
process.env.GW_TOOLBOX_AUTOMATION = "1";

const {
  TOOLBOX_AUTOMATION_ENABLED,
  toolboxEnabledFor,
  toolboxSelectionFor,
  toolboxSelectionChanged,
} = await import("../../src/main/toolbox-policy.ts");

/** The shipped defaults with every registered tool switched off. */
const allToolsOff = (): AppSettings => {
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  for (const tool of TOOLBOX_TOOLS) settings[tool] = false;
  return settings;
};

test("a packaged build refuses GW_TOOLBOX_AUTOMATION=1, so the tools decide alone", () => {
  assert.equal(process.env.GW_TOOLBOX_AUTOMATION, "1");
  assert.equal(TOOLBOX_AUTOMATION_ENABLED, false);
});

test("every tool off means the Toolbox is off, and any tool on turns it on", () => {
  const off = allToolsOff();
  assert.equal(toolboxEnabledFor(off), false);

  // Written as a loop over the registry on purpose: a tool added later is
  // covered by this test the moment it is declared, and a tool that stops
  // reaching the derivation fails it.
  for (const tool of TOOLBOX_TOOLS) {
    assert.equal(toolboxEnabledFor({ ...off, [tool]: true }), true, tool);
  }
});

test("no non-tool setting can switch the Toolbox on", () => {
  // The derivation reads the registry and the registry only. Every other
  // boolean in AppSettings is somebody else's answer.
  const off = allToolsOff();
  const tools = new Set<string>(TOOLBOX_TOOLS);
  for (const [key, value] of Object.entries(off)) {
    if (typeof value !== "boolean" || tools.has(key)) continue;
    assert.equal(toolboxEnabledFor({ ...off, [key]: true }), false, key);
  }
  // Including a key that looks like the master switch this design refuses.
  assert.equal(
    toolboxEnabledFor({ ...off, toolboxEnabled: true } as AppSettings),
    false,
  );
});

test("the shipped defaults run the Toolbox with only the cursor selected", () => {
  assert.equal(toolboxEnabledFor(DEFAULT_SETTINGS), true);
  assert.equal(DEFAULT_SETTINGS.nativeCursor, true);
  // Every tool but the cursor defaults off, so a build that adds one does not
  // silently start doing more on a fresh profile.
  for (const tool of TOOLBOX_TOOLS) {
    if (tool === "nativeCursor") continue;
    assert.equal(DEFAULT_SETTINGS[tool], false, tool);
  }
  assert.equal(
    toolboxEnabledFor({ ...DEFAULT_SETTINGS, nativeCursor: false }),
    false,
  );
});

test("the launch selection carries every tool and no unrelated setting", () => {
  assert.deepEqual(toolboxSelectionFor(DEFAULT_SETTINGS), {
    nativeCursor: true,
    targetReadout: false,
  });
  assert.deepEqual(
    Object.keys(toolboxSelectionFor(DEFAULT_SETTINGS)).sort(),
    [...TOOLBOX_TOOLS].sort(),
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
      toolboxSelectionChanged(on, patch),
      expected,
      JSON.stringify(patch),
    );
  }

  // Symmetric: turning a tool back on is just as unreachable for this session.
  for (const tool of TOOLBOX_TOOLS) {
    const off = allToolsOff();
    assert.equal(toolboxSelectionChanged(off, { [tool]: true }), true, tool);
    assert.equal(toolboxSelectionChanged(off, { [tool]: false }), false, tool);
  }
});
