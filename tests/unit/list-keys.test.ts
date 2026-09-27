import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listIndexAfter, listKeyStep, listPage } from "../../src/shared/ui/list-keys.js";

const key = (value: string, modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey">> = {}) =>
  ({ key: value, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent;

describe("the one list move", () => {
  it("steps, pages and jumps with the shared keys, and ⌃N ⌃P step", () => {
    assert.deepEqual(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "End", "Home"].map(name => listKeyStep(key(name), 4)), [1, -1, 4, -4, Infinity, -Infinity]);
    assert.equal(listKeyStep(key("n", { ctrlKey: true }), 4), 1);
    assert.equal(listKeyStep(key("p", { ctrlKey: true }), 4), -1);
  });
  it("leaves modified keys, other keys and a list's ← → alone; a carousel steps with ← →", () => {
    for (const event of [key("ArrowDown", { altKey: true }), key("ArrowDown", { metaKey: true }), key("ArrowDown", { shiftKey: true }), key("ArrowDown", { ctrlKey: true }), key("a"), key("ArrowLeft")]) assert.equal(listKeyStep(event, 4), null);
    assert.equal(listKeyStep(key("ArrowLeft"), 4, true), -1);
    assert.equal(listKeyStep(key("ArrowRight"), 4, true), 1);
  });
  it("never wraps, and starts from no selection at the first or, for End, the last item", () => {
    assert.equal(listIndexAfter(0, 7, -1), 0);
    assert.equal(listIndexAfter(6, 7, 1), 6);
    assert.equal(listIndexAfter(2, 7, 4), 6);
    assert.equal(listIndexAfter(5, 7, -Infinity), 0);
    assert.equal(listIndexAfter(-1, 7, 1), 0);
    assert.equal(listIndexAfter(-1, 7, -1), 0);
    assert.equal(listIndexAfter(-1, 7, Infinity), 6);
  });
  it("passes over items it may not select and holds when none is left that way", () => {
    const usable = (index: number) => index !== 0 && index !== 3 && index !== 6;
    assert.equal(listIndexAfter(2, 7, 1, usable), 4);
    assert.equal(listIndexAfter(4, 7, -1, usable), 2);
    assert.equal(listIndexAfter(5, 7, 1, usable), 5);
    assert.equal(listIndexAfter(1, 7, -1, usable), 1);
    assert.equal(listIndexAfter(1, 7, Infinity, usable), 5);
    assert.equal(listIndexAfter(5, 7, -Infinity, usable), 1);
    assert.equal(listIndexAfter(1, 7, 5, usable), 5);
    assert.equal(listIndexAfter(-1, 7, 1, usable), 1);
    assert.equal(listIndexAfter(-1, 7, Infinity, usable), 5);
    assert.equal(listIndexAfter(-1, 3, 1, () => false), -1);
    assert.equal(listIndexAfter(-1, 0, 1), -1);
  });
  it("pages by the rows that fit, keeping one for context", () => {
    const box = (clientHeight: number, offsetHeight = 0) => ({ clientHeight, offsetHeight });
    assert.equal(listPage(box(400), box(0, 40)), 9);
    assert.equal(listPage(box(400), null), 9);
    assert.equal(listPage(box(30), box(0, 40)), 1);
  });
});
