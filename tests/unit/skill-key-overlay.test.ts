import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkillKeyOverlay,
  skillKeyOverlayProjection,
  type SkillKeySlot,
} from "../../src/renderer/skill-key-overlay.js";
import { createSkillKeyOverlayConsumer } from "../../src/renderer/skill-key-overlay-consumer.js";

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
  consumer.setBindings([null, null, null, null, null, null, null, slots()[0]!.binding]);
  consumer.setEnabled(true);
  consumer.update({
    status: "ready",
    sequence: 2,
    frameId: 1,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Array.from({ length: 8 }, (_, index) => ({
      left: 100 + index * 52,
      bottom: 20,
      right: 148 + index * 52,
      top: 68,
    })),
  });
  const root = body.children[0]!;
  assert.equal(textOf(root.children[0]!.children[0]!.children.at(-1)), "C");
  assert.match(root.children[0]!.style.cssText, /left:474px;top:552px/u);
  assert.match(root.children[1]!.style.cssText, /display:none/u);
  consumer.setEnabled(false);
  assert.equal(root.style.display, "none");
  consumer.setEnabled(true);
  assert.equal(root.style.display, "none", "a re-enabled overlay waits for fresh geometry");
  consumer.update({
    status: "ready",
    sequence: 4,
    frameId: 1,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Array.from({ length: 8 }, (_, index) => ({
      left: 100 + index * 52,
      bottom: 20,
      right: 148 + index * 52,
      top: 68,
    })),
  });
  assert.equal(root.style.display, "block");
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
