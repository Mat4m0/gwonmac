/**
 * Which skill ids a player may actually put on a bar.
 *
 * Guild Wars' skill table contains far more than that: NPC attacks, item
 * effects, weapon modifiers, unused records, and PvP replacements all share
 * the same table, and `Skill::IsPlayable()` alone does not separate them.
 *
 * This 2240-bit allowlist is the audited set GWToolbox++ generated from the
 * game's account-unlocked skill array, used under the MIT grant recorded in
 * THIRD-PARTY-NOTICES.md. Keeping the exact bitset here makes it the one
 * fail-closed answer: a future skill outside the known range is not presented
 * as equippable until the evidence is updated.
 */
const EQUIPPABLE_SKILLS = new Uint32Array([
  0xffefefe6, 0xefffffff, 0xffffff3e, 0xffffffff, 0xffffffff, 0xfffffffd,
  0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xfffdffff,
  0x9bfdffff, 0xffffffc0, 0x3dffffff, 0x00000000, 0x00000000, 0x1c000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x58000000,
  0x8fffffbe, 0xdfffff7f, 0xdc7ffffd, 0x3bfff0ef, 0xebfefffc, 0xeffdefff,
  0xfeffe01f, 0xfc00003f, 0xf33f7fff, 0x7ef8fc6b, 0xee000fed, 0x0563ef4b,
  0x00000000, 0xba6ffd80, 0xf1fffffe, 0x003ffebe, 0x00000000, 0xffe00000,
  0xfffddfff, 0xffffc07f, 0x000001ff, 0xfe000000, 0xdfafffdf, 0xffffff7f,
  0xffffffff, 0xffffbfff, 0x0000003f, 0xfffffffe, 0xfff80001, 0xff80007f,
  0xfffbff7f, 0x01ffffff, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0xffffffdc, 0x00000007, 0x0ffffff0, 0x00000000,
  0xff800000, 0x0000007f, 0xfffffc00, 0x70000007,
]);

export function isKnownEquippableSkill(skillId: number): boolean {
  if (!Number.isSafeInteger(skillId) || skillId < 0) return false;
  const word = EQUIPPABLE_SKILLS[Math.floor(skillId / 32)];
  return word !== undefined && (word & (1 << (skillId % 32))) !== 0;
}
