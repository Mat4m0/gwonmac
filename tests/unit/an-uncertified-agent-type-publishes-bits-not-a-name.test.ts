// P7.3. The snapshot's target type word used to be turned into `Item`,
// `Gadget` or `Living` by the decoder, while the readiness register in
// `docs/toolbox-development.md` still lists hostile/item/gadget as the next
// proof — three names, one of them certified. These tests execute the decoder
// against real snapshot bytes: the certified pattern keeps its name, every
// other accepted word publishes its raw bits under `Unknown`, and a word the
// kernel would never publish is still rejected.
import assert from "node:assert/strict";
import test from "node:test";
import { readToolboxSnapshot } from "../../src/renderer/toolbox-snapshot.js";

const MAGIC = 0x42545747;
const LIVING = 0xdb;
const ITEM = 0x400;
const GADGET = 0x200;

/** A ready snapshot with a selected target, minus the fields under test. */
function snapshot(agentTypeBits: number): ArrayBuffer {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 7, true);
  view.setUint32(16, 40, true);
  view.setUint32(20, 133, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, 7, true);
  view.setFloat32(32, -9827.3, true);
  view.setFloat32(36, 34130.2, true);
  view.setUint32(40, 9, true);
  view.setUint32(44, agentTypeBits, true);
  view.setFloat32(48, -9700, true);
  view.setFloat32(52, 34100, true);
  view.setFloat32(56, 130.8, true);
  view.setUint32(60, 1, true);
  return buffer;
}

function decode(agentTypeBits: number) {
  return readToolboxSnapshot(snapshot(agentTypeBits), 0) as {
    status: string;
    reason?: string;
    targetKind?: string;
    agentTypeBits?: number;
  };
}

test("the one live-certified agent pattern keeps its name", () => {
  const state = decode(LIVING);
  assert.equal(state.status, "ready");
  assert.equal(state.targetKind, "Living");
  assert.equal(state.agentTypeBits, LIVING);
});

test("an uncertified agent pattern publishes its bits, not a guess", () => {
  // Item and gadget are the two the kernel accepts and no live run has
  // confirmed. They must reach the renderer — dropping them would hide a real
  // target — but as bits under a kind that asserts nothing.
  for (const bits of [ITEM, GADGET, ITEM | GADGET, GADGET | 0x8000]) {
    const state = decode(bits);
    assert.equal(state.status, "ready");
    assert.equal(state.targetKind, "Unknown");
    assert.equal(state.agentTypeBits, bits);
  }
});

test("a living target keeps its name when uncertified bits ride along", () => {
  const state = decode(LIVING | ITEM);
  assert.equal(state.targetKind, "Living");
  assert.equal(state.agentTypeBits, LIVING | ITEM);
});

test("a type word the kernel would never publish is still rejected", () => {
  // The decoder validates the same property the kernel does rather than
  // trusting the writer, so widening the vocabulary must not widen this.
  for (const bits of [0, 0x8000, 0x100]) {
    assert.equal(decode(bits).reason, "corrupt");
  }
});

test("no target means no bits and no kind", () => {
  const buffer = snapshot(0);
  const view = new DataView(buffer);
  view.setUint32(12, 3, true);
  view.setUint32(40, 0, true);
  view.setFloat32(48, 0, true);
  view.setFloat32(52, 0, true);
  view.setFloat32(56, 0, true);
  view.setUint32(60, 0, true);
  const state = readToolboxSnapshot(buffer, 0) as {
    status: string;
    targetValid: boolean;
    targetKind: string;
    agentTypeBits: number;
  };
  assert.equal(state.status, "ready");
  assert.equal(state.targetValid, false);
  assert.equal(state.targetKind, "None");
  assert.equal(state.agentTypeBits, 0);
});
