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

  it("can activate the app for an explicit Dock or second-instance reveal", () => {
    const { applicationCalls, coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    launcher.setVisible(true);
    registry.register(launcher, { role: "launcher" });

    coordinator.revealLauncher({ activateApp: true });
    assert.deepEqual(applicationCalls, ["dock.show", "app.focus"]);
    assert.deepEqual(launcher.calls, ["focus"]);
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

  it("focuses an asynchronous game only while the launcher remains focused", () => {
    const { coordinator, registry } = setup();
    const launcher = fakeWindow(1);
    const game = fakeWindow(2);
    launcher.setVisible(true);
    registry.register(launcher, { role: "launcher" });
    registry.register(game, { role: "game", profileId: FIRST }, 2);

    assert.equal(coordinator.revealAsyncGameIfLauncherFocused(game), false);
    assert.deepEqual(game.calls, []);

    launcher.setFocused(true);
    assert.equal(coordinator.revealAsyncGameIfLauncherFocused(game), true);
    assert.deepEqual(game.calls, ["show", "focus"]);

    registry.unregister(launcher);
    assert.equal(coordinator.revealAsyncGameIfLauncherFocused(game), false);
  });
});
