import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type {
  BrowserWindow,
  WebContents,
} from "electron";
import { WindowRegistry } from "../../src/main/window-registry.js";

class FakeContents extends EventEmitter {
  readonly id: number;
  private destroyed = false;

  constructor(id: number) {
    super();
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeWindow extends EventEmitter {
  readonly webContents: FakeContents;
  private destroyed = false;

  constructor(webContents: FakeContents) {
    super();
    this.webContents = webContents;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  close(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

function contents(id: number): FakeContents & WebContents {
  return new FakeContents(id) as FakeContents & WebContents;
}

function windowFor(id: number): FakeWindow & BrowserWindow {
  return new FakeWindow(contents(id)) as FakeWindow & BrowserWindow;
}

test("the registry owns exact WebContents objects, not reusable numeric IDs", () => {
  const registry = new WindowRegistry();
  const first = windowFor(7);
  const registered = registry.registerGame(first);
  const impostor = contents(7);

  assert.equal(registry.contextFor(first.webContents), registered);
  assert.equal(registry.contextFor(impostor), null);
  assert.equal(registry.unregister(
    new FakeWindow(impostor) as FakeWindow & BrowserWindow,
  ), false);
  assert.equal(registry.contextFor(first.webContents), registered);
});

test("single-window mode enforces exact game and control role limits", () => {
  const registry = new WindowRegistry(1);
  const game = windowFor(1);
  const control = windowFor(2);
  assert.equal(registry.registerGame(game).slot, 1);
  assert.equal(registry.registerControl(control).kind, "control");
  assert.throws(() => registry.registerGame(windowFor(3)), /limit reached/u);
  assert.throws(
    () => registry.registerControl(windowFor(4)),
    /already registered/u,
  );
  assert.throws(() => registry.registerGame(game), /limit reached/u);
});

test("two-window mode allocates ephemeral slots and removes destroyed owners", () => {
  const registry = new WindowRegistry(2);
  const first = windowFor(1);
  const second = windowFor(2);
  assert.equal(registry.registerGame(first).slot, 1);
  assert.equal(registry.registerGame(second).slot, 2);
  assert.deepEqual(
    registry.gameWindows().map((context) => context.slot),
    [1, 2],
  );

  first.webContents.destroy();
  assert.equal(registry.contextFor(first.webContents), null);
  assert.deepEqual(
    registry.gameWindows().map((context) => context.slot),
    [2],
  );
});

test("reload releases resources while crash and destruction remove ownership", () => {
  const releases: Array<[number, string]> = [];
  const registry = new WindowRegistry(1, (id, reason) => {
    releases.push([id, reason]);
  });
  const reloaded = windowFor(11);
  registry.registerGame(reloaded);
  reloaded.webContents.emit("did-start-navigation", {
    isMainFrame: true,
    isSameDocument: true,
  });
  reloaded.webContents.emit("did-start-navigation", {
    isMainFrame: true,
    isSameDocument: false,
  });
  assert.notEqual(registry.contextFor(reloaded.webContents), null);
  assert.deepEqual(releases, [[11, "reload"]]);

  reloaded.webContents.emit("render-process-gone");
  assert.equal(registry.contextFor(reloaded.webContents), null);
  assert.deepEqual(releases, [
    [11, "reload"],
    [11, "crash"],
  ]);

  const destroyed = windowFor(12);
  registry.registerGame(destroyed);
  destroyed.webContents.destroy();
  assert.equal(registry.contextFor(destroyed.webContents), null);
  assert.deepEqual(releases.at(-1), [12, "destroyed"]);
});

test("closed windows, wrong roles, and cleared registries fail closed", () => {
  const registry = new WindowRegistry();
  const game = windowFor(21);
  const control = windowFor(22);
  registry.registerGame(game);
  registry.registerControl(control);
  assert.equal(registry.contextForWindow(game)?.kind, "game");
  assert.equal(registry.contextForWindow(control)?.kind, "control");

  control.close();
  assert.equal(registry.contextForWindow(control), null);
  registry.clear();
  assert.equal(registry.gameWindow(), null);
  assert.equal(registry.contextForWindow(game), null);
});
