// What this file can prove about the party-loadout codec, and what it cannot.
//
// It cannot prove conformance. `plans/tools/hero-builds/evidence/party-loadout-codec.md`
// §"WHAT THIS DECIDES" establishes that no Guild Wars client has ever been
// observed producing or consuming one of these codes: the claim rests on a
// single comment whose own worked example fails its own decoder, and
// `primitives.md` §6.1/§6.2 are still unanswered. So every round trip below is
// this codec agreeing with itself. That makes these regression vectors, not
// conformance vectors, and no amount of green here changes A3's status.
//
// What it can prove is everything the evidence document *derives* — and it
// derives more than it looks. §1.7 works out from the alphabet and the bit
// order that a party loadout always begins `f`, that the second character is
// `4 × N` for `N` members, and that the empty party is exactly `fAA`. Those
// were computed by hand from cited source lines, independently of any code we
// wrote, so a codec that reproduces them is not merely self-consistent. The
// prefix table is asserted below character by character for that reason.
//
// Three claims are worth stating because they contradict the plan the codec was
// commissioned from:
//
//  1. **There is no version field.** `primitives.md` §A3 says "header 15, type
//     1, version, then …" — three fields for two nibbles. The implementation
//     writes two (§1.1). The third nibble is the member count, and the test
//     that a one-member code spells `fE` is the one that would fail first if
//     anyone re-read the prose and inserted a version.
//  2. **A code carries no behaviour, no panel flag, no disabled mask and no
//     name** (§1.4). The test that flipping all of them leaves the code
//     byte-identical is not a curiosity; it is the acceptance criterion for
//     "what does applying a code lose", and it must fail loudly if someone
//     smuggles those fields into the stream.
//  3. **An empty party position is dropped, not encoded.** The format has no
//     spelling for one, and `party-loadout.ts` explains why inventing one would
//     be a guess. So a team with holes round-trips its members and not its
//     seating plan, and that loss is asserted rather than worked around.
//
// The rejection half is the larger half on purpose. §1.5 lists what Toolbox's
// own decoder does *not* check — a character outside the alphabet truncates
// silently instead of failing, no field is range-checked, and a member count of
// 13-15 walks past the end of a fixed-size array — and every one of those is a
// case below. `assert.doesNotThrow` wraps each, because a decoder whose input
// is a string a stranger pasted has exactly one legal failure mode.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttributeRanks,
  Build,
  BuildLibrary,
  ProfessionPair,
  SkillBar,
  Team,
  TeamSlot,
} from "../../src/shared/builds/library.ts";
import {
  LIBRARY_VERSION,
  buildId,
  heroId,
  skillId,
  teamId,
} from "../../src/shared/builds/library.ts";
import {
  decodePartyLoadout,
  encodePartyLoadout,
  partyMembersOf,
} from "../../src/shared/builds/party-loadout.ts";
import type { PartyLoadoutMember } from "../../src/shared/builds/party-loadout.ts";
import { encodeSkillTemplate } from "../../src/shared/builds/skill-template.ts";
import { HERO_BY_ID } from "../../src/shared/builds/heroes.ts";

/** §1.2's alphabet, read LSB-first, so a test can reach one field of a real code. */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The same code with the first member's hero byte replaced and every other bit
 * left alone. The frame is a 4-bit header, a 4-bit type and a 4-bit count, so
 * the first hero id is bits 12-19 — which is one whole character plus two bits
 * of the next, and is why this cannot be done by editing a character.
 */
const withHeroByte = (code: string, hero: number): string => {
  const bits = [...code].flatMap((character) => {
    const value = ALPHABET.indexOf(character);
    assert.ok(value >= 0, character);
    return Array.from({ length: 6 }, (_, index) => (value >> index) & 1);
  });
  for (let index = 0; index < 8; index++) bits[12 + index] = (hero >> index) & 1;

  let rewritten = "";
  for (let start = 0; start < bits.length; start += 6) {
    let value = 0;
    for (let index = 0; index < 6; index++) {
      if (bits[start + index] === 1) value |= 1 << index;
    }
    rewritten += ALPHABET.charAt(value);
  }
  return rewritten;
};

/** Eight slots from ids, `null` for a hole, so a fixture reads as its seating plan. */
const bar = (...ids: readonly (number | null)[]): SkillBar => {
  const slots = ids.map((id) => (id === null ? null : skillId(id)));
  while (slots.length < 8) slots.push(null);
  const [zero, one, two, three, four, five, six, seven] = slots;
  return [
    zero ?? null,
    one ?? null,
    two ?? null,
    three ?? null,
    four ?? null,
    five ?? null,
    six ?? null,
    seven ?? null,
  ];
};

const makeBuild = (
  id: string,
  professions: ProfessionPair,
  skills: SkillBar,
  attributes: AttributeRanks,
): Build => ({
  id: buildId(id),
  name: `build ${id}`,
  professions,
  skills,
  attributes,
  tags: ["fixture"],
  notes: "",
  favourite: false,
  lastUsed: null,
  parent: null,
  origin: null,
});

// Real skill ids parsed out of the client enum by
// `plans/tools/hero-builds/evidence/skill-template-codec.md` §8, chosen so the
// party exercises all three skill widths: `s = 8` (every id below 256), the
// 11-bit case, and the narrow and wide attribute widths beside them.
const BUILDS: readonly Build[] = [
  makeBuild("b-player", ["A", "W"], bar(1637, 1022, 775, 781, 1018, 1028, 349, 2), {
    DaggerMastery: 12,
    CriticalStrikes: 10,
    Strength: 3,
  }),
  makeBuild("b-monk", ["Mo", "Me"], bar(282, 283, 281, 887, 311, 309, 38, 2), {
    HealingPrayers: 12,
    DivineFavor: 11,
    ProtectionPrayers: 3,
  }),
  makeBuild("b-ele", ["E", "Mo"], bar(884, 1379, 184, null, null, null, null, 2), {
    FireMagic: 12,
    EnergyStorage: 10,
    HealingPrayers: 3,
  }),
  // Monoclass, so `Profession::None` is exercised as a secondary, and an empty
  // bar, so the eight unconditional skill fields are exercised at width 8.
  makeBuild("b-empty-bar", ["W", null], bar(), {}),
  // Twelve invested attributes: the structural maximum a template can hold.
  makeBuild("b-wide", ["Rt", "R"], bar(2, 3, 4, 5, 6, 7, 8, 9), {
    Communing: 12,
    RestorationMagic: 11,
    ChannelingMagic: 10,
    SpawningPower: 9,
    BeastMastery: 8,
    Expertise: 7,
    WildernessSurvival: 6,
    Marksmanship: 5,
    Strength: 4,
    Tactics: 3,
    AxeMastery: 2,
    Swordsmanship: 1,
  }),
];

const slot = (
  build: string | null,
  hero: number | null,
  extra: Partial<TeamSlot> = {},
): TeamSlot => ({
  build: build === null ? null : buildId(build),
  hero: hero === null ? null : heroId(hero),
  behaviour: null,
  ...extra,
});

const makeTeam = (slots: readonly TeamSlot[]): Team => {
  const [zero, one, two, three, four, five, six, seven] = slots;
  assert.ok(
    zero && one && two && three && four && five && six && seven,
    "a team fixture is eight slots",
  );
  return {
    id: teamId("t-1"),
    name: "fixture team",
    tags: ["fixture"],
    mode: "hard",
    favourite: true,
    lastUsed: 1_700_000_000_000,
    notes: "notes the code cannot carry",
    slots: [zero, one, two, three, four, five, six, seven],
  };
};

const library = (teams: readonly Team[]): BuildLibrary => ({
  version: LIBRARY_VERSION,
  builds: BUILDS,
  teams,
  tags: ["fixture"],
});

/** A full party: the player in slot 0, seven heroes behind them. */
const FULL_TEAM = makeTeam([
  slot("b-player", null),
  slot("b-monk", 1, { behaviour: "guard" }),
  slot("b-ele", 2, { behaviour: "avoid" }),
  slot("b-empty-bar", 3, { behaviour: "fight" }),
  slot("b-wide", 22, { behaviour: "guard" }),
  // 39 is `GhostOfAlthea`, the highest id `heroes.ts` holds, so the widest hero
  // byte a party can legally carry is in the fixture.
  slot("b-monk", 39, { behaviour: "fight" }),
  slot("b-ele", 15, { behaviour: "avoid" }),
  slot("b-player", 8, { behaviour: "guard" }),
]);

const membersOf = (team: Team): readonly PartyLoadoutMember[] => {
  const members = partyMembersOf(library([team]), team);
  assert.ok(members, "the fixture library holds every build the team names");
  return members;
};

const encoded = (team: Team): string => {
  const code = encodePartyLoadout(membersOf(team));
  assert.ok(code, "the fixture party encodes");
  return code;
};

test("a full party of eight round-trips every hero and every bar", () => {
  const members = membersOf(FULL_TEAM);
  assert.equal(members.length, 8);

  const code = encoded(FULL_TEAM);
  // §1.7, derived by hand from the alphabet and the bit order: the first
  // character is always `f` because byte 0 is 0x1F, and the second is `4 × N`.
  assert.equal(code.slice(0, 2), "fg");

  const decoded = decodePartyLoadout(code);
  assert.deepEqual(decoded, members);
  // Encoding is a function of the members, so the second pass must be
  // character-identical: a width chosen from anything but the content would
  // show up here.
  assert.ok(decoded);
  assert.equal(encodePartyLoadout(decoded), code);
});

test("the player's slot survives as NoHero rather than as a hero id", () => {
  const decoded = decodePartyLoadout(encoded(FULL_TEAM));
  assert.ok(decoded);
  assert.equal(decoded[0]?.hero, null);
  assert.equal(decoded[1]?.hero, 1);
  // 39 is the largest id the hero table holds, and it round-trips rather than
  // wrapping to 0 and becoming a second player.
  assert.equal(decoded[5]?.hero, 39);
});

test("behaviour, the disabled mask and every name stay out of the code", () => {
  // §1.4: the encoder touches the code and the hero id and nothing else. If a
  // later change smuggles behaviour into the stream, these two codes diverge.
  const flipped = makeTeam(
    FULL_TEAM.slots.map((position, index) =>
      index === 0
        ? position
        : {
            ...position,
            behaviour: "fight",
            disabled: [1, 2, 3],
          },
    ),
  );
  const renamed: Team = {
    ...flipped,
    name: "a completely different name",
    tags: [],
    mode: "none",
    favourite: false,
    notes: "",
  };
  assert.equal(encoded(renamed), encoded(FULL_TEAM));

  // And nothing that is not a hero id or a bar comes back out.
  const decoded = decodePartyLoadout(encoded(FULL_TEAM));
  assert.ok(decoded);
  for (const member of decoded) {
    assert.deepEqual(Object.keys(member).sort(), ["hero", "template"]);
    assert.deepEqual(Object.keys(member.template).sort(), [
      "attributes",
      "professions",
      "skills",
    ]);
  }
});

test("an empty party position is dropped, and the member count says so", () => {
  const sparse = makeTeam([
    slot("b-player", null),
    slot(null, null),
    slot("b-monk", 4, { behaviour: "guard" }),
    slot(null, null),
    slot(null, null),
    slot("b-ele", 9, { behaviour: "avoid" }),
    slot(null, null),
    slot(null, null),
  ]);
  const members = membersOf(sparse);
  assert.equal(members.length, 3);

  const code = encoded(sparse);
  // §1.7: three members, so the second character is index 12.
  assert.equal(code.slice(0, 2), "fM");

  const decoded = decodePartyLoadout(code);
  assert.deepEqual(decoded, members);
  // The seating plan is the part a code cannot carry: the hero who sat in slot
  // 5 comes back as the third member, not the sixth.
  assert.ok(decoded);
  assert.equal(decoded[2]?.hero, 9);
});

test("the second character is 4 x N for every party a team can hold", () => {
  // The whole §1.7 table, which was derived from `TeamBuildEncoder.cpp:644`
  // and the alphabet rather than from any code we wrote.
  const expected = ["A", "E", "I", "M", "Q", "U", "Y", "c", "g"];
  for (let count = 0; count <= 8; count++) {
    const team = makeTeam(
      Array.from({ length: 8 }, (_, index) =>
        index < count ? slot("b-empty-bar", index === 0 ? null : index) : slot(null, null),
      ),
    );
    const code = encoded(team);
    assert.equal(code[0], "f", `party of ${count} begins f`);
    assert.equal(code[1], expected[count], `party of ${count} counts in char 2`);
    assert.equal(decodePartyLoadout(code)?.length, count);
  }
});

test("the empty party is the two-character probe, and Toolbox's three-character one reads", () => {
  // §1.7 derives `fAA` by hand: 12 bits rounded up to the two bytes
  // {0x1F, 0x00}, regrouped into 31, 0, 0. That rounding is §1.6's open
  // question — it comes from Toolbox's `vector<uint8_t>` intermediate, and this
  // encoder follows `skill-template.ts` in padding only to the next character.
  // Both are the empty party, and a live session answering `primitives.md`
  // §6.1 can paste either.
  assert.equal(encodePartyLoadout([]), "fA");
  assert.deepEqual(decodePartyLoadout("fA"), []);
  assert.deepEqual(decodePartyLoadout("fAA"), []);
});

test("the third nibble is a member count, not the version the plan describes", () => {
  // `primitives.md` §A3 reads "header 15, type 1, version, then …". If that
  // were the layout, a one-member party would spell version 1 here and the
  // member would start four bits late. It spells `E` = 4 x 1.
  const solo = makeTeam([
    slot("b-empty-bar", null),
    ...Array.from({ length: 7 }, () => slot(null, null)),
  ]);
  const code = encoded(solo);
  assert.equal(code.slice(0, 2), "fE");
  assert.equal(decodePartyLoadout(code)?.length, 1);
});

test("a truncated code is refused rather than decoded as a shorter party", () => {
  const code = encoded(FULL_TEAM);
  // Every prefix. §1.5 records that Toolbox's decoder can "succeed" on a
  // mangled string whose count field happens to be satisfied; none of these
  // may.
  for (let length = 1; length < code.length; length++) {
    const prefix = code.slice(0, length);
    assert.doesNotThrow(() => decodePartyLoadout(prefix));
    assert.equal(decodePartyLoadout(prefix), null, `prefix of length ${length}`);
  }
});

test("a wrong magic nibble is refused, including a real skill template", () => {
  // A skill template carries 14 where a party loadout carries 15, which is the
  // useful half of §1.7's `OwFj0…` analysis. `encodeSkillTemplate` produces a
  // genuine one.
  const template = encodeSkillTemplate({
    professions: ["A", "W"],
    skills: bar(1637, 1022, 775, 781, 1018, 1028, 349, 2),
    attributes: { DaggerMastery: 12 },
  });
  assert.ok(template);
  assert.equal(template[0], "O");
  assert.doesNotThrow(() => decodePartyLoadout(template));
  assert.equal(decodePartyLoadout(template), null);
});

test("a wrong type nibble is refused, at both spellings the first character has", () => {
  const code = encoded(FULL_TEAM);
  // Character 1 carries the header and the *low two bits* of the type (§1.7),
  // so the type can be changed without touching any other field. Header 15 with
  // type 3 is `/` (index 63); header 15 with type 0 is `P` (index 15) — which
  // is where the equipment template is rumoured to live, and is exactly the
  // code this decoder must not accept as a party.
  for (const first of ["/", "P"]) {
    const wrong = first + code.slice(1);
    assert.doesNotThrow(() => decodePartyLoadout(wrong));
    assert.equal(decodePartyLoadout(wrong), null, `type spelled ${first}`);
  }
});

test("a code claiming more members than a party can hold is refused", () => {
  const code = encoded(FULL_TEAM);
  // The count field is four bits, so nine to fifteen members encode and decode
  // cleanly in Toolbox (§1.3) and a count of 13-15 walks past the end of its
  // arrays (§1.5). Rewriting only character 2 leaves eight real bodies in place,
  // so what is refused here is the count and not a truncation.
  const overCount = ["k", "o", "s", "w", "0", "4", "8"];
  for (const [index, character] of overCount.entries()) {
    const wrong = code[0] + character + code.slice(2);
    assert.doesNotThrow(() => decodePartyLoadout(wrong));
    assert.equal(decodePartyLoadout(wrong), null, `count of ${9 + index}`);
  }
});

test("an over-long code is refused by length before anything is decoded", () => {
  const code = encoded(FULL_TEAM);
  // 672 characters is the widest eight-member party the format can spell; the
  // trailing zeros below would otherwise be legal padding, so length is the
  // only thing refusing them.
  const padded = code + "A".repeat(673 - code.length);
  assert.ok(padded.length > 672);
  assert.doesNotThrow(() => decodePartyLoadout(padded));
  assert.equal(decodePartyLoadout(padded), null);
  assert.equal(decodePartyLoadout("f".repeat(100_000)), null);
});

test("a character outside the alphabet refuses the whole string, not its prefix", () => {
  const code = encoded(FULL_TEAM);
  // §1.5: Toolbox `break`s at the first foreign character and decodes what it
  // has, so `fg…]` and `fg… ` decode a prefix. Both are refused here.
  for (const junk of ["]", " ", "=", "\n", "é", " "]) {
    const spliced = code.slice(0, 20) + junk + code.slice(20);
    assert.doesNotThrow(() => decodePartyLoadout(spliced));
    assert.equal(decodePartyLoadout(spliced), null, `spliced ${JSON.stringify(junk)}`);
    assert.equal(decodePartyLoadout(code + junk), null);
  }
});

test("trailing zero bits are padding and trailing data is not", () => {
  const code = encoded(FULL_TEAM);
  // §1.6 leaves two padding rules open and they differ only in trailing zeros,
  // so an extra `A` must stay readable...
  assert.deepEqual(decodePartyLoadout(code + "AAA"), decodePartyLoadout(code));
  // ...while anything with a bit set in it is a different string that this
  // encoder would never produce.
  assert.equal(decodePartyLoadout(code + "f"), null);
  assert.equal(decodePartyLoadout(code + "B"), null);
});

test("the empty string and obvious junk decode to null without throwing", () => {
  const junk = [
    "",
    " ",
    "f",
    "fg",
    "OwFj0dKEAAAAAAAA",
    "[TB;abc]",
    "null",
    "{}",
    "😀",
    "f".repeat(672),
    "A".repeat(672),
  ];
  for (const candidate of junk) {
    assert.doesNotThrow(() => decodePartyLoadout(candidate), candidate);
    const result = decodePartyLoadout(candidate);
    // `f` alone passes Toolbox's `IsDaybreakTeamBuild` sniff (§1.5) because the
    // absent bits read as zero. Sniffing is not decoding: it has no type nibble
    // and no count, so it is not a party.
    assert.equal(result, null, candidate);
  }
});

test("a party the format cannot spell is refused by the encoder", () => {
  const template = BUILDS[0];
  assert.ok(template);
  const member: PartyLoadoutMember = {
    hero: null,
    template: {
      professions: template.professions,
      skills: template.skills,
      attributes: template.attributes,
    },
  };

  // Nine members: our own limit, and the one that keeps §1.5's out-of-bounds
  // count out of the format.
  assert.equal(
    encodePartyLoadout(Array.from({ length: 9 }, () => member)),
    null,
  );

  // A hero id past the byte the format gives it.
  assert.equal(encodePartyLoadout([{ ...member, hero: heroId(256) }]), null);
  assert.equal(encodePartyLoadout([{ ...member, hero: heroId(-1) }]), null);
  // `HeroID` 0 is `NoHero`, which `library.ts` says is never stored: a record
  // holding it would encode into the player's slot and come back as `null`, so
  // it is refused rather than quietly renamed.
  assert.equal(encodePartyLoadout([{ ...member, hero: heroId(0) }]), null);
  // 39 is the edge that does encode, and it comes back as itself.
  const edge = encodePartyLoadout([{ ...member, hero: heroId(39) }]);
  assert.ok(edge);
  assert.equal(decodePartyLoadout(edge)?.[0]?.hero, 39);

  // A bar the skill template codec itself refuses: 23 bits is the widest skill
  // field the format has.
  assert.equal(
    encodePartyLoadout([
      { ...member, template: { ...member.template, skills: bar(1 << 24) } },
    ]),
    null,
  );
});

test("a hero id the client has no hero for is refused at both ends", () => {
  // The 8-bit field spells 255 and `heroes.ts` names 39 of those numbers.
  // `library.ts` says where the brand is declared that the module owning the
  // hero table is what mints a `HeroId`, so a byte off the wire may not become
  // one: hero 200 would decode into a member that every `HERO_BY_ID` lookup
  // answers `undefined` for, with no typed failure anywhere to notice it. 40 is
  // the sharpest case — it is the enum's `Count` end marker, not a hero.
  const template: PartyLoadoutMember["template"] = {
    professions: ["W", null],
    skills: bar(),
    attributes: {},
  };
  const player = encodePartyLoadout([{ hero: null, template }]);
  assert.ok(player);

  for (const id of [40, 200, 255]) {
    assert.equal(HERO_BY_ID.has(heroId(id)), false, `hero ${id} is not a hero`);
    assert.equal(
      encodePartyLoadout([{ hero: heroId(id), template }]),
      null,
      `encoding hero ${id}`,
    );

    // And the decoder is the half that matters, because a pasted code is where
    // such a byte actually comes from. The hero byte is the third character's
    // low bits onward; rebuilding the member from scratch keeps everything else
    // in the code identical to the party that does decode.
    const wire = encodePartyLoadout([{ hero: heroId(39), template }]);
    assert.ok(wire);
    const swapped = withHeroByte(wire, id);
    assert.doesNotThrow(() => decodePartyLoadout(swapped));
    assert.equal(decodePartyLoadout(swapped), null, `decoding hero ${id}`);
  }

  // The player's `NoHero` is not a hero either, and is the one byte outside the
  // table that decodes — to `null`, which is what the record spells it with.
  assert.deepEqual(decodePartyLoadout(player), [{ hero: null, template }]);
});

test("a bar that is not eight slots long cannot become a party member", () => {
  // The body carries one field per slot and no count, so a member's length is
  // read back off its width codes. A nine-slot record therefore used to lose
  // its ninth skill *silently* here — the party encoded, and to the very same
  // code as the eight-slot party — while the same record through
  // `encodeSkillTemplate` produced a string no decoder accepts. `SkillBar` is
  // eight long, and a library file read off disk is a promise nobody kept.
  const eight: PartyLoadoutMember["template"] = {
    professions: ["W", null],
    skills: bar(1, 2, 3, 4, 5, 6, 7, 8),
    attributes: {},
  };
  const short = { ...eight, skills: bar(1, 2, 3, 4, 5, 6, 7).slice(0, 7) as unknown as SkillBar };
  const long = {
    ...eight,
    skills: [...eight.skills, skillId(9)] as unknown as SkillBar,
  };

  const canonical = encodePartyLoadout([{ hero: null, template: eight }]);
  assert.ok(canonical);
  assert.equal(encodePartyLoadout([{ hero: null, template: long }]), null);
  assert.equal(encodePartyLoadout([{ hero: null, template: short }]), null);
  // The regression this pins: the nine-slot party is not the eight-slot party.
  assert.notEqual(encodePartyLoadout([{ hero: null, template: long }]), canonical);
});

test("a team naming a build the library lost cannot become a party", () => {
  // A dangling slot reference is a library to repair. Encoding the seven slots
  // that do resolve would publish a party that is silently missing a hero.
  const dangling = makeTeam([
    slot("b-player", null),
    slot("b-nowhere", 1),
    ...Array.from({ length: 6 }, () => slot(null, null)),
  ]);
  assert.doesNotThrow(() => partyMembersOf(library([dangling]), dangling));
  assert.equal(partyMembersOf(library([dangling]), dangling), null);
});
