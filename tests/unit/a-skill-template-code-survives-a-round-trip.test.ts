// The codec has two contracts: every accepted code round-trips byte for byte,
// and every rejected code returns `null` without throwing or exposing a partial
// template. `VECTORS` are hand-built regression cases that exercise every width
// and the empty-section/middle-hole shapes naive decoders miss. `CONFORMANCE`
// contains externally produced codes from the hosted client, ArenaNet's wiki,
// and an independent encoder. The external cases prove compatibility; the
// hand-built cases provide coverage. Rejection cases are paired with a valid
// twin so they prove the named refusal rather than a decoder that rejects all
// input. The write direction remains a live-client release check: save in the
// hosted client, read `app:/Templates/Skills`, and compare.
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSkillTemplate,
  encodeSkillTemplate,
} from "../../src/shared/builds/skill-template.ts";
import type { SkillTemplate } from "../../src/shared/builds/skill-template.ts";
import { skillId } from "../../src/shared/builds/library.ts";

interface Vector {
  /** Where the code came from, and what it is here to exercise. */
  readonly what: string;
  readonly code: string;
  /**
   * The same payload one `A` shorter, under the six-bit padding rule this
   * codec used before the real codes in `CONFORMANCE` settled byte padding — or `null`
   * where the two rules agree on the length. The decoder still accepts it,
   * because trailing bits are zero either way; the encoder never writes it.
   */
  readonly sixBitPadded: string | null;
  readonly professions: readonly [string, string | null];
  /** In stream order. The order is load-bearing: see the round-trip test. */
  readonly attributes: Readonly<Record<string, number>>;
  readonly skills: readonly (number | null)[];
}

const VECTORS: readonly Vector[] = [
  {
    // The widest common attribute width and an 11-bit skill width, which
    // Toolbox's own writer cannot express (it never emits a
    // `skill_code` above 1, so it cannot spell any skill id past 511).
    what: "an Assassin/Warrior with 6-bit attributes and 11-bit skills",
    code: "OwFj0xja0MlZ/3Brhp/IgdFBAA",
    sixBitPadded: "OwFj0xja0MlZ/3Brhp/IgdFBA",
    professions: ["A", "W"],
    attributes: { DaggerMastery: 12, CriticalStrikes: 10, Strength: 3 },
    // Golden Fox Strike, Wild Strike, Death Blossom, Moebius Strike,
    // Critical Eye, Way of Perfection, Sprint, Resurrection Signet.
    skills: [1637, 1022, 775, 781, 1018, 1028, 349, 2],
  },
  {
    // The degenerate case, and the shortest legal template at 16
    // characters. Nothing is invested and nothing is slotted, and the code is
    // still 16 characters long, because `attr_code` is written even when the
    // count is 0 and all eight skill fields are written even when every one of
    // them is empty. A decoder that skips either produces garbage here.
    what: "an empty Warrior bar, where both width codes size nothing",
    code: "OQAAAAAAAAAAAAAA",
    sixBitPadded: null,
    professions: ["W", null],
    attributes: {},
    skills: [null, null, null, null, null, null, null, null],
  },
  {
    // `attr_code = 1`, the 5-bit attribute width. Toolbox's party writer
    // Toolbox's party-loadout writer emits only 0 or 2, so an encoder ported
    // from that file would write this build with 6-bit ids and produce a
    // decodable code that is not the one the client would have written.
    what: "a Monk/Mesmer with the 5-bit attribute width Toolbox cannot write",
    code: "OwUT0Y4+GRj2oM6uvpayEEAA",
    sixBitPadded: "OwUT0Y4+GRj2oM6uvpayEEA",
    professions: ["Mo", "Me"],
    attributes: { HealingPrayers: 12, DivineFavor: 11, ProtectionPrayers: 3 },
    // Word of Healing, Dwayna's Kiss, Orison of Healing, Signet of
    // Rejuvenation, Draw Conditions, Holy Veil, Channeling, Resurrection Signet.
    skills: [282, 283, 281, 887, 311, 309, 38, 2],
  },
  {
    // Four empty slots in the *middle* of the bar, and a resurrection
    // signet behind them. The long run of `A` characters is real data: a
    // decoder that stops at the first zero skill loses slot 8 and still returns
    // a plausible-looking build. Also the narrowest attribute width, 4 bits,
    // which is what a build of purely pre-Factions attributes selects.
    what: "an Elementalist/Monk with holes in the bar, not truncation",
    code: "OgNDoMr9M0txKuAAAAAAAABA",
    sixBitPadded: null,
    professions: ["E", "Mo"],
    attributes: { FireMagic: 12, EnergyStorage: 10, HealingPrayers: 3 },
    // Searing Flames, Glowing Gaze, Fire Attunement, four holes, Resurrection
    // Signet.
    skills: [884, 1379, 184, null, null, null, null, 2],
  },
];

/**
 * Real codes, and the only externally-produced evidence in this file.
 *
 * `VECTORS` above proves this codec agrees with the document it was written
 * from. These four prove the document agrees with Guild Wars, which is a
 * different claim and the one that matters. None of them was constructed here.
 *
 * Two carry a decoding published alongside them by someone who is not us, so
 * `professions`/`attributes`/`skills` below are transcribed rather than
 * observed — if this codec is wrong, these assertions fail. The other two are
 * quoted as real codes without a decoding; they are round-trip only, and what
 * they add is width combinations the first two do not reach.
 *
 * They also settled byte padding. Under the six-bit padding rule this codec shipped with,
 * the first and third came out one `A` short while the second and fourth were
 * byte-identical — which is what a padding rule looks like when you have it
 * wrong, and what no amount of self-consistent derivation could have caught.
 */
const CLIENT_WRITTEN = {
  what: "written by the hosted client itself into app:/Templates/Skills/SAVE.txt",
  code: "OwAU0Kn8Q4FgMjrUgtEA3TnA",
  // A monoclass Monk with four invested attributes and slot 6 empty. Nobody
  // chose this build to be a good vector — it is whatever was on the bar — and
  // that is exactly what makes it one.
  professions: ["Mo", null] as const,
  attributes: {
    HealingPrayers: 5,
    SmitingPrayers: 2,
    ProtectionPrayers: 8,
    DivineFavor: 7,
  },
  skills: [288, 281, 299, 258, 301, null, 247, 314] as const,
} as const;

const CONFORMANCE: readonly {
  readonly what: string;
  readonly source: string;
  readonly code: string;
  /** Empty where the source quoted the code without publishing its contents. */
  readonly decoded: Partial<
    Pick<Vector, "professions" | "attributes" | "skills">
  >;
}[] = [
  {
    what: CLIENT_WRITTEN.what,
    source: "app:/Templates/Skills/SAVE.txt, read out of IDBFS",
    code: CLIENT_WRITTEN.code,
    decoded: {
      professions: CLIENT_WRITTEN.professions,
      attributes: CLIENT_WRITTEN.attributes,
      skills: CLIENT_WRITTEN.skills,
    },
  },
  {
    what: "an Assassin/Warrior, decoded identically by a published library",
    source: "https://github.com/build-wars/gw-templates README",
    code: "OwFj0xfzITOMMMHMie4O0kxZ6PA",
    // Published there as professions 7 and 1, attributes {29: 12, 31: 3,
    // 35: 12}, skills [782, 780, 775, 1954, 952, 2356, 1649, 1018]. The
    // attribute ids are spelled by name here because that is what this codec
    // returns; the mapping itself is `heroes.ts`'s claim, tested there.
    decoded: {
      professions: ["A", "W"],
      attributes: { DaggerMastery: 12, ShadowArts: 3, CriticalStrikes: 12 },
      skills: [782, 780, 775, 1954, 952, 2356, 1649, 1018],
    },
  },
  {
    what: "a Mesmer with no secondary, decoded field by field on the wiki",
    source: "https://wiki.guildwars.com/wiki/Talk:Skill_template_format",
    code: "OQBDApwTOhwcgM4mmBaCeAUA",
    // Published there as template type 14, version 0, primary 5, secondary 0,
    // three attributes at ranks 9, 12 and 9, skills [1057, 57, 50, 1335, 25,
    // 77, 30, 40]. A null secondary is the case a decoder most easily turns
    // into profession "W".
    decoded: {
      professions: ["Me", null],
      attributes: { FastCasting: 9, DominationMagic: 12, InspirationMagic: 9 },
      skills: [1057, 57, 50, 1335, 25, 77, 30, 40],
    },
  },
  {
    what: "a real code quoted without a decoding, round-trip only",
    source: "https://wiki.guildwars.com/wiki/Talk:Skill_template_format",
    code: "OwET8YIW1xeMqnJUkv3dteUSAA",
    decoded: {},
  },
  {
    what: "a real code with five invested attributes, round-trip only",
    source: "https://wiki.guildwars.com/wiki/Talk:Skill_template_format",
    code: "OgNFg4uM25HjWtdaY5GyiPyrDkA",
    decoded: {},
  },
];

/**
 * Codes that must decode to `null` without throwing. Where the reason is one of
 * this codec's own (see the header), a valid twin is asserted separately below
 * so the rejection is known to be about the field named here.
 */
const CORPUS: readonly { what: string; code: string }[] = [
  { what: "the empty string", code: "" },
  { what: "a single space", code: " " },
  { what: "a newline", code: "\n" },
  { what: "only whitespace where a code was expected", code: "   \t\n  " },
  // Quoted verbatim from `TeamBuildEncoder.h:30` and the only code-shaped
  // string in either upstream repository. Its header decodes coherently — an
  // A/W with Dagger Mastery — evidence for the profession/attribute mapping.
  // layout, and then the stream runs out 28 bits short of a complete template.
  // A decoder that returns what it managed to read would hand back an A/W with
  // an empty bar and no sign anything was wrong.
  { what: "the truncated fragment quoted in TeamBuildEncoder.h", code: "OwFj0dKEAAAAAAAA" },
  { what: "a valid code with its last character removed", code: "OQAAAAAAAAAAAAA" },
  { what: "a valid code cut off inside the skill section", code: "OwFj0xja0MlZ/3Brhp" },
  { what: "four bits of a header and nothing else", code: "O" },
  // One character changed, in the version field: `w` (48) to `x` (49) sets bit
  // 6, which is version bit 2, so the code claims version 4.
  { what: "a valid code with one character changed", code: "OxFj0xja0MlZ/3Brhp/IgdFBA" },
  // The same surgery at the other end: the last character of the middle-hole vector from `A` to
  // `g` sets bit 143, which is past the 142-bit payload. Padding is zero bits;
  // this is not.
  { what: "a valid code whose trailing padding is not zero", code: "OgNDoMr9M0txKuAAAAAAAABg" },
  { what: "a valid code with a garbage suffix", code: "OQAAAAAAAAAAAAAAZZZZ" },
  { what: "a character outside the alphabet", code: "OQAAAAAAAAAA_AAA" },
  // Standard base64 pads with `=`; this format ends on a character boundary and
  // never does. A `=` is therefore a sign the code went through something
  // that thought it was ordinary base64.
  { what: "an RFC 4648 pad character", code: "OQAAAAAAAAAAAAA=" },
  { what: "whitespace in the middle of an otherwise valid code", code: "OQAAAAA AAAAAAAA" },
  { what: "a non-ASCII character", code: "OQAAAAAAAAAA\u{1F600}AAA" },
  // Field 0 is 15 for the party-loadout/equipment family, which puts `f` at
  // the front instead of `O`. It must fail on the kind rather than decode into
  // rubbish — the two formats share the alphabet, the bit order and the body.
  { what: "a code of a different template type", code: "fQAAAAAAAAAAAAAA" },
  // `attr_count` 13. `SkillTemplate` holds `attribute_ids[12]`, so this
  // is a malformed code and not a large build.
  { what: "an attribute count above the twelve a template holds", code: "OQAt0dAAAAAAAAAAAA" },
  // `attr_count` 12 with a stream that ends after two of them: the count is
  // legal and the entries are not there. This is the overflow that a decoder
  // trusting the count walks straight off the end of.
  { what: "an attribute count the stream cannot pay for", code: "OQAMAAAAAAAAAAAA" },
  // `skill_code` 15, the widest the format can name: eight 23-bit fields need
  // 184 bits that this stream does not have. There is no skill count in the
  // format, so "more skills than exist" is spelled as a width the stream cannot
  // fund.
  { what: "a skill width the stream cannot fund", code: "OQAA8BAAABAAwAAAgAAA" },
  // Attribute id 26, in the unnamed 26-28 gap of the client's own enum.
  { what: "an attribute id in the client's unnamed enum gap", code: "OQAhoVAAAAAAAAAAAA" },
  { what: "an attribute id past the end of the table", code: "OQAh0WAAAAAAAAAAAA" },
  // Rank 13. The 4-bit field can spell 15; the game's cumulative cost table has
  // 13 entries, so 12 is the highest rank a character can buy.
  { what: "an attribute rank above the twelve points can buy", code: "OQAh01AAAAAAAAAAAA" },
  { what: "the same attribute twice", code: "OQAiowKDAAAAAAAAAAA" },
  // Both professions None is how Toolbox itself detects a failed decode.
  { what: "a primary profession of None", code: "OAAAAAAAAAAAAAAA" },
  { what: "a profession id the client has no profession for", code: "OwCAAAAAAAAAAAAA" },
  { what: "a secondary profession id past the ten that exist", code: "OQsAAAAAAAAAAAAA" },
  // The payload is bounded at 502 bits, which is 84 characters. Neither of
  // these may be walked bit by bit before being refused, and neither may throw.
  { what: "an absurdly long run of valid characters", code: "O".repeat(500_000) },
  { what: "a valid code with a megabyte of zero bits after it", code: `OQAAAAAAAAAAAAAA${"A".repeat(1_000_000)}` },
];

const EMPTY_WARRIOR: SkillTemplate = {
  professions: ["W", null],
  skills: [null, null, null, null, null, null, null, null],
  attributes: {},
};

test("every worked example decodes to what the specification says it holds", () => {
  for (const vector of VECTORS) {
    const decoded = decodeSkillTemplate(vector.code);
    assert.ok(decoded, vector.what);
    assert.deepEqual(decoded.professions, vector.professions, vector.what);
    assert.deepEqual(decoded.attributes, vector.attributes, vector.what);
    assert.deepEqual(decoded.skills, vector.skills, vector.what);
  }
});

test("every worked example re-encodes to the byte-identical code", () => {
  for (const vector of VECTORS) {
    const decoded = decodeSkillTemplate(vector.code);
    assert.ok(decoded, vector.what);
    assert.equal(encodeSkillTemplate(decoded), vector.code, vector.what);

    // Attribute order is the code's, not ours. The vectors store 29, 35, 17 and
    // stores 13, 16, 15 — neither is sorted, so the encoder writes the record's
    // key order and the decoder must build the record in stream order. Sorting
    // either side would decode correctly and re-encode to a different string,
    // which is the failure this whole file exists to catch.
    assert.deepEqual(
      Object.keys(decoded.attributes),
      Object.keys(vector.attributes),
      vector.what,
    );
  }
});

test("a template file is the bare code, with nothing wrapped around it", () => {
  // The 24 bytes read out of `app:/Templates/Skills/SAVE.txt`, verbatim. This is
  // the write direction: it is not enough to know the client's encoder agrees
  // with ours, because a projection has to produce a *file* the client will read
  // back, and a file is a code plus whatever frames it.
  //
  // The answer is nothing. No BOM, no trailing newline, no null terminator, no
  // CRLF, no length prefix — every one of which is invisible in a console and
  // would have made the file unreadable to the game. The hex is here rather than
  // the string so a regression cannot pass by comparing text to text.
  const bytes = new Uint8Array([
    0x4f, 0x77, 0x41, 0x55, 0x30, 0x4b, 0x6e, 0x38, 0x51, 0x34, 0x46, 0x67,
    0x4d, 0x6a, 0x72, 0x55, 0x67, 0x74, 0x45, 0x41, 0x33, 0x54, 0x6e, 0x41,
  ]);
  assert.equal(bytes.length, 24, "no framing bytes");
  assert.equal(new TextDecoder().decode(bytes), CLIENT_WRITTEN.code);

  // And the round trip closes: what the client wrote, we reproduce exactly. A
  // projection can therefore write this file and the client will read its own
  // bar back out of it.
  const decoded = decodeSkillTemplate(CLIENT_WRITTEN.code);
  assert.ok(decoded);
  assert.equal(encodeSkillTemplate(decoded), CLIENT_WRITTEN.code);
});

test("a real code decodes to what its publisher says it holds", () => {
  for (const { what, code, decoded } of CONFORMANCE) {
    const got = decodeSkillTemplate(code);
    assert.ok(got, what);
    if (decoded.professions) {
      assert.deepEqual(got.professions, decoded.professions, what);
    }
    if (decoded.attributes) {
      assert.deepEqual(got.attributes, decoded.attributes, what);
    }
    if (decoded.skills) assert.deepEqual(got.skills, decoded.skills, what);
  }
});

test("a real code re-encodes to the byte-identical string the client wrote", () => {
  // This is the padding assertion, and the reason the encoder pads to a
  // byte. Two of the four are unchanged by that rule and two are not, so a
  // regression to six-bit padding fails here and nowhere else in this file.
  for (const { what, code } of CONFORMANCE) {
    const got = decodeSkillTemplate(code);
    assert.ok(got, what);
    assert.equal(encodeSkillTemplate(got), code, what);
  }
});

test("the short padding a stranger's tool may write still decodes", () => {
  // The client pads to a whole byte, and `CONFORMANCE` below is
  // the evidence. But a code one `A` shorter carries the same payload followed
  // by the same zero bits, and third-party build sites do emit it. Reading it is
  // free; writing it is not, so the decoder accepts both and the encoder
  // normalises to the one the client writes.
  for (const vector of VECTORS) {
    if (vector.sixBitPadded === null) continue;
    const canonical = decodeSkillTemplate(vector.code);
    const short = decodeSkillTemplate(vector.sixBitPadded);
    assert.ok(canonical && short, vector.what);
    assert.deepEqual(short, canonical, vector.what);

    assert.equal(vector.sixBitPadded.length, vector.code.length - 1, vector.what);
    assert.equal(encodeSkillTemplate(short), vector.code, vector.what);
  }
});

test("nothing in the adversarial corpus throws, and all of it is null", () => {
  for (const { what, code } of CORPUS) {
    // Both halves, deliberately. A decoder that threw would also never return a
    // non-null value, so asserting only `=== null` would pass on a decoder that
    // crashes the renderer on every bad paste.
    assert.doesNotThrow(() => decodeSkillTemplate(code), what);
    assert.equal(decodeSkillTemplate(code), null, what);
  }
});

test("each of this codec's own rejections has a valid twin one field away", () => {
  // Every pair below differs in exactly the field named. Without them the
  // corpus above would pass just as well against a decoder that returns null
  // for everything.
  const twins: readonly { what: string; rejected: string; accepted: string }[] = [
    // Attribute id 26 (the enum's unnamed gap) against 25, Marksmanship.
    { what: "an attribute id", rejected: "OQAhoVAAAAAAAAAAAA", accepted: "OQAhkVAAAAAAAAAAAA" },
    // Rank 13 against rank 12, on the same Dagger Mastery entry.
    { what: "an attribute rank", rejected: "OQAh01AAAAAAAAAAAA", accepted: "OQAh0xAAAAAAAAAAAA" },
    // Secondary profession 11 against 10, Dervish — the last one that exists.
    { what: "a secondary profession id", rejected: "OQsAAAAAAAAAAAAA", accepted: "OQoAAAAAAAAAAAAA" },
    // Trailing bits: non-zero against the required zero padding.
    { what: "trailing padding", rejected: "OQAAAAAAAAAAAAAAZZZZ", accepted: "OQAAAAAAAAAAAAAAAAAA" },
  ];
  for (const { what, rejected, accepted } of twins) {
    assert.equal(decodeSkillTemplate(rejected), null, what);
    assert.ok(decodeSkillTemplate(accepted), what);
  }

  assert.deepEqual(decodeSkillTemplate("OQAhkVAAAAAAAAAAAA")?.attributes, {
    Marksmanship: 5,
  });
  assert.deepEqual(decodeSkillTemplate("OQAh0xAAAAAAAAAAAA")?.attributes, {
    DaggerMastery: 12,
  });
  assert.deepEqual(decodeSkillTemplate("OQoAAAAAAAAAAAAA")?.professions, [
    "W",
    "D",
  ]);
});

test("an empty slot round-trips as an empty slot and never as skill 0", () => {
  // The distinction the record makes: `null` is "no skill here", and `skillId(0)`
  // would be a build carrying the `No_Skill` sentinel as if it were a skill.
  // They encode to the same eight bits, so only the decoder can keep them apart.
  const empty = decodeSkillTemplate("OQAAAAAAAAAAAAAA");
  assert.ok(empty);
  assert.deepEqual(empty.skills, [null, null, null, null, null, null, null, null]);
  for (const slot of empty.skills) {
    assert.equal(slot, null);
    assert.notEqual(slot, skillId(0));
  }

  // The holes are in the middle, which is the case a decoder that stops at
  // the first zero gets wrong: it would return three skills and lose the
  // resurrection signet in slot 8.
  const holes = decodeSkillTemplate("OgNDoMr9M0txKuAAAAAAAABA");
  assert.ok(holes);
  assert.deepEqual(holes.skills.slice(3, 7), [null, null, null, null]);
  assert.equal(holes.skills[7], 2);

  // And back out: an empty slot is written at full width like any other id
  // so an empty bar is a full-length code and not a short one.
  assert.equal(encodeSkillTemplate(EMPTY_WARRIOR), "OQAAAAAAAAAAAAAA");
  assert.equal(
    encodeSkillTemplate({
      ...EMPTY_WARRIOR,
      skills: [skillId(884), null, null, null, null, null, null, skillId(2)],
    }),
    encodeSkillTemplate({
      ...EMPTY_WARRIOR,
      skills: [skillId(884), skillId(0), skillId(0), skillId(0), skillId(0), skillId(0), skillId(0), skillId(2)],
    }),
  );
});

test("a skill id this client build has never heard of decodes rather than fails", () => {
  // An unknown *skill* id can be a skill from a newer client,
  // so it decodes and carries its number for the UI to render as `#3512`.
  // Unknown profession and attribute ids are the opposite call — the record has
  // closed unions for those and no value to put in them — which is why the
  // corpus rejects those and this test accepts this.
  const decoded = decodeSkillTemplate("OQAAQ42AAAAAAAAAAAAAA");
  assert.ok(decoded);
  assert.equal(decoded.skills[0], 3512);
  // Re-encoding adds the trailing `A` this hand-written input lacks: the input
  // is the six-bit form, and the encoder writes the client's byte-padded one.
  assert.equal(encodeSkillTemplate(decoded), "OQAAQ42AAAAAAAAAAAAAAA");
});

test("a code the client would not have written re-encodes to the one it would", () => {
  // Round-tripping is byte-identity for codes in the format's canonical form,
  // and canonicalisation for the rest. Two ways a code can be decodable and
  // non-canonical, both of them consequences of the width rules read backwards:
  //
  //   - a field wider than the values in it need. `OQAh0x…` spends 6 bits on
  //     Dagger Mastery, whose id is 29 and fits in 5. It decodes; it is not
  //     what the client writes; choosing a larger width
  //     still produces a decodable code — which is exactly why the encoder
  //     cannot simply echo the width it was handed.
  //   - a rank-0 attribute, which the format can carry and no observed code
  //     does. The decoder reports what the code says instead of silently
  //     editing it, and the encoder omits it. That is the one asymmetry in this
  //     codec, and it produces a shorter code for the same build rather than a
  //     different build.
  const CANONICAL = "OQAR0ZAAAAAAAAAAAA";

  const wide = decodeSkillTemplate("OQAh0xAAAAAAAAAAAA");
  assert.ok(wide);
  assert.deepEqual(wide.attributes, { DaggerMastery: 12 });
  assert.equal(encodeSkillTemplate(wide), CANONICAL);

  const withZero = decodeSkillTemplate("OQAi0xKAAAAAAAAAAAA");
  assert.ok(withZero);
  assert.deepEqual(withZero.attributes, { DaggerMastery: 12, FireMagic: 0 });
  assert.equal(encodeSkillTemplate(withZero), CANONICAL);

  // Canonicalisation is idempotent: the second pass changes nothing, and the
  // build it describes is the same one.
  const canonical = decodeSkillTemplate(CANONICAL);
  assert.ok(canonical);
  assert.deepEqual(canonical.attributes, { DaggerMastery: 12 });
  assert.equal(encodeSkillTemplate(canonical), CANONICAL);
});

test("the encoder refuses what the format cannot spell rather than truncating it", () => {
  // These are the states the types cannot exclude, because a library file read
  // off disk is `unknown` until something validates it. Each would otherwise be
  // written with its high bits silently cut off, producing a code that decodes
  // to a different build.
  const twentyThreeBits = (1 << 23) - 1;
  const bar = (id: number): SkillTemplate["skills"] => [
    skillId(id),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];

  assert.ok(encodeSkillTemplate({ ...EMPTY_WARRIOR, skills: bar(twentyThreeBits) }));
  assert.equal(
    encodeSkillTemplate({ ...EMPTY_WARRIOR, skills: bar(twentyThreeBits + 1) }),
    null,
  );
  assert.equal(encodeSkillTemplate({ ...EMPTY_WARRIOR, skills: bar(-1) }), null);
  assert.equal(encodeSkillTemplate({ ...EMPTY_WARRIOR, skills: bar(1.5) }), null);

  // Built through `fromEntries` rather than written as an object literal: the
  // point of each case is a record the closed types forbid, and a literal that
  // TypeScript refuses to even assert about proves nothing at run time.
  const ranks = (names: readonly string[], rank = 1) =>
    Object.fromEntries(
      names.map((name) => [name, rank]),
    ) as SkillTemplate["attributes"];
  const twelve = [
    "FastCasting",
    "IllusionMagic",
    "DominationMagic",
    "InspirationMagic",
    "BloodMagic",
    "DeathMagic",
    "SoulReaping",
    "Curses",
    "AirMagic",
    "EarthMagic",
    "FireMagic",
    "WaterMagic",
  ];
  // Twelve is the cap the stored template holds, and thirteen is not a large
  // build; it is a record the format has no count for.
  assert.ok(encodeSkillTemplate({ ...EMPTY_WARRIOR, attributes: ranks(twelve) }));
  assert.equal(
    encodeSkillTemplate({
      ...EMPTY_WARRIOR,
      attributes: ranks([...twelve, "EnergyStorage"]),
    }),
    null,
  );

  // A name and a rank the closed types forbid but a JSON file can hold.
  assert.equal(
    encodeSkillTemplate({ ...EMPTY_WARRIOR, attributes: ranks(["Bogus"]) }),
    null,
  );
  assert.equal(
    encodeSkillTemplate({ ...EMPTY_WARRIOR, attributes: ranks(["FireMagic"], 13) }),
    null,
  );
  assert.equal(
    encodeSkillTemplate({
      ...EMPTY_WARRIOR,
      professions: ["X" as SkillTemplate["professions"][0], null],
    }),
    null,
  );
});

test("a rank that is not a whole number is refused, not rounded into the field", () => {
  // The range test alone let three shapes through, and each one encoded to a
  // *different build* than the record described rather than to nothing:
  //
  //   - 3.5 was written by `value >>> index`, which applies ToUint32, so it
  //     came back as rank 3;
  //   - `NaN` is neither `< 0` nor `> 12`, so it passed the range test, is not
  //     caught by the rank-0 skip, and wrote eight zero bits — a rank-0 entry
  //     that decodes as 0 and vanishes on the next re-encode;
  //   - `"5"` compares as 5 against both bounds and was written as 5.
  //
  // A rank off disk is a JSON value, so all three are inputs this function
  // exists to refuse. The skill ids beside them have been integer-checked since
  // the start; this is the same test on the other field.
  const rank = (value: unknown): SkillTemplate["attributes"] =>
    ({ FireMagic: value }) as SkillTemplate["attributes"];

  for (const value of [3.5, Number.NaN, "5", null, Infinity, -0.5]) {
    assert.equal(
      encodeSkillTemplate({ ...EMPTY_WARRIOR, attributes: rank(value) }),
      null,
      String(value),
    );
  }

  // The whole ranks either side of the refusals still encode.
  for (const value of [3, 12]) {
    assert.ok(
      encodeSkillTemplate({ ...EMPTY_WARRIOR, attributes: rank(value) }),
      String(value),
    );
  }
});

test("a bar that is not eight slots long is refused rather than padded or cut", () => {
  // `SkillBar` is eight and the stream has one field per slot with no count, so
  // there is no other length to write. Both failures were silent: nine slots
  // encoded to a code whose first eight fields read as an ordinary build, and
  // seven encoded to a string `decodeSkillTemplate` then refused — an encoder
  // reporting success for a code nothing can read.
  const eight = [1, 2, 3, 4, 5, 6, 7, 8].map(skillId);
  const asBar = (ids: readonly (number | null)[]): SkillTemplate["skills"] =>
    ids as unknown as SkillTemplate["skills"];

  const canonical = encodeSkillTemplate({
    ...EMPTY_WARRIOR,
    skills: asBar(eight),
  });
  assert.ok(canonical);

  for (const length of [0, 7, 9]) {
    const ids = Array.from({ length }, (_, slot) => eight[slot] ?? skillId(9));
    assert.equal(
      encodeSkillTemplate({ ...EMPTY_WARRIOR, skills: asBar(ids) }),
      null,
      `${length} slots`,
    );
  }
});

test("a twelve-attribute template still round-trips, at the edge of the count", () => {
  // The count field is 4 bits and the cap is 12, so this is the largest
  // attribute section that exists. It is also the longest code this codec can
  // produce with narrow skills, which is where an off-by-one in the width
  // arithmetic would show.
  const code = encodeSkillTemplate({
    ...EMPTY_WARRIOR,
    attributes: {
      FastCasting: 1,
      IllusionMagic: 2,
      DominationMagic: 3,
      InspirationMagic: 4,
      BloodMagic: 5,
      DeathMagic: 6,
      SoulReaping: 7,
      Curses: 8,
      AirMagic: 9,
      EarthMagic: 10,
      FireMagic: 11,
      WaterMagic: 12,
    },
  });
  assert.ok(code);
  const decoded = decodeSkillTemplate(code);
  assert.ok(decoded);
  assert.equal(Object.keys(decoded.attributes).length, 12);
  assert.equal(encodeSkillTemplate(decoded), code);
});
