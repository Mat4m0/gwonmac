import assert from "node:assert/strict";
import test from "node:test";
import { createCompassPathingOverlay } from
  "../../src/renderer/compass-pathing-overlay.js";

class FakeStyle { cssText = ""; display = ""; }
class FakeElement {
  id = "";
  style = new FakeStyle();
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  ownerDocument: FakeDocument;
  constructor(ownerDocument: FakeDocument) { this.ownerDocument = ownerDocument; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(...children: FakeElement[]) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children: FakeElement[]) {
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}
class FakeDocument {
  createElementNS() { return new FakeElement(this); }
}

const projection = Object.freeze({
  generation: 3,
  frameId: 9,
  circle: Object.freeze({ centerX: 700, centerY: 100, radius: 95 }),
  lines: Object.freeze([
    Object.freeze({ x1: 620, y1: 100, x2: 780, y2: 100 }),
  ]),
});

test("renders a pointer-transparent, aria-hidden Compass boundary surface", () => {
  const document = new FakeDocument();
  const parent = new FakeElement(document);
  const overlay = createCompassPathingOverlay(parent as unknown as HTMLElement);
  overlay.update(projection);
  const root = parent.children[0]!;
  assert.equal(root.id, "compass-pathing-spike-overlay");
  assert.equal(root.attributes.get("aria-hidden"), "true");
  assert.equal(root.attributes.get("focusable"), "false");
  assert.match(root.style.cssText, /pointer-events:none/u);
  assert.equal(root.style.display, "block");
  assert.equal(root.children.length, 2);
  assert.match(root.children[1]!.attributes.get("style") ?? "", /pointer-events:none/u);
});

test("withdrawal and malformed geometry remove the complete overlay", () => {
  const document = new FakeDocument();
  const parent = new FakeElement(document);
  const overlay = createCompassPathingOverlay(parent as unknown as HTMLElement);
  overlay.update(projection);
  overlay.update(null);
  const root = parent.children[0]!;
  assert.equal(root.style.display, "none");
  assert.equal(root.children.length, 0);
  overlay.update({ ...projection, circle: { ...projection.circle, radius: Number.NaN } });
  assert.equal(root.style.display, "none");
  assert.equal(overlay.state.visible, false);
});

test("an unchanged projection performs no DOM rebuild", () => {
  const document = new FakeDocument();
  const parent = new FakeElement(document);
  const overlay = createCompassPathingOverlay(parent as unknown as HTMLElement);
  overlay.update(projection);
  const root = parent.children[0]!;
  const line = root.children[1];
  overlay.update(projection);
  assert.equal(root.children[1], line);
  overlay.dispose();
  assert.equal(parent.children.length, 0);
});
