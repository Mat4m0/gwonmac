import assert from "node:assert/strict";
import test from "node:test";
import { createSkillCooldownOverlayConsumer } from "../../src/renderer/skill-cooldown-overlay-consumer.js";
import { createSkillCooldownOverlay } from "../../src/renderer/skill-cooldown-overlay.js";

class FakeStyle {
  cssText = "";
  display = "";
  values = new Map<string, string>();
  setProperty(name: string, value: string) { this.values.set(name, value); }
}
class FakeElement {
  id = "";
  className = "";
  hidden = false;
  textContent = "";
  style = new FakeStyle();
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attributes = new Map<string, string>();
  ownerDocument: FakeDocument;
  classList = { add: (...names: string[]) => { this.className += ` ${names.join(" ")}`; } };
  constructor(ownerDocument: FakeDocument) { this.ownerDocument = ownerDocument; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(...children: FakeElement[]) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}
class FakeDocument {
  head = new FakeElement(this);
  defaultView = new FakeWindow();
  createElement() { return new FakeElement(this); }
  getElementById(id: string) { return this.head.children.find((child) => child.id === id) ?? null; }
}
class FakeWindow {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const textOf = (element: FakeElement): string =>
  element.textContent + element.children.map(textOf).join("");

const geometry = (sequence = 2) => ({
  status: "ready" as const,
  sequence,
  frameId: 4,
  chatFrameId: 0,
  chatInput: null,
  viewportWidth: 800,
  viewportHeight: 600,
  slots: Array.from({ length: 8 }, (_, index) => ({
    left: 100 + index * 50,
    bottom: 20,
    right: 148 + index * 50,
    top: 68,
  })),
});

test("the presentation joins complete geometry and cooldown state without touching keys", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }),
  } as HTMLCanvasElement;
  const consumer = createSkillCooldownOverlayConsumer(body as unknown as HTMLElement, canvas);
  consumer.sync({ kind: "preset", preset: "red" }, true);
  consumer.update(geometry());
  consumer.setCooldownState({
    status: "ready",
    sequence: 2,
    generation: 1,
    gameTimer: 10_000,
    playerAgentId: 7,
    rechargeTimestamps: [12_899, 24_001, 0, 0, 0, 0, 0, 10_400],
  });
  const root = body.children[0]!;
  assert.equal(root.id, "skill-cooldown-overlay");
  assert.equal(root.style.display, "block");
  assert.equal(root.attributes.get("aria-hidden"), "true");
  assert.match(root.style.cssText, /pointer-events:none/u);
  assert.deepEqual(root.children.map(textOf), ["2.9", "15", "", "", "", "", "", "0.4"]);
  assert.match(root.children[0]!.style.cssText, /left:110px;top:552px;width:48px;height:48px/u);
  assert.equal(root.children[0]!.children[0]!.style.values.get("--skill-cooldown-slot-height"), "48px");
});

test("ready skills, stale state, disabled Tools, and incomplete publications hide everything", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  const consumer = createSkillCooldownOverlayConsumer(
    body as unknown as HTMLElement,
    { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
  );
  consumer.sync({ kind: "custom", value: "#abcdef" }, true);
  consumer.update(geometry());
  consumer.setCooldownState({
    status: "ready",
    sequence: 2,
    generation: 1,
    gameTimer: 10_000,
    playerAgentId: 7,
    rechargeTimestamps: [0, 0, 0, 0, 0, 0, 0, 0],
  });
  const root = body.children[0]!;
  assert.equal(root.style.display, "none");
  consumer.setCooldownState({ status: "waiting", reason: "loading" });
  assert.equal(root.style.display, "none");
  consumer.sync({ kind: "custom", value: "#abcdef" }, false);
  consumer.setCooldownState({
    status: "ready",
    sequence: 4,
    generation: 1,
    gameTimer: 10_000,
    playerAgentId: 7,
    rechargeTimestamps: [11_000, 0, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(root.style.display, "none");
});

test("sub-frame timer changes that keep the same label cause no presentation update", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  const overlay = createSkillCooldownOverlay(body as unknown as HTMLElement);
  const slots = Array.from({ length: 8 }, (_, index) => ({
    x: index * 50,
    y: 0,
    width: 48,
    height: 48,
    remainingMs: index === 0 ? 2_899 : 0,
  }));
  overlay.update(slots, { kind: "preset", preset: "red" });
  const signature = overlay.state.signature;
  overlay.update(
    slots.map((slot, index) => ({ ...slot, remainingMs: index === 0 ? 2_850 : 0 })),
    { kind: "preset", preset: "red" },
  );
  assert.equal(overlay.state.signature, signature);
});

test("equal cooldown labels skip projection while resize refreshes it", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  let left = 10;
  let reads = 0;
  const consumer = createSkillCooldownOverlayConsumer(
    body as unknown as HTMLElement,
    {
      getBoundingClientRect: () => {
        reads += 1;
        return { left, top: 20, width: 800, height: 600 };
      },
    } as HTMLCanvasElement,
  );
  consumer.sync({ kind: "preset", preset: "red" }, true);
  consumer.update(geometry());
  consumer.setCooldownState({
    status: "ready",
    sequence: 2,
    generation: 1,
    gameTimer: 10_000,
    playerAgentId: 7,
    rechargeTimestamps: [23_999, 0, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(reads, 1);

  consumer.setCooldownState({
    status: "ready",
    sequence: 4,
    generation: 1,
    gameTimer: 10_050,
    playerAgentId: 7,
    rechargeTimestamps: [23_999, 0, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(reads, 1, "the still-visible 14-second label does not project again");

  left = 30;
  document.defaultView.dispatch("resize");
  assert.equal(reads, 2);
  assert.match(body.children[0]!.children[0]!.style.cssText, /left:130px/u);
  consumer.dispose();
});

test("either accepted feed withdrawing hides the complete cooldown HUD", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  const consumer = createSkillCooldownOverlayConsumer(
    body as unknown as HTMLElement,
    { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
  );
  const cooldowns = {
    status: "ready" as const,
    sequence: 2,
    generation: 1,
    gameTimer: 10_000,
    playerAgentId: 7,
    rechargeTimestamps: [11_000, 0, 0, 0, 0, 0, 0, 0],
  };
  consumer.sync({ kind: "preset", preset: "red" }, true);
  consumer.update(geometry());
  consumer.setCooldownState(cooldowns);
  const root = body.children[0]!;
  assert.equal(root.style.display, "block");
  consumer.setCooldownState({ status: "waiting", reason: "stale" });
  assert.equal(root.style.display, "none");
  consumer.update(geometry(4));
  assert.equal(root.style.display, "none", "fresh geometry cannot mask withdrawn recharge state");
  consumer.setCooldownState({ ...cooldowns, sequence: 4, gameTimer: 10_100 });
  assert.equal(root.style.display, "block");
});
