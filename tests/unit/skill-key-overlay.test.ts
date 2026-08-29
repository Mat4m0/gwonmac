import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkillKeyOverlay,
  skillKeyOverlayProjection,
  type SkillKeySlot,
} from "../../src/renderer/skill-key-overlay.js";
import { createSkillKeyOverlayConsumer } from "../../src/renderer/skill-key-overlay-consumer.js";
import { createCompanionSequenceFeed } from "../../src/renderer/companion-sequence-feed.js";
import {
  sameCompanionSkillSlotGeometry,
  type CompanionSkillSlotState,
} from "../../src/renderer/companion-interface-geometry-snapshot.js";

class FakeElement {
  id = "";
  className = "";
  hidden = false;
  title = "";
  textContent = "";
  textWrites = 0;
  style = { cssText: "", display: "" };
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  ownerDocument: FakeDocument;
  classList = { add: (...names: string[]) => { this.className += ` ${names.join(" ")}`; } };

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
    return new Proxy(this, {
      set(target, key, value) {
        if (key === "textContent") target.textWrites += 1;
        return Reflect.set(target, key, value);
      },
    });
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = [];
    this.append(...children);
  }

  remove() {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeDocument {
  head: FakeElement;
  defaultView = new FakeWindow();

  constructor() {
    this.head = new FakeElement(this);
  }

  createElement() {
    return new FakeElement(this);
  }

  createElementNS() {
    return new FakeElement(this);
  }

  getElementById(id: string) {
    return this.head.children.find((child) => child.id === id) ?? null;
  }
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

const slots = (): readonly SkillKeySlot[] => Object.freeze(
  [Object.freeze({
    x: 464,
    y: 320,
    width: 50,
    height: 50,
    binding: {
      input: { kind: "keyboard" as const, code: "KeyC" },
      modifiers: { control: false, option: false, shift: false, command: false },
    },
  })],
);

function mount() {
  const document = new FakeDocument();
  const body = document.createElement();
  const overlay = createSkillKeyOverlay(body as unknown as HTMLElement);
  const root = body.children[0]!;
  return { body, overlay, root };
}

const textOf = (element: FakeElement | undefined): string | undefined =>
  element === undefined
    ? undefined
    : element.textContent + element.children.map((child) => textOf(child) ?? "").join("");

const textWritesOf = (element: FakeElement | undefined): number =>
  element === undefined
    ? 0
    : element.textWrites
      + element.children.reduce((total, child) => total + textWritesOf(child), 0);

test("a custom projection adds only the changed key label", () => {
  const view = mount();
  view.overlay.update({ status: "ready", slots: slots() });
  assert.equal(view.root.style.display, "block");
  assert.equal(view.root.children.length, 8);
  assert.deepEqual(
    view.root.children.map((slot) => textOf(slot.children[0]?.children.at(-1))),
    ["C", undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  );
  assert.match(view.root.children[0]!.style.cssText, /left:464px;top:320px/u);
  assert.match(view.root.children[0]!.children[0]!.style.cssText, /--skill-key-edge:17px/u);
  assert.match(view.root.children[1]!.style.cssText, /display:none/u);
});

test("a malformed or absent custom binding hides the complete overlay", () => {
  const good = slots();
  for (const bad of [
    [],
    [{ ...good[0]!, x: Number.NaN }],
    [{ ...good[0]!, width: 0 }],
    [{ ...good[0]!, binding: null }],
    [{ ...good[0]!, binding: { input: { kind: "keyboard", code: "Unknown" }, modifiers: {} } }],
  ]) {
    assert.equal(skillKeyOverlayProjection({ status: "ready", slots: bad }), null);
  }
  const view = mount();
  view.overlay.update({ status: "ready", slots: good });
  view.overlay.update({ status: "waiting", slots: good });
  assert.equal(view.root.style.display, "none");
  assert.equal(view.overlay.state.visible, false);
});

test("an unchanged frame performs no text write", () => {
  const view = mount();
  const state = { status: "ready", slots: slots() };
  view.overlay.update(state);
  const writes = view.root.children.reduce((total, slot) =>
    total + textWritesOf(slot.children[0]?.children.at(-1)), 0);
  for (let frame = 0; frame < 240; frame += 1) view.overlay.update(state);
  assert.equal(
    view.root.children.reduce(
      (total, slot) => total + textWritesOf(slot.children[0]?.children.at(-1)),
      0,
    ),
    writes,
  );
});

test("the consumer maps only slot eight's custom C binding", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }),
  } as HTMLCanvasElement;
  const consumer = createSkillKeyOverlayConsumer(
    body as unknown as HTMLElement,
    canvas,
  );
  const feed = createCompanionSequenceFeed<CompanionSkillSlotState>(
    { status: "waiting", reason: "memory" },
    { status: "waiting", reason: "stale" },
    { staleAfterMs: null, sameReadyState: sameCompanionSkillSlotGeometry },
  );
  const unsubscribe = feed.subscribe(consumer.update);
  consumer.setBindings([null, null, null, null, null, null, null, slots()[0]!.binding]);
  consumer.setEnabled(true);
  const ready = {
    status: "ready",
    sequence: 2,
    frameId: 1,
    chatFrameId: 0,
    chatInput: null,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Array.from({ length: 8 }, (_, index) => ({
      left: 100 + index * 52,
      bottom: 20,
      right: 148 + index * 52,
      top: 68,
    })),
  } as const;
  feed.update(ready);
  const root = body.children[0]!;
  assert.equal(textOf(root.children[0]!.children[0]!.children.at(-1)), "C");
  assert.match(root.children[0]!.style.cssText, /left:474px;top:552px/u);
  assert.match(root.children[1]!.style.cssText, /display:none/u);
  consumer.setEnabled(false);
  assert.equal(root.style.display, "none");
  feed.update({ ...ready, sequence: 4 });
  const accepted = feed.state;
  assert.equal(accepted.status, "ready");
  if (accepted.status !== "ready") assert.fail("the heartbeat was not accepted");
  assert.equal(accepted.sequence, 4, "the shared feed accepts the heartbeat");
  consumer.setEnabled(true);
  assert.equal(
    root.style.display,
    "block",
    "re-enabling labels reuses geometry that another skill HUD kept fresh",
  );
  unsubscribe();
  feed.dispose();
  consumer.dispose();
});

test("a viewport resize refreshes projected key geometry", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  let width = 800;
  let reads = 0;
  const canvas = {
    getBoundingClientRect: () => {
      reads += 1;
      return { left: 0, top: 0, width, height: 600 };
    },
  } as HTMLCanvasElement;
  const consumer = createSkillKeyOverlayConsumer(body as unknown as HTMLElement, canvas);
  consumer.setBindings([slots()[0]!.binding, null, null, null, null, null, null, null]);
  consumer.setEnabled(true);
  consumer.update({
    status: "ready",
    sequence: 2,
    frameId: 1,
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
  assert.match(body.children[0]!.children[0]!.style.cssText, /left:100px/u);
  assert.equal(reads, 1);

  width = 400;
  document.defaultView.dispatch("resize");
  assert.match(body.children[0]!.children[0]!.style.cssText, /left:50px/u);
  assert.equal(reads, 2);
  consumer.dispose();
});

test("the consumer withdraws geometry whose publisher stopped advancing", () => {
  const document = new FakeDocument();
  const body = document.createElement();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as HTMLCanvasElement;
  let time = 0;
  const timer: { pending?: () => void } = {};
  const consumer = createSkillKeyOverlayConsumer(body as unknown as HTMLElement, canvas);
  const feed = createCompanionSequenceFeed<CompanionSkillSlotState>(
    { status: "waiting", reason: "memory" },
    { status: "waiting", reason: "stale" },
    {
      now: () => time,
      staleAfterMs: 500,
      schedule: (callback) => {
        timer.pending = callback;
        return 1;
      },
      cancel: () => {
        delete timer.pending;
      },
    },
  );
  const unsubscribe = feed.subscribe(consumer.update);
  consumer.setBindings([slots()[0]!.binding, null, null, null, null, null, null, null]);
  consumer.setEnabled(true);
  const ready = {
    status: "ready" as const,
    sequence: 2,
    frameId: 1,
    chatFrameId: 0,
    chatInput: null,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Array.from({ length: 8 }, (_, index) => ({
      left: index * 50,
      bottom: 20,
      right: index * 50 + 48,
      top: 68,
    })),
  };
  feed.update(ready);
  const root = body.children[0]!;
  assert.equal(root.style.display, "block");
  time = 499;
  timer.pending?.();
  assert.equal(root.style.display, "block");
  time = 500;
  timer.pending?.();
  assert.equal(root.style.display, "none");
  feed.update({ ...ready, sequence: 4 });
  assert.equal(root.style.display, "block");
  feed.update({ status: "waiting", reason: "snapshot" });
  feed.update({ ...ready, sequence: 4 });
  assert.equal(
    root.style.display,
    "none",
    "a rejected snapshot cannot revive the sequence it invalidated",
  );
  feed.update({ ...ready, sequence: 6 });
  assert.equal(root.style.display, "block");
  unsubscribe();
  feed.dispose();
  consumer.dispose();
});

test("the surface never takes input or enters the accessibility tree", () => {
  const view = mount();
  assert.match(view.root.style.cssText, /pointer-events:none/u);
  assert.equal(view.root.attributes.get("aria-hidden"), "true");
});

test("disposing removes the complete surface", () => {
  const view = mount();
  assert.equal(view.body.children.length, 1);
  view.overlay.dispose();
  assert.equal(view.body.children.length, 0);
});
