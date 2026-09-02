/** The companion coordinator owns presentation without duplicating registry state. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WindowCoordinator } from "../../src/main/window-coordinator.js";
import { WindowRegistry } from "../../src/main/window-registry.js";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";

const FIRST = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
const SECOND = parseProfileId("b2521fbf-50a8-424c-823a-bd5be4b58ace");

function fakeWindow(id: number) {
  let destroyed = false;
  let focused = false;
  let minimized = false;
  let visible = false;
  const calls: string[] = [];
  return {
    webContents: { id },
    isDestroyed: () => destroyed,
    isFocused: () => focused,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore() {
      calls.push("restore");
      minimized = false;
    },
    show() {
      calls.push("show");
      visible = true;
    },
    hide() {
      calls.push("hide");
      visible = false;
      focused = false;
    },
    focus() {
      calls.push("focus");
      focused = true;
    },
    blur() {
      calls.push("blur");
      focused = false;
    },
    setDestroyed(value: boolean) { destroyed = value; },
    setFocused(value: boolean) { focused = value; },
    setMinimized(value: boolean) { minimized = value; },
    setVisible(value: boolean) { visible = value; },
    calls,
  };
}

function setup() {
  const registry = new WindowRegistry<ReturnType<typeof fakeWindow>>();
  const applicationCalls: string[] = [];
  const application = {
    dock: { show: () => applicationCalls.push("dock.show") },
    focus: (options: { steal: true }) => {
      assert.deepEqual(options, { steal: true });
      applicationCalls.push("app.focus");
    },
  };
  return {
    applicationCalls,
    registry,
    coordinator: new WindowCoordinator(application, registry),
  };
}

describe("window coordinator", () => {
  it("restores and reveals the launcher without activating the app by default", () => {
    const { applicationCalls, coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    launcher.setMinimized(true);
    registry.register(launcher, { role: "launcher" });

    assert.equal(coordinator.revealLauncher(), true);
    assert.deepEqual(applicationCalls, ["dock.show"]);
    assert.deepEqual(launcher.calls, ["restore", "show", "focus"]);
  });

  it("can activate the app for an explicit second-instance reveal", () => {
    const { applicationCalls, coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    launcher.setVisible(true);
    registry.register(launcher, { role: "launcher" });

    coordinator.revealLauncher({ activateApp: true });
    assert.deepEqual(applicationCalls, ["dock.show", "app.focus"]);
    assert.deepEqual(launcher.calls, ["focus"]);
  });

  it("restores the most recently focused live window from the Dock", () => {
    const { applicationCalls, coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    game.setVisible(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    coordinator.recordFocused(launcher);
    coordinator.recordFocused(game);
    assert.equal(coordinator.restoreMostRecentWindow(), true);
    assert.deepEqual(applicationCalls, ["dock.show"]);
    assert.deepEqual(game.calls, ["focus"]);
    assert.deepEqual(launcher.calls, []);
  });

  it("keeps a deliberately hidden launcher behind a running game", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    game.setVisible(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    coordinator.recordFocused(game);
    coordinator.recordFocused(launcher);
    launcher.hide();
    assert.equal(coordinator.restoreMostRecentWindow(), true);
    assert.deepEqual(launcher.calls, ["hide"]);
    assert.deepEqual(game.calls, ["focus"]);
  });

  it("falls back through the complete focus order when a newer game closes", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const first = fakeWindow(2);
    const second = fakeWindow(3);
    launcher.setVisible(true);
    first.setVisible(true);
    second.setVisible(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(first, { role: "game", profileId: FIRST }, 2);
    registry.register(second, { role: "game", profileId: SECOND }, 3);

    coordinator.recordFocused(launcher);
    coordinator.recordFocused(first);
    coordinator.recordFocused(second);
    second.setDestroyed(true);
    registry.unregister(second);
    assert.equal(coordinator.restoreMostRecentWindow(), true);
    assert.deepEqual(first.calls, ["focus"]);
    assert.deepEqual(launcher.calls, []);

    first.setDestroyed(true);
    registry.unregister(first);
    assert.equal(coordinator.restoreMostRecentWindow(), true);
    assert.deepEqual(launcher.calls, ["focus"]);
  });

  it("restores the window captured on deactivation despite incidental focus", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    game.setVisible(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    coordinator.recordFocused(launcher);
    coordinator.recordFocused(game);
    game.setFocused(true);
    coordinator.captureActivationTarget();

    game.setFocused(false);
    coordinator.recordFocused(launcher);
    assert.equal(coordinator.restoreMostRecentWindow(), true);
    assert.deepEqual(game.calls, ["focus"]);
    assert.deepEqual(launcher.calls, []);
  });

  it("restores and focuses an exact live game", () => {
    const { applicationCalls, coordinator, registry } = setup();
    const game = fakeWindow(2);
    game.setMinimized(true);
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    assert.equal(coordinator.revealGame(game, { activateApp: true }), true);
    assert.deepEqual(applicationCalls, ["dock.show", "app.focus"]);
    assert.deepEqual(game.calls, ["restore", "show", "focus"]);
    game.setDestroyed(true);
    assert.equal(coordinator.revealGame(game), false);
  });

  it("hides the launcher after its launch task completes", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    launcher.setVisible(true);
    registry.register(launcher, { role: "launcher" });

    assert.equal(coordinator.hideLauncher(), true);
    assert.deepEqual(launcher.calls, ["hide"]);
    assert.equal(coordinator.hideLauncher(), false);
    assert.deepEqual(launcher.calls, ["hide"]);
  });

  it("hides a closed launcher only while games remain", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);
    let prevented = 0;

    assert.equal(coordinator.handleLauncherClose({
      preventDefault: () => { prevented += 1; },
    }), true);
    assert.equal(prevented, 1);
    assert.deepEqual(launcher.calls, ["hide"]);

    registry.unregister(game);
    assert.equal(coordinator.handleLauncherClose({
      preventDefault: () => { prevented += 1; },
    }), false);
    assert.equal(prevented, 1);
  });

  it("reveals the launcher only after the final game closes", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const first = fakeWindow(2);
    const second = fakeWindow(3);
    registry.register(launcher, { role: "launcher" });
    registry.register(first, { role: "game", profileId: FIRST }, 2);
    registry.register(second, { role: "game", profileId: SECOND }, 3);

    registry.unregister(first);
    assert.equal(coordinator.afterGameClosed(), false);
    assert.deepEqual(launcher.calls, []);

    registry.unregister(second);
    assert.equal(coordinator.afterGameClosed(), true);
    assert.deepEqual(launcher.calls, ["show", "focus"]);
  });

  it("completes an asynchronous launch without stealing focus", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    game.setVisible(true);
    game.setFocused(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    assert.equal(coordinator.completeAsyncGameLaunch(game), false);
    assert.deepEqual(launcher.calls, ["hide"]);
    assert.deepEqual(game.calls, ["blur"]);
  });

  it("focuses an asynchronous game when the launcher remains focused", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    launcher.setFocused(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    assert.equal(coordinator.completeAsyncGameLaunch(game), true);
    assert.deepEqual(launcher.calls, ["hide"]);
    assert.deepEqual(game.calls, ["show", "focus"]);
  });
});
