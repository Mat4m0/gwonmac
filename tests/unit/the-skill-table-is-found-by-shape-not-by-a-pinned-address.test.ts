// The skill table has no fixed address — it moves with every client build, and
// the Enhancement transform shifts it again — so it is found by its shape. A
// weak signature finds thousands of matches: a scan for "plausible icon file
// ids" alone returned 2,559 candidate windows, and the first one printed
// convincing-looking garbage. The signature is four weak fields together, and
// this is mostly about the near-misses each one has to reject.
//
//   node --import ./scripts/ts-hook.mjs --experimental-strip-types --test \
//     tests/unit/the-skill-table-is-found-by-shape-not-by-a-pinned-address.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  presentSkill,
  readSkillCatalogue,
  skillAvailability,
} from "../../src/main/core/skill-catalogue.ts";
import { skillName } from "../../src/main/core/skill-names.ts";
import {
  decodeEnergyCost,
  findSkillTable,
  parseSkillRecord,
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

test("the committed vocabulary names skills by id, positionally", () => {
  // Off-by-one here would mislabel every skill in the editor, and every name
  // would still look like a real skill name — so the ends are pinned.
  assert.equal(skillName(0), "No Skill");
  assert.equal(skillName(1), "Healing Signet");
  assert.equal(skillName(2), "Resurrection Signet");
  assert.equal(skillName(3), "Signet of Capture");
  assert.equal(skillName(5), "Power Block");
  // A gap in the enum is an absence, not the next name shifted up.
  assert.equal(skillName(1_000_000), null);
});

test("availability separates what a player may actually equip", () => {
  const base = { id: 1, playable: true, pvp: false, pve: false, title: 0 };
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
  // Not playable-flagged, but on the audited allowlist: id 1 is Healing Signet.
  assert.equal(skillAvailability(base), "pve");
  // A record past the allowlist is refused rather than assumed equippable.
  assert.equal(skillAvailability({ ...base, id: 3_000_000 }), "not-equippable");
});

test("a presented skill reports no icon rather than a URL that would 404", () => {
  // `hasIcon` stays on the wire so serving icons later needs no renderer edit;
  // what must not happen is claiming one that the protocol cannot produce.
  const records = skillRecords(40);
  const skill = presentSkill(parseSkillRecord(records, SKILL_RECORD_BYTES));
  assert.equal(skill.id, 1);
  assert.equal(skill.name, "Healing Signet");
  assert.equal(skill.hasIcon, false);
  assert.equal(skill.description, null);
  assert.equal(skill.profession, "R", "profession 2 is Ranger");
});

test("a client that cannot be read is a named refusal, not a throw", async () => {
  const missing = await readSkillCatalogue(
    path.join(tmpdir(), "gwonmac-no-such-client.wasm"),
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.reason, "client-unreadable");

  const dir = await mkdtemp(path.join(tmpdir(), "gwonmac-catalogue-"));
  try {
    const shaped = path.join(dir, "shaped.wasm");
    await writeFile(shaped, skillRecords(400));
    const read = await readSkillCatalogue(shaped);
    assert.equal(read.ok, true);
    assert.equal(read.ok === true && read.skills.length, 400);

    const noise = path.join(dir, "noise.wasm");
    await writeFile(noise, new Uint8Array(SKILL_RECORD_BYTES * 200).fill(0xab));
    const absent = await readSkillCatalogue(noise);
    assert.equal(absent.ok, false);
    assert.equal(absent.ok === false && absent.reason, "table-not-found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
