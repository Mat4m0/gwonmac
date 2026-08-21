// The skill table has no fixed address — it moves with every client build, and
// the Enhancement transform shifts it again — so it is found by its shape. A
// weak signature finds thousands of matches: a scan for "plausible icon file
// ids" alone returned 2,559 candidate windows, and the first one printed
// convincing-looking garbage. The signature is four weak fields together, and
// this is mostly about the near-misses each one has to reject.
//
//   node --import ./scripts/ts-hook.mjs --test \
//     tests/unit/the-skill-table-is-found-by-shape-not-by-a-pinned-address.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodedIconToBmp,
  decodedShard,
  skillAvailability,
} from "../../src/main/core/skill-catalogue.ts";
import {
  decodeEnergyCost,
  findSkillTable,
  signatureRun,
  SKILL_RECORD_BYTES,
} from "../../src/main/core/skill-table.ts";

/** A run of skill records with the shape the scanner looks for. */
function skillRecords(count: number, from = 0): Uint8Array {
  const bytes = new Uint8Array((from + count) * SKILL_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < from + count; i++) {
    const at = i * SKILL_RECORD_BYTES;
    view.setUint32(at, i, true);
    view.setUint32(at + 0x08, i % 5, true);
    view.setUint32(
      at + 0x10,
      (i % 9 === 0 ? 0x4 : 0) | (i === 2 ? 0x02000000 : 0),
      true,
    );
    bytes[at + 0x28] = (i % 10) + 1;
    bytes[at + 0x29] = i % 45;
    view.setUint32(at + 0x8c, 50000 + i, true);
  }
  return bytes;
}

test("the whole table is read, from record zero", () => {
  const records = skillRecords(400);
  const mechanics = new DataView(records.buffer);
  const third = 3 * SKILL_RECORD_BYTES;
  const fourth = 4 * SKILL_RECORD_BYTES;
  const fifth = 5 * SKILL_RECORD_BYTES;
  records[third + 0x35] = 11;
  records[fourth + 0x34] = 99;
  mechanics.setUint32(fourth + 0x2c, 1004, true);
  records[fourth + 0x33] = 2;
  mechanics.setFloat32(fourth + 0x3c, 4.25, true);
  mechanics.setFloat32(fourth + 0x40, 0.75, true);
  mechanics.setUint32(fourth + 0x4c, 9, true);
  mechanics.setUint32(fifth + 0x10, 0x1, true);
  records[fifth + 0x34] = 10;
  const table = findSkillTable(records);
  assert.ok(table);
  assert.equal(table.at, 0);
  assert.equal(table.skills.length, 400);
  assert.equal(table.skills[0]?.id, 0);
  assert.equal(table.skills[399]?.id, 399);
  assert.equal(table.skills[9]?.iconFileId, 50009);
  assert.equal(table.skills[0]?.elite, true, "special & 0x4 is the elite test");
  assert.equal(table.skills[1]?.elite, false);
  assert.equal(table.skills[1]?.playable, true);
  assert.equal(
    table.skills[2]?.playable,
    false,
    "special & 0x02000000 excludes internal records",
  );
  assert.equal(
    table.skills[3]?.energyCost,
    15,
    "encoded energy sentinel 11 means 15",
  );
  assert.equal(table.skills[4]?.pvpReplacement, 1004);
  assert.equal(table.skills[4]?.equipType, 2);
  assert.equal(
    table.skills[4]?.overcast,
    0,
    "an unflagged padding byte is not overcast",
  );
  assert.equal(table.skills[4]?.activationSeconds, 4.25);
  assert.equal(table.skills[4]?.aftercastSeconds, 0.75);
  assert.equal(table.skills[4]?.rechargeSeconds, 9);
  assert.equal(
    table.skills[5]?.overcast,
    10,
    "the special flag makes overcast meaningful",
  );
});

test("energy-cost sentinels are normalized at the parsing boundary", () => {
  assert.equal(decodeEnergyCost(5), 5);
  assert.equal(decodeEnergyCost(11), 15);
  assert.equal(decodeEnergyCost(12), 25);
});

test("the table is found even when the scan lands in the middle of it", () => {
  // The scan starts wherever a confident run begins, which is not record 0.
  // Record 0 is derived from the id at the hit, because walking backwards by
  // signature stops at the first record that happens to fail it.
  const bytes = new Uint8Array(300 + 400 * SKILL_RECORD_BYTES);
  bytes.set(skillRecords(400), 300);
  const table = findSkillTable(bytes);
  assert.ok(table);
  assert.equal(table.at, 300);
  assert.equal(table.skills.length, 400);
});

test("each weak field of the signature rejects its own near miss", () => {
  // Individually these are all common values. The point of the composite is
  // that a window has to satisfy every one of them at once, and this asserts
  // each is actually being checked rather than carried by the others.
  const cases: readonly [string, number, number][] = [
    ["a profession past the ten that exist", 0x28, 11],
    ["an attribute that is neither real nor the sentinel", 0x29, 60],
    ["a campaign beyond any that shipped", 0x08, 99],
  ];
  for (const [what, field, value] of cases) {
    const bytes = skillRecords(40);
    if (field === 0x08) {
      new DataView(bytes.buffer).setUint32(
        20 * SKILL_RECORD_BYTES + field,
        value,
        true,
      );
    } else {
      bytes[20 * SKILL_RECORD_BYTES + field] = value;
    }
    assert.equal(signatureRun(bytes, 0, 40), 20, what);
  }
});

test("ids that do not ascend end the run", () => {
  // The table is ordered by id, so a repeat or a step backwards is not a table.
  const bytes = skillRecords(40);
  new DataView(bytes.buffer).setUint32(15 * SKILL_RECORD_BYTES, 3, true);
  assert.equal(signatureRun(bytes, 0, 40), 15);
});

test("a binary with no table says so instead of guessing", () => {
  assert.equal(findSkillTable(new Uint8Array(4096)), null);
  // Long enough to be scanned, shaped wrong throughout.
  const noise = new Uint8Array(SKILL_RECORD_BYTES * 200).fill(0xab);
  assert.equal(findSkillTable(noise), null);
});

// ## The catalogue built on top

test("availability separates what a player may actually equip", () => {
  const base = { equipType: 1, playable: true, pvp: false, pve: false, title: 0 };
  assert.equal(skillAvailability(base), "pve");
  assert.equal(skillAvailability({ ...base, pvp: true }), "pvp");
  assert.equal(skillAvailability({ ...base, playable: false }), "not-equippable");
  assert.equal(
    skillAvailability({ ...base, pve: true, title: 10 }),
    "player-only-pve",
    "a PvE skill on a title track below Codex is player-only",
  );
  assert.equal(
    skillAvailability({ ...base, pve: true, title: 41 }),
    "pve",
    "Codex and above are ordinary PvE skills",
  );

  // The client's own `skill_equip_type` is what decides, and it is checked
  // first: the table is mostly not skills, and the records that are not carry
  // every other flag a real skill does. `Boss Bounty` is playable, PvE-flagged
  // and named — only this field says it cannot go on a bar.
  for (const equipType of [0, 2, 3]) {
    assert.equal(
      skillAvailability({ ...base, equipType, pve: true }),
      "not-equippable",
      `equip type ${equipType} is not a skill-bar skill`,
    );
  }
});

/** A decoder icon payload: `GWIC`, width, height, then BGRA rows top-down. */
function gwic(width: number, height: number, fill = 0x40): Uint8Array {
  const bytes = new Uint8Array(8 + width * height * 4).fill(fill);
  bytes.set([0x47, 0x57, 0x49, 0x43], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, width, true);
  view.setUint16(6, height, true);
  return bytes;
}

test("a decoded icon becomes a bottom-up BMP without swapping its channels", () => {
  // The decoder labels RGB565's low bits `r`, but BC1 stores them as blue, so
  // its stream is already B,G,R,A — the order BMP wants. A well-meaning
  // RGBA-to-BGRA swap here turns every icon's colours inside out.
  const source = gwic(2, 2);
  source.set([1, 2, 3, 4], 8); // top-left pixel
  source.set([9, 8, 7, 6], 8 + 4 * 4 - 4); // bottom-right pixel
  const bmp = decodedIconToBmp(source);

  assert.equal(bmp.subarray(0, 2).toString("ascii"), "BM");
  assert.equal(bmp.readUInt32LE(10), 54, "pixels start after the 54-byte head");
  assert.equal(bmp.readInt32LE(18), 2);
  assert.equal(bmp.readInt32LE(22), 2);
  assert.equal(bmp.readUInt16LE(28), 32, "32 bits per pixel");
  // BMP rows run bottom-up, so the source's first row lands last.
  assert.deepEqual([...bmp.subarray(54 + 8, 54 + 12)], [1, 2, 3, 4]);
  assert.deepEqual([...bmp.subarray(54 + 4, 54 + 8)], [9, 8, 7, 6]);
});

test("an icon the decoder could not have produced is refused", () => {
  assert.throws(() => decodedIconToBmp(new Uint8Array(4)), /invalid icon header/);
  assert.throws(
    () => decodedIconToBmp(new Uint8Array([0x47, 0x57, 0x44, 0x42, 0, 0, 0, 0])),
    /invalid icon header/,
    "a decompress-only payload is not an icon",
  );
  // Dimensions that disagree with the payload, and dimensions past the bound.
  const short = gwic(4, 4).subarray(0, 8 + 16);
  assert.throws(() => decodedIconToBmp(short), /invalid icon dimensions/);
  const huge = gwic(1, 1);
  new DataView(huge.buffer).setUint16(4, 512, true);
  assert.throws(() => decodedIconToBmp(huge), /invalid icon dimensions/);
});

test("a decompressed shard is unwrapped only when its length agrees", () => {
  const payload = Buffer.from("shard bytes", "utf8");
  const wrapped = Buffer.alloc(8 + payload.length);
  wrapped.write("GWDB", 0, "ascii");
  wrapped.writeUInt32LE(payload.length, 4);
  payload.copy(wrapped, 8);
  assert.equal(decodedShard(wrapped).toString("utf8"), "shard bytes");

  assert.throws(() => decodedShard(Buffer.alloc(4)), /invalid shard header/);
  const lying = Buffer.from(wrapped);
  lying.writeUInt32LE(payload.length + 1, 4);
  assert.throws(() => decodedShard(lying), /invalid shard length/);
});
