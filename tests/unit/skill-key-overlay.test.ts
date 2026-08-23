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
  textContent = "";
  textWrites = 0;
  style = { cssText: "", display: "" };
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  ownerDocument: FakeDocument;

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

  remove() {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

const slots = (): readonly SkillKeySlot[] => Object.freeze(
  [Object.freeze({
    x: 464,
    y: 320,
    width: 50,
    height: 50,
    label: "C",
  })],
);

function mount() {
  const document = new FakeDocument();
  const body = document.createElement();
  const overlay = createSkillKeyOverlay(body as unknown as HTMLElement);
  const root = body.children[0]!;
  return { body, overlay, root };
}

test("a custom projection adds only the changed key label", () => {
  const view = mount();
  view.overlay.update({ status: "ready", slots: slots() });
  assert.equal(view.root.style.display, "block");
  assert.equal(view.root.children.length, 8);
  assert.deepEqual(
    view.root.children.map((slot) => slot.children[0]?.textContent),
    ["C", "", "", "", "", "", "", ""],
  );
  assert.match(view.root.children[0]!.style.cssText, /left:464px;top:320px/u);
  assert.match(view.root.children[0]!.children[0]!.style.cssText, /min-width:18px/u);
  assert.match(view.root.children[1]!.style.cssText, /display:none/u);
});

test("a malformed or absent custom binding hides the complete overlay", () => {
  const good = slots();
  for (const bad of [
    [],
    [{ ...good[0]!, x: Number.NaN }],
    [{ ...good[0]!, width: 0 }],
    [{ ...good[0]!, label: " C " }],
    [{ ...good[0]!, label: "123456789" }],
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
  const writes = view.root.children.reduce(
    (total, slot) => total + (slot.children[0]?.textWrites ?? 0),
    0,
  );
  for (let frame = 0; frame < 240; frame += 1) view.overlay.update(state);
  assert.equal(
    view.root.children.reduce(
      (total, slot) => total + (slot.children[0]?.textWrites ?? 0),
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
  assert.equal(root.children[0]!.children[0]!.textContent, "C");
  assert.match(root.children[0]!.style.cssText, /left:474px;top:552px/u);
  assert.match(root.children[1]!.style.cssText, /display:none/u);
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
