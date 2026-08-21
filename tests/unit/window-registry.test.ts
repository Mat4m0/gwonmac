/** The window registry is the only authority from IPC senders to profiles. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WindowRegistry } from "../../src/main/window-registry.js";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";
import { AppError } from "../../src/shared/errors.js";

function fake(id: number) {
  let destroyed = false;
  return {
    webContents: { id },
    isDestroyed: () => destroyed,
    isFocused: () => false,
    destroy: () => { destroyed = true; },
  };
}

describe("window registry", () => {
  it("resolves immutable context from the native sender id", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const win = fake(7);
    const profileId = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    registry.register(win, { mode: "multi", role: "game", profileId });
    assert.deepEqual(registry.contextForWebContents(7), {
      mode: "multi",
      role: "game",
      profileId,
    });
    assert.equal(registry.contextForWebContents(8), null);
  });

  it("retains one process-local account owner across renderer replacement", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const profileId = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    const first = fake(7);
    registry.register(first, { mode: "multi", role: "game", profileId }, 42);
    assert.equal(registry.diagnosticOwnerForWebContents(7), 42);
    registry.unregister(first);
    const replacement = fake(8);
    registry.register(
      replacement,
      { mode: "multi", role: "game", profileId },
      42,
    );
    assert.equal(registry.diagnosticOwnerForWindow(replacement), 42);
  });

  it("enforces one live game window for a profile", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const profileId = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    const first = fake(1);
    registry.register(first, { mode: "multi", role: "game", profileId });
    assert.throws(
      () => registry.register(fake(2), { mode: "multi", role: "game", profileId }),
      AppError,
    );
    first.destroy();
    registry.register(fake(2), { mode: "multi", role: "game", profileId });
  });

  it("unregisters only the exact native window", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const win = fake(1);
    registry.register(win, { mode: "single", role: "game" });
    registry.unregister(fake(1));
    assert.notEqual(registry.contextForWebContents(1), null);
    registry.unregister(win);
    assert.equal(registry.contextForWebContents(1), null);
  });

  it("unregisters after Electron has made webContents unreadable", () => {
    let readable = true;
    const win = {
      get webContents() {
        if (!readable) throw new Error("destroyed webContents was read");
        return { id: 1 };
      },
      isDestroyed: () => !readable,
      isFocused: () => false,
    };
    const registry = new WindowRegistry<typeof win>();
    registry.register(win, { mode: "single", role: "game" });
    readable = false;
    assert.doesNotThrow(() => registry.unregister(win));
    assert.equal(registry.contextForWebContents(1), null);
  });

  it("does not return destroyed windows", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const hub = fake(1);
    const game = fake(2);
    registry.register(hub, { mode: "multi", role: "hub" });
    registry.register(game, {
      mode: "multi",
      role: "game",
      profileId: parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae"),
    });
    assert.equal(registry.gameWindows().length, 1);
    game.destroy();
    assert.equal(registry.gameWindows().length, 0);
    assert.equal(registry.windows().length, 1);
  });

  it("owns the one Single game window and the one Multiple Accounts Hub", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const single = fake(1);
    const hub = fake(2);
    registry.register(single, { mode: "single", role: "game" });
    registry.register(hub, { mode: "multi", role: "hub" });
    assert.equal(registry.singleGameWindow(), single);
    assert.equal(registry.hubWindow(), hub);
    assert.throws(
      () => registry.register(fake(3), { mode: "single", role: "game" }),
      AppError,
    );
    assert.throws(
      () => registry.register(fake(4), { mode: "multi", role: "hub" }),
      AppError,
    );
  });

  it("resolves only registered senders and the focused game", () => {
    let focused = false;
    const win = {
      webContents: { id: 7 },
      isDestroyed: () => false,
      isFocused: () => focused,
    };
    const registry = new WindowRegistry<typeof win>();
    registry.register(win, { mode: "single", role: "game" });
    assert.equal(registry.windowForWebContents(7), win);
    assert.equal(registry.windowForWebContents(8), null);
    assert.equal(registry.focusedWindow(), null);
    assert.equal(registry.focusedGameWindow(), null);
    assert.equal(registry.focusedOrSoleGameWindow(), win);
    focused = true;
    assert.equal(registry.focusedWindow(), win);
    assert.equal(registry.focusedGameWindow(), win);
  });

  it("refuses an ambiguous game selection", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    registry.register(fake(1), {
      mode: "multi",
      role: "game",
      profileId: parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae"),
    });
    registry.register(fake(2), {
      mode: "multi",
      role: "game",
      profileId: parseProfileId("b2521fbf-50a8-424c-823a-bd5be4b58ace"),
    });
    assert.equal(registry.focusedOrSoleGameWindow(), null);
  });
});
