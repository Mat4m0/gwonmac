import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUpdateAction,
  formatLastChecked,
  launchGateDecision,
  type UpdateActionView,
} from "../../src/renderer/update-action.ts";
import type { AppUpdateState } from "../../src/shared/contracts.ts";

describe("update action", () => {
  it("formats persisted check times without claiming a future time", () => {
    // No timestamp is said out loud: the one network-free nudge an opted-out
    // player gets that updates exist to be checked for.
    assert.equal(formatLastChecked(undefined, 1000), "Never checked for updates");
    assert.equal(formatLastChecked(null, 1000), "Never checked for updates");
    assert.equal(
      formatLastChecked("not-a-date", 1000),
      "Never checked for updates",
    );
    assert.equal(
      formatLastChecked("1970-01-01T00:00:01.000Z", 1000),
      "Last checked just now",
    );
    assert.equal(
      formatLastChecked("1970-01-01T00:00:02.000Z", 1000),
      "Last checked just now",
    );
    assert.equal(
      formatLastChecked("1970-01-01T00:00:00.000Z", 2 * 60 * 60 * 1000),
      "Last checked 2 hours ago",
    );
  });

  it("gates a launch on exactly the in-flight and ready updater states", () => {
    const current = { currentVersion: "2026.8.0" };
    // In flight: the game must not start outdated when the answer is seconds
    // away, so the launch holds.
    assert.equal(
      launchGateDecision({ phase: "checking", ...current }),
      "hold",
    );
    assert.equal(
      launchGateDecision({
        phase: "downloading",
        latestVersion: "2026.8.1",
        checkedAt: "2026-08-03T10:00:00.000Z",
        ...current,
      }),
      "hold",
    );
    // Ready: the update installs before the outdated version gets a session.
    assert.equal(
      launchGateDecision({
        phase: "ready",
        latestVersion: "2026.8.1",
        checkedAt: "2026-08-03T10:00:00.000Z",
        ...current,
      }),
      "install",
    );
    // Settled states never delay play: idle is checks-off, and a failed
    // check has already said everything it can.
    assert.equal(launchGateDecision({ phase: "idle", ...current }), "proceed");
    assert.equal(
      launchGateDecision({
        phase: "up-to-date",
        latestVersion: "2026.8.0",
        checkedAt: "2026-08-03T10:00:00.000Z",
        ...current,
      }),
      "proceed",
    );
    assert.equal(
      launchGateDecision({
        phase: "manual-stable-return",
        checkedAt: "2026-08-03T10:00:00.000Z",
        stableVersion: "2026.7.0",
        ...current,
      }),
      "proceed",
    );
    assert.equal(
      launchGateDecision({
        phase: "failed",
        reason: "offline",
        ...current,
      }),
      "proceed",
    );
  });

  it("rehydrates and follows the one main-process state", async () => {
    let listener: ((state: AppUpdateState) => void) | null = null;
    const views: UpdateActionView[] = [];
    const action = createUpdateAction({
      getState: async () => ({
        phase: "idle",
        currentVersion: "2026.7.0-beta.1",
        lastCheckedAt: "1970-01-01T00:00:01.000Z",
      }),
      check: async () => undefined,
      restartAndInstall: async () => undefined,
      onState: (next) => {
        listener = next;
        return () => undefined;
      },
      now: () => 1000,
    });
    action.subscribe((view) => views.push(view));
    await action.initialize();
    listener!({
      phase: "ready",
      currentVersion: "2026.7.0-beta.1",
      latestVersion: "2026.7.0-beta.2",
      checkedAt: "1970-01-01T00:00:01.000Z",
    });

    assert.equal(views.at(-1)?.message, "Version 2026.7.0-beta.2 is ready to install.");
    assert.equal(views.at(-1)?.installedStage, "Beta");
    assert.equal(views.at(-1)?.ready, true);
  });

  it("makes a downgrade a truthful manual Stable return", async () => {
    const views: UpdateActionView[] = [];
    const action = createUpdateAction({
      getState: async () => ({
        phase: "manual-stable-return",
        currentVersion: "2026.8.0-beta.1",
        checkedAt: "2026-08-03T10:00:00.000Z",
        stableVersion: "2026.7.0",
      }),
      check: async () => undefined,
      restartAndInstall: async () => undefined,
      onState: () => () => undefined,
    });
    action.subscribe((view) => views.push(view));

    await action.initialize();

    assert.match(views.at(-1)?.message ?? "", /manual install/);
    assert.equal(views.at(-1)?.releasesLabel, "Open Releases to Return to Stable…");
    assert.equal(views.at(-1)?.showReleaseNotes, true);
    assert.equal(views.at(-1)?.ready, false);
  });

  it("renders closed failure reasons and never says up to date", async () => {
    const views: UpdateActionView[] = [];
    const action = createUpdateAction({
      getState: async () => ({
        phase: "failed",
        currentVersion: "2026.7.0",
        reason: "feed-invalid",
      }),
      check: async () => undefined,
      restartAndInstall: async () => undefined,
      onState: () => () => undefined,
    });
    action.subscribe((view) => views.push(view));
    await action.initialize();

    assert.match(views.at(-1)?.message ?? "", /did not pass validation/);
    assert.doesNotMatch(views.at(-1)?.message ?? "", /latest version/);
  });
});
