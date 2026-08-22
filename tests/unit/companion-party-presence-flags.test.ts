import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANION_PARTY_ABI,
  COMPANION_PARTY_BYTES,
  readCompanionParty,
} from "../../src/renderer/companion-snapshot.ts";

const PARTY_MAGIC = 0x50545747;
const PARTY_FLAGS_ROSTER = 1 << 0;
const SLOT_AT = 64 + 40 * 4;
const SLOT_OCCUPIED = 1 << 0;
const SLOT_SKILLS = 1 << 3;

function observedPlayer(): ArrayBuffer {
  const buffer = new ArrayBuffer(COMPANION_PARTY_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, PARTY_MAGIC, true);
  view.setUint32(4, (COMPANION_PARTY_BYTES << 16) | COMPANION_PARTY_ABI, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, PARTY_FLAGS_ROSTER, true);
  view.setUint32(16, 1, true);
  view.setUint32(40, 1, true);
  view.setUint32(SLOT_AT + 4, 7, true);
  view.setUint32(SLOT_AT + 20, SLOT_OCCUPIED, true);
  return buffer;
}

function expectPartyRefusal(buffer: ArrayBuffer): void {
  assert.deepEqual(readCompanionParty(buffer, 0), {
    status: "waiting",
    reason: "party",
  });
}

test("party rows refuse payload for optional fields whose presence flag is absent", () => {
  for (const mutate of [
    (view: DataView) => view.setUint32(SLOT_AT + 8, 1, true),
    (view: DataView) => view.setUint32(SLOT_AT + 16, 1, true),
    (view: DataView) => view.setUint32(SLOT_AT + 24, 1, true),
    (view: DataView) => view.setUint32(SLOT_AT + 28, 1, true),
    (view: DataView) => view.setUint32(SLOT_AT + 60, 17 | (7 << 8), true),
  ]) {
    const buffer = observedPlayer();
    mutate(new DataView(buffer));
    expectPartyRefusal(buffer);
  }
});

test("an observed zero-filled player and a present all-zero skillbar remain valid", () => {
  assert.equal(readCompanionParty(observedPlayer(), 0).status, "ready");

  const skillbar = observedPlayer();
  new DataView(skillbar).setUint32(
    SLOT_AT + 20,
    SLOT_OCCUPIED | SLOT_SKILLS,
    true,
  );
  const read = readCompanionParty(skillbar, 0);
  assert.equal(read.status, "ready");
  if (read.status === "ready") {
    assert.deepEqual(read.slots[0]?.skills, [0, 0, 0, 0, 0, 0, 0, 0]);
  }
});
