// P7.2. The first Enhancement feature. The states here come out of the real
// decoder, driven by real snapshot bytes, so this executes the last two stages
// of the pipeline together — snapshot → decoder → UI — and reads back what
// landed in the elements the readout owns. Nothing here inspects source text.
import assert from "node:assert/strict";
import test from "node:test";
import {
  createTargetReadout,
  targetReadout,
} from "../../src/renderer/enhancement-readout.js";
import { readCompanionSnapshot } from "../../src/renderer/companion-snapshot.js";

const MAGIC = 0x42545747;
const LIVING = 0xdb;
const READY = 1 << 0;
const PLAYER = 1 << 1;
const TARGET = 1 << 2;
const LOADING = 1 << 3;

/**
 * Snapshot bytes as the kernel publishes them. With no target selected every
 * target field is zeroed, which is the case the readout must not render.
 */
function bytes(options: {
  flags?: number;
  sequence?: number;
  distance?: number;
  rangeBand?: number;
} = {}) {
  const flags = options.flags ?? READY | PLAYER | TARGET;
  const target = (flags & TARGET) !== 0;
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, options.sequence ?? 2, true);
  view.setUint32(12, flags, true);
  view.setUint32(16, 40, true);
  view.setUint32(20, flags === LOADING ? 0 : 133, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, flags === LOADING ? 0 : 7, true);
  view.setFloat32(32, flags === LOADING ? 0 : -9827.3, true);
  view.setFloat32(36, flags === LOADING ? 0 : 34130.2, true);
  view.setUint32(40, target ? 9 : 0, true);
  view.setUint32(44, target ? LIVING : 0, true);
  view.setFloat32(48, target ? -9700 : 0, true);
  view.setFloat32(52, target ? 34100 : 0, true);
  view.setFloat32(56, target ? (options.distance ?? 1248.4) : 0, true);
  view.setUint32(60, target ? (options.rangeBand ?? 5) : 0, true);
  return buffer;
}

const decode = (options?: Parameters<typeof bytes>[0]) =>
  readCompanionSnapshot(bytes(options), 0);

/** The DOM surface the readout uses, and nothing else. */
class FakeElement {
  tagName: string;
  id = "";
  textContent = "";
  style: { cssText: string; display: string } = { cssText: "", display: "" };
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  /** Every textContent write, so an idle frame's cost is measurable. */
  writes = 0;
  ownerDocument: FakeDocument;

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    return new Proxy(this, {
      set(target, key, value) {
        if (key === "textContent") target.writes += 1;
        return Reflect.set(target, key, value);
      },
    });
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    const siblings = this.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeDocument {
  createElement(tagName: string) {
    return new FakeElement(tagName, this);
  }
}

function mount() {
  const document = new FakeDocument();
  const body = document.createElement("body");
  const readout = createTargetReadout(body as unknown as HTMLElement);
  const root = body.children[0]!;
  const [label, distance, range] = root.children as [
    FakeElement,
    FakeElement,
    FakeElement,
  ];
  return {
    body,
    readout,
    root,
    label,
    distance,
    range,
    get visible() {
      return root.style.display !== "none";
    },
    get line() {
      return `${distance.textContent} ${range.textContent}`;
    },
  };
}

test("a selected target shows its distance and its range band", () => {
  const view = mount();
  view.readout.update(decode());
  assert.equal(view.visible, true);
  assert.equal(view.line, "1248 Spellcast");
  assert.equal(view.label.textContent, "Target");
  assert.deepEqual(view.readout.state, {
    visible: true,
    line: "1248 Spellcast",
  });
});

test("every band the snapshot can carry has a name to show", () => {
  const view = mount();
  const seen: string[] = [];
  for (let rangeBand = 1; rangeBand <= 8; rangeBand += 1) {
    view.readout.update(decode({ rangeBand, distance: rangeBand * 100 }));
    assert.equal(view.visible, true);
    seen.push(view.line);
  }
  assert.deepEqual(seen, [
    "100 Adjacent",
    "200 Nearby",
    "300 Area",
    "400 Earshot",
    "500 Spellcast",
    "600 Spirit",
    "700 Compass",
    "800 Beyond compass",
  ]);
});

test("nothing is shown until the snapshot says a target is selected", () => {
  const view = mount();
  // Every state the decoder publishes short of a selected target: no target,
  // loading, a game that has not started, and a torn read.
  for (const state of [
    decode({ flags: READY | PLAYER }),
    decode({ flags: LOADING }),
    decode({ flags: READY }),
    decode({ sequence: 3 }),
    { status: "unsupported" },
  ]) {
    view.readout.update(state);
    assert.equal(view.visible, false, JSON.stringify(state));
  }
  assert.equal(view.readout.state.visible, false);
  assert.equal(view.distance.textContent, "");
});

test("dropping the target hides the readout again", () => {
  const view = mount();
  view.readout.update(decode({ rangeBand: 4, distance: 340 }));
  assert.equal(view.line, "340 Earshot");
  view.readout.update(decode({ flags: READY | PLAYER }));
  assert.equal(view.visible, false);
  assert.equal(view.readout.state.line, "");
  view.readout.update(decode({ rangeBand: 4, distance: 340 }));
  assert.equal(view.visible, true);
  assert.equal(view.line, "340 Earshot");
});

test("an unchanged target costs no DOM write, however many frames pass", () => {
  // It runs inside the per-frame observer, next to the cursor poll.
  const view = mount();
  view.readout.update(decode({ distance: 1248.4 }));
  const writes = view.distance.writes + view.range.writes;
  for (let frame = 0; frame < 240; frame += 1) {
    view.readout.update(decode({ distance: 1248.2 }));
  }
  assert.equal(view.distance.writes + view.range.writes, writes);
  view.readout.update(decode({ distance: 1249.6 }));
  assert.equal(view.line, "1250 Spellcast");
  assert.equal(view.distance.writes + view.range.writes, writes + 2);
});

test("a state missing the fields it claims renders nothing", () => {
  // The decoder cannot publish these; printing `NaN` over someone's game
  // because it one day could is not a trade worth making.
  const view = mount();
  view.readout.update(decode());
  for (const broken of [
    { status: "ready", targetValid: true, distance: Number.NaN, rangeName: "Area" },
    { status: "ready", targetValid: true, rangeName: "Area" },
    { status: "ready", targetValid: true, distance: 700 },
  ]) {
    view.readout.update(broken);
    assert.equal(view.visible, false, JSON.stringify(broken));
    view.readout.update(decode());
  }
  assert.equal(targetReadout({ status: "ready", targetValid: true }), null);
});

test("the readout takes the page back with it", () => {
  const view = mount();
  view.readout.update(decode());
  assert.equal(view.body.children.length, 1);
  view.readout.dispose();
  assert.deepEqual(view.body.children, []);
});

test("the overlay never takes a click and is never announced", () => {
  // It sits over the game canvas; pointer events and a live region would both
  // be defects the player cannot switch off.
  const view = mount();
  assert.match(view.root.style.cssText, /pointer-events:none/u);
  assert.equal(view.root.attributes.get("aria-live"), "off");
});
