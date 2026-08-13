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
    destroy: () => { destroyed = true; },
  };
}

describe("window registry", () => {
  it("resolves immutable context from the native sender id", () => {
    const registry = new WindowRegistry();
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

  it("enforces one live game window for a profile", () => {
    const registry = new WindowRegistry();
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
    const registry = new WindowRegistry();
    const win = fake(1);
    registry.register(win, { mode: "single", role: "game" });
    registry.unregister(fake(1));
    assert.notEqual(registry.contextForWebContents(1), null);
    registry.unregister(win);
    assert.equal(registry.contextForWebContents(1), null);
  });

  it("does not return destroyed windows", () => {
    const registry = new WindowRegistry();
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
});
