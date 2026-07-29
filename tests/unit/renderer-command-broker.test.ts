import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RendererCommandBroker,
  type RendererCommandContents,
  type RendererCommandWindow,
} from "../../src/main/core/renderer-command-broker.js";

type Listener = (...arguments_: never[]) => void;

class FakeContents implements RendererCommandContents {
  readonly id: number;
  readonly listeners = new Map<string, Set<Listener>>();
  sent: { channel: string; id: number } | null = null;
  destroyed = false;
  crashed = false;
  throwOnSend = false;

  constructor(id: number) {
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isCrashed(): boolean {
    return this.crashed;
  }

  send(channel: string, id: number): void {
    if (this.throwOnSend) throw new Error("fixture send failure");
    this.sent = { channel, id };
  }

  once(event: string, listener: Listener): void {
    const once = (...arguments_: never[]): void => {
      this.off(event, once);
      listener(...arguments_);
    };
    this.onEvent(event, once);
  }

  on(event: "did-start-navigation", listener: Listener): void {
    this.onEvent(event, listener);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...arguments_: never[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...arguments_);
    }
  }

  private onEvent(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
}

function fixture() {
  let deadline: (() => void) | undefined;
  let cleared: unknown;
  const broker = new RendererCommandBroker("renderer-command", 5_000, {
    set: (callback, delayMs) => {
      assert.equal(delayMs, 5_000);
      deadline = callback;
      return "timer";
    },
    clear: (handle) => {
      cleared = handle;
    },
  });
  const contents = new FakeContents(42);
  const window: RendererCommandWindow = {
    isDestroyed: () => false,
    webContents: contents,
  };
  return {
    broker,
    contents,
    window,
    releaseDeadline: () => {
      assert.ok(deadline);
      deadline();
    },
    cleared: () => cleared,
  };
}

describe("renderer command settlement", () => {
  it("fails immediately when no renderer can answer", async () => {
    const value = fixture();
    assert.equal(
      await value.broker.send(null, { type: "input.reset" }),
      "failed",
    );
    value.contents.crashed = true;
    assert.equal(
      await value.broker.send(value.window, { type: "input.reset" }),
      "failed",
    );
  });

  it("settles an outstanding command when its renderer goes away", async () => {
    const value = fixture();
    const pending = value.broker.send(value.window, { type: "input.reset" });
    value.contents.emit("render-process-gone");
    assert.equal(await pending, "failed");
    assert.equal(value.cleared(), "timer");
    assert.equal(value.contents.listeners.get("render-process-gone")?.size, 0);
  });

  it("times out under a controlled clock", async () => {
    const value = fixture();
    const pending = value.broker.send(value.window, { type: "input.reset" });
    value.releaseDeadline();
    assert.equal(await pending, "timed-out");
  });

  it("accepts completion only from the exact renderer and command", async () => {
    const value = fixture();
    const pending = value.broker.send(value.window, { type: "input.reset" });
    assert.ok(value.contents.sent);
    value.broker.complete(7, value.contents.sent.id, "completed");
    value.broker.complete(42, value.contents.sent.id + 1, "completed");
    value.broker.complete(42, value.contents.sent.id, "unknown");
    value.broker.complete(42, value.contents.sent.id, "completed");
    assert.equal(await pending, "completed");
  });

  it("abandons only a new main-frame navigation and catches send failure", async () => {
    const value = fixture();
    const pending = value.broker.send(value.window, { type: "input.reset" });
    value.contents.emit(
      "did-start-navigation",
      { isMainFrame: false, isSameDocument: false } as never,
    );
    value.contents.emit(
      "did-start-navigation",
      { isMainFrame: true, isSameDocument: true } as never,
    );
    value.contents.emit(
      "did-start-navigation",
      { isMainFrame: true, isSameDocument: false } as never,
    );
    assert.equal(await pending, "failed");

    const failedSend = fixture();
    failedSend.contents.throwOnSend = true;
    assert.equal(
      await failedSend.broker.send(failedSend.window, {
        type: "input.reset",
      }),
      "failed",
    );
  });
});
