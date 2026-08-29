/** The window registry is the only authority from IPC senders to profiles. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WindowRegistry } from "../../src/main/window-registry.js";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";
import { AppError } from "../../src/shared/errors.js";

function fake(id: number, processId?: number) {
  let destroyed = false;
  return {
    webContents: {
      id,
      ...(processId === undefined
        ? {}
        : { getOSProcessId: () => processId }),
    },
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
    registry.register(win, { role: "game", profileId }, 7);
    assert.deepEqual(registry.contextForWebContents(7), {
      role: "game",
      profileId,
    });
    assert.equal(registry.requireDiagnosticOwnerForWindow(win), 7);
    assert.equal(registry.contextForWebContents(8), null);
  });

  it("retains one process-local account owner across renderer replacement", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const profileId = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    const first = fake(7);
    registry.register(first, { role: "game", profileId }, 42);
    assert.equal(registry.diagnosticOwnerForWebContents(7), 42);
    registry.unregister(first);
    const replacement = fake(8);
    registry.register(
      replacement,
      { role: "game", profileId },
      42,
    );
    assert.equal(registry.diagnosticOwnerForWindow(replacement), 42);
  });

  it("attributes a renderer process only to its exact account owner", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const first = fake(7, 700);
    const second = fake(8, 800);
    registry.register(first, {
      role: "game",
      profileId: parseProfileId("c153668f-ed81-46b9-aa0c-da22a6342446"),
    }, 101);
    registry.register(second, {
      role: "game",
      profileId: parseProfileId("b2521fbf-50a8-424c-823a-bd5be4b58ace"),
    }, 202);
    assert.equal(registry.diagnosticOwnerForProcessId(700), 101);
    assert.equal(registry.diagnosticOwnerForProcessId(800), 202);
    assert.equal(registry.diagnosticOwnerForProcessId(900), null);
  });

  it("refuses to assign a renderer process shared by different owners", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    registry.register(fake(7, 700), {
      role: "game",
      profileId: parseProfileId("c153668f-ed81-46b9-aa0c-da22a6342446"),
    }, 101);
    registry.register(fake(8, 700), {
      role: "game",
      profileId: parseProfileId("b2521fbf-50a8-424c-823a-bd5be4b58ace"),
    }, 202);
    assert.equal(registry.diagnosticOwnerForProcessId(700), null);
  });

  it("enforces one live game window for a profile", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const profileId = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
    const first = fake(1);
    registry.register(first, { role: "game", profileId }, 1);
    assert.throws(
      () => registry.register(
        fake(2),
        { role: "game", profileId },
        2,
      ),
      AppError,
    );
    first.destroy();
    registry.register(fake(2), { role: "game", profileId }, 2);
  });

  it("unregisters only the exact native window", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const win = fake(1);
    registry.register(win, {
      role: "game",
      profileId: parseProfileId("c153668f-ed81-46b9-aa0c-da22a6342446"),
    }, 1);
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
    registry.register(win, {
      role: "game",
      profileId: parseProfileId("c153668f-ed81-46b9-aa0c-da22a6342446"),
    }, 1);
    readable = false;
    assert.doesNotThrow(() => registry.unregister(win));
    assert.equal(registry.contextForWebContents(1), null);
  });

  it("does not return destroyed windows", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const launcher = fake(1);
    const game = fake(2);
    registry.register(launcher, { role: "launcher" });
    assert.throws(
      () => registry.requireDiagnosticOwnerForWindow(launcher),
      AppError,
    );
    registry.register(game, {
      role: "game",
      profileId: parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae"),
    }, 2);
    assert.equal(registry.gameWindows().length, 1);
    game.destroy();
    assert.equal(registry.gameWindows().length, 0);
    assert.equal(registry.windows().length, 1);
  });

  it("owns one launcher and one game window per profile", () => {
    const registry = new WindowRegistry<ReturnType<typeof fake>>();
    const game = fake(1);
    const launcher = fake(2);
    const profileId = parseProfileId("c153668f-ed81-46b9-aa0c-da22a6342446");
    registry.register(game, { role: "game", profileId }, 1);
    registry.register(launcher, { role: "launcher" });
    assert.equal(registry.profileWindow(profileId), game);
    assert.equal(registry.launcherWindow(), launcher);
    assert.throws(
      () => registry.register(fake(3), { role: "game", profileId }, 3),
      AppError,
    );
    assert.throws(
      () => registry.register(fake(4), { role: "launcher" }),
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
    registry.register(win, {
      role: "game",
      profileId: parseProfileId("c153668f-ed81-46b9-aa0c-da22a6342446"),
    }, 7);
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
      role: "game",
      profileId: parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae"),
    }, 1);
    registry.register(fake(2), {
      role: "game",
      profileId: parseProfileId("b2521fbf-50a8-424c-823a-bd5be4b58ace"),
    }, 2);
    assert.equal(registry.focusedOrSoleGameWindow(), null);
  });
});
