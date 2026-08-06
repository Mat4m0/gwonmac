/**
 * The Guild Wars skill template codec: the `OwFj0…` string a player pastes into
 * chat or saves under `Templates/Skills`, decoded into the three fields of a
 * stored build that a template actually carries, and encoded back.
 *
 * The layout is `plans/tools/hero-builds/evidence/skill-template-codec.md`, and
 * that document is honest about what it is: the authoritative encoder was never
 * read (GWCA ships as a compiled DLL), so the bit layout is reconstructed from
 * GWToolbox's party-loadout encoder, which shares the alphabet, the bit order
 * and the per-entry body. Section numbers below refer to that document. Two
 * consequences worth carrying in your head while reading this file:
 *
 * - Every DERIVED vector in §8 is a regression vector, not a conformance one.
 * They prove this codec agrees with that document; nothing here has been
 * accepted by a Guild Wars client. §10 items 1 and 2 are what would change
 * that, and both need the hosted client.
 * - §6 is genuinely open: the client may or may not round the payload up to a
 * whole byte before base64. The two rules differ by at most one trailing
 * `A`. This encoder implements the 6-bit rule (§6's recommendation) and the
 * decoder accepts both, so a disagreement stays cosmetic.
 *
 * The bit order is the part that breaks naive implementations, so it is stated
 * once here rather than rediscovered at each field. The alphabet is standard
 * RFC 4648, but character *n* contributes bits `6n…6n+5` **least significant
 * bit first**, and a field of width `w` at offset `o` is `Σ bits[o+i] << i`.
 * There is no byte in the format at all; feeding a code to a stock base64
 * decoder produces noise that still looks like data.
 *
 * ## What this decoder refuses, and why it is stricter than §5.1
 *
 * `decodeSkillTemplate` is total: it returns `null` for everything it cannot
 * fully decode and never throws, because its input is a string a stranger
 * pasted into Discord. It never returns a partially-filled template — §7.2
 * records that GWCA leaves the caller's struct indeterminate on failure, and
 * that is exactly the shape a caller misreads as success.
 *
 * Beyond §7.1's confirmed rejections (empty, truncated, wrong kind, wrong
 * version, attribute count above 12, character outside the alphabet) this file
 * refuses four more things. Three of them are forced by the record the result
 * has to fit in — a template that cannot become a `Build` is not a template we
 * can honour, and pretending otherwise only moves the failure somewhere with
 * less context:
 *
 * 1. A profession or attribute id the client has no name for (the 26-28 gap
 * included). `Profession` and `Attribute` are closed unions in
 * `library.ts`; there is no value to put in the record, and `heroes.ts`
 * owns which numbers name which member of them. Note the contrast with
 * *skill* ids, which stay bare numbers precisely so §7.3 holds: a skill
 * from a newer client decodes, carries its number, and renders as `#3512`
 * rather than sinking the whole paste.
 * 2. An attribute rank above 12, which `AttributeRank` cannot hold (the
 * game's cumulative cost table has 13 entries). The 4-bit field can spell
 * 15; a character cannot buy it.
 * 3. The same attribute twice. A record has one rank per attribute, so the
 * second entry would silently overwrite the first and the code would not
 * round-trip.
 * 4. Trailing bits that are not zero. §5.1 says to ignore everything after
 * the eighth skill, but it says so only because §6's padding rule is
 * unsettled — and the *whole* disagreement between those two rules is
 * trailing zero bits. Accepting non-zero trailing bits would make an
 * unbounded family of strings decode to one build, none of which
 * `encodeSkillTemplate` would ever produce, so `decode` would stop being
 * the inverse of `encode` for no gain. Zero bits are accepted at any
 * length up to §5.1's 84-character maximum, which is what keeps both
 * padding rules valid.
 *
 * Application-level rules stay out of here, per §7.3: whether the player's
 * character has the right profession, whether the skills are unlocked, whether
 * two elites are on one bar. A valid code describing an illegal build is a
 * valid code.
 *
 * ## Why the head and the body are separate functions
 *
 * A party loadout carries the same body under an 8-bit hero id instead of the
 * 8-bit `kind`/`version` head (§9), so `party-loadout.ts` needs the body and not
 * the code. It gets `encodeTemplateBody`/`decodeTemplateBody`, which are the
 * same two functions this file's own codec runs on rather than a second path
 * beside them. The alternative — handing that file a string and letting it find
 * where a body ends — makes it a second reader of §5.2's width rules, and the
 * two would disagree the first time a width moved.
 */

import type {
  AttributeRank,
  AttributeRanks,
  Build,
  Profession,
  SkillBar,
} from "./library.js";
import { SKILL_SLOTS, skillId } from "./library.js";
import {
  ATTRIBUTE_BY_ID,
  PROFESSION_BY_ID,
  PROFESSION_NONE_ID,
} from "./heroes.js";

/**
 * What a skill template carries: exactly the three fields of a stored build
 * that the code itself describes. Everything else on a `Build` — its id, name,
 * tags, lineage — is the library's, not the code's, so a decoded template is a
 * `Pick` rather than a second shape that could drift from `Build`.
 */
export type SkillTemplate = Pick<
  Build,
  "professions" | "skills" | "attributes"
>;

/** RFC 4648, standard order. Read LSB-first; see the header. (§2) */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Field 0. 15 is the party-loadout/equipment family, and must not decode here. (§3, §9) */
const SKILL_TEMPLATE_KIND = 14;

/** Field 1. The only version ArenaNet has ever written. (§3) */
const SKILL_TEMPLATE_VERSION = 0;

/** The two nibbles above, which are exactly what a party member replaces with a hero id (§9). */
const HEAD_BITS = 8;

/** `SkillID::No_Skill`. An empty slot is this id at full width, not a short stream. (§3.2) */
const NO_SKILL = 0;

/** `SkillTemplate` holds `attribute_ids[12]`; a larger count is malformed. (§3.2) */
const MAX_ATTRIBUTES = 12;

/** The highest rank attribute points can buy, and all `AttributeRank` admits. (§4.2) */
const MAX_RANK = 12;

/** `skill_code` is 4 bits, so the widest skill field is 23 bits. (§3) */
const MAX_SKILL_ID = (1 << 23) - 1;

/**
 * §5.1's bound made a rule: the largest possible payload is 502 bits, which is
 * 84 characters. Nothing longer can be a template, so a megabyte of `A`s is
 * refused by length rather than by patiently proving every bit of it is
 * padding.
 */
const MAX_CODE_LENGTH = 84;

/**
 * The wire id of a profession or an attribute, or `null` for a string no
 * profession or attribute carries.
 *
 * `heroes.ts` transcribes both enums and exports them id-first, which is the
 * direction a decoder reads. These two scans are the other direction, and they
 * are scans rather than a second table on purpose: a template invests in at
 * most twelve attributes, so the whole cost is twelve passes over 42 entries,
 * and the alternative is a reversed copy of the numbers this file must not
 * hold a second opinion about. A name the client has none of — including the
 * `None` profession, which `heroes.ts` deliberately gives no row — is simply
 * not found, which is the answer both callers already want.
 *
 * The argument is `string` rather than the union because both callers have one:
 * a library file read off disk is a promise nobody kept, so `"Bogus"` and
 * `"X"` reach here and must be refused rather than trusted for being typed.
 */
const professionIdOf = (name: string): number | null => {
  for (const [id, candidate] of PROFESSION_BY_ID) {
    if (candidate === name) return id;
  }
  return null;
};

const attributeIdOf = (name: string): number | null => {
  for (const [id, candidate] of ATTRIBUTE_BY_ID) {
    if (candidate === name) return id;
  }
  return null;
};

/** The eight slots, writable while decoding fills them. Derived so it cannot drift from `SkillBar`. */
type MutableSkillBar = { -readonly [Slot in keyof SkillBar]: SkillBar[Slot] };

/** Ranks while decoding. Homomorphic, so the keys stay optional exactly as `AttributeRanks` has them. */
type MutableAttributeRanks = {
  -readonly [Name in keyof AttributeRanks]: AttributeRanks[Name];
};

/** Bits needed to spell `value`; 0 for 0, which is what the width rules want. */
function bitsNeeded(value: number): number {
  return 32 - Math.clz32(value);
}

/**
 * The narrowest of §5.2's four profession widths that holds both ids. Ids stop
 * at 10 today, so this is always 4 — the rule is written out rather than the
 * constant, so a wider id would widen the field instead of being truncated.
 */
function professionWidthFor(largest: number): number | null {
  for (const width of [4, 6, 8, 10]) {
    if (largest < 1 << width) return width;
  }
  return null;
}

/** The one place a number becomes an `AttributeRank`, guarded by the range that makes it one. */
function attributeRankOf(value: number): AttributeRank | null {
  if (value < 0 || value > MAX_RANK) return null;
  return value as AttributeRank;
}

/**
 * A code as bits, LSB of each character first, or `null` for a character
 * outside the alphabet. A `=`, a space, or anything else rejects the whole
 * string: §7.1 R6 notes that Toolbox truncates instead, and silently decoding
 * the prefix of a corrupted paste is worse than refusing it.
 */
export function bitsOf(code: string): number[] | null {
  const bits: number[] = [];
  for (const character of code) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) return null;
    for (let index = 0; index < 6; index++) bits.push((value >> index) & 1);
  }
  return bits;
}

/** The `width` bits at `at`, LSB-first, or `null` if the stream ends first. */
export function readAt(
  bits: readonly number[],
  at: number,
  width: number,
): number | null {
  if (at + width > bits.length) return null;
  let value = 0;
  for (let index = 0; index < width; index++) {
    if (bits[at + index] === 1) value |= 1 << index;
  }
  return value;
}

/** Bits back to characters, zero-padded to the next character boundary (§6). */
export function charsOf(bits: readonly number[]): string {
  let code = "";
  for (let start = 0; start < bits.length; start += 6) {
    let value = 0;
    for (let index = 0; index < 6; index++) {
      if (bits[start + index] === 1) value |= 1 << index;
    }
    code += ALPHABET.charAt(value);
  }
  return code;
}

/** Append `value` as `width` bits, LSB-first. */
export function writeBits(bits: number[], value: number, width: number): void {
  for (let index = 0; index < width; index++) {
    bits.push((value >>> index) & 1);
  }
}

/** What `decodeTemplateBody` answers: the template, and how far the body reached. */
export interface DecodedTemplateBody {
  readonly template: SkillTemplate;
  /**
   * The body's width in bits. A party loadout packs members with no alignment
   * between them, so its decoder needs the end of one body to find the next.
   */
  readonly length: number;
}

/**
 * Decode the body — everything after the 8-bit head — of a skill template
 * starting at `offset`. Returns `null` for anything it cannot fully decode; see
 * the header for what "valid" refuses beyond §7.1.
 *
 * Exported because a party loadout embeds this exact bit range under a hero id
 * instead of the head (§9). It is a bit range and not a string, so the boundary
 * between the two files is drawn there: a caller that had to re-measure the
 * body would be a second reader of §5.2's width rules, and two readers of one
 * layout is how the two files come to disagree about it.
 */
export function decodeTemplateBody(
  bits: readonly number[],
  offset: number,
): DecodedTemplateBody | null {
  let at = offset;
  /** The next `width` bits, LSB-first, or `null` if the stream ends first. */
  const read = (width: number): number | null => {
    if (at + width > bits.length) return null;
    let value = 0;
    for (let index = 0; index < width; index++) {
      if (bits[at + index] === 1) value |= 1 << index;
    }
    at += width;
    return value;
  };

  const professionCode = read(2);
  if (professionCode === null) return null;
  const professionWidth = professionCode * 2 + 4;
  const primaryId = read(professionWidth);
  const secondaryId = read(professionWidth);
  if (primaryId === null || secondaryId === null) return null;

  // `None` and "an id this client has no profession for" are the same answer
  // for a primary: there is no such character, so there is no such build (§7.2).
  // `PROFESSION_BY_ID` holds 1-10 and deliberately has no row for `None`, so
  // both cases are one miss.
  const primary = PROFESSION_BY_ID.get(primaryId) ?? null;
  if (primary === null) return null;
  // A secondary of `None` is an ordinary monoclass build, so 0 is separated
  // from an unknown id here rather than collapsed into it.
  let secondary: Profession | null = null;
  if (secondaryId !== PROFESSION_NONE_ID) {
    secondary = PROFESSION_BY_ID.get(secondaryId) ?? null;
    if (secondary === null) return null;
  }

  const attributeCount = read(4);
  if (attributeCount === null || attributeCount > MAX_ATTRIBUTES) return null;
  // Unconditional: the width code is written even when the count is 0 (§8.3).
  const attributeCode = read(4);
  if (attributeCode === null) return null;
  const attributeWidth = attributeCode + 4;

  const attributes: MutableAttributeRanks = {};
  for (let entry = 0; entry < attributeCount; entry++) {
    const id = read(attributeWidth);
    if (id === null) return null;
    // The enum's unnamed 26-28 gap has no row in `heroes.ts` either, so a code
    // naming one is a miss here rather than something to interpret.
    const name = ATTRIBUTE_BY_ID.get(id) ?? null;
    if (name === null) return null;
    // One rank per attribute: a repeat would overwrite, and a record that
    // silently lost a field would not round-trip.
    if (name in attributes) return null;
    const raw = read(4);
    if (raw === null) return null;
    const rank = attributeRankOf(raw);
    if (rank === null) return null;
    // Rank 0 is kept rather than dropped (§5.2): the decoder reports what the
    // code says. `encodeSkillTemplate` is the half that canonicalises, and it
    // omits rank-0 entries, so such a code re-encodes shorter than it arrived.
    attributes[name] = rank;
  }

  const skillCode = read(4);
  if (skillCode === null) return null;
  const skillWidth = skillCode + 8;
  const skills: MutableSkillBar = [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];
  for (const slot of SKILL_SLOTS) {
    const id = read(skillWidth);
    if (id === null) return null;
    // A hole in the middle of the bar is legal and common (§8.5), so this
    // cannot stop at the first zero — it would drop the resurrection signet in
    // slot 8. `No_Skill` becomes `null`, which is the record's one spelling for
    // an empty slot.
    skills[slot] = id === NO_SKILL ? null : skillId(id);
  }

  return {
    template: { professions: [primary, secondary], skills, attributes },
    length: at - offset,
  };
}

/**
 * Decode a skill template code. Returns `null` — never a partial template, and
 * never a thrown exception — for anything that is not a complete, valid code.
 * See the header for what "valid" refuses beyond §7.1.
 */
export function decodeSkillTemplate(code: string): SkillTemplate | null {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return null;
  const bits = bitsOf(code);
  if (bits === null) return null;

  if (readAt(bits, 0, 4) !== SKILL_TEMPLATE_KIND) return null;
  if (readAt(bits, 4, 4) !== SKILL_TEMPLATE_VERSION) return null;

  const body = decodeTemplateBody(bits, HEAD_BITS);
  if (body === null) return null;

  // Everything after the payload is padding, and padding is zero. See the
  // header: this is what keeps §6's two rules both acceptable while still
  // refusing a valid code with junk stapled to the end.
  for (let at = HEAD_BITS + body.length; at < bits.length; at++) {
    if (bits[at] !== 0) return null;
  }

  return body.template;
}

/**
 * Encode the body of a template — everything after the 8-bit head — as bits.
 * Returns `null` for the classes of input the types cannot exclude: a bar that
 * is not eight slots long, a skill id outside the 23 bits the format can spell,
 * a rank that is not a whole number in 0-12, a record carrying more than twelve
 * invested attributes, or a name that is not one the client knows — all of
 * which a library file loaded from disk can hold even though a well-typed
 * caller cannot construct one.
 *
 * Widths are minimal (§5.2), and deliberately not the ones Toolbox's own writer
 * emits: §5.3 records that it never writes `attr_code = 1` and never writes a
 * `skill_code` above 1, which cannot express any skill id past 511. Copying it
 * would produce decodable codes that are not the codes the client would write,
 * which is the whole round-trip.
 *
 * Exported for the same reason `decodeTemplateBody` is: a party member is this
 * bit range behind a hero id, and going through a code string would mean
 * measuring the body a second time somewhere else.
 */
export function encodeTemplateBody(template: SkillTemplate): number[] | null {
  const [primaryName, secondaryName] = template.professions;
  const primaryId = professionIdOf(primaryName);
  const secondaryId =
    secondaryName === null ? PROFESSION_NONE_ID : professionIdOf(secondaryName);
  if (primaryId === null || secondaryId === null) return null;
  const professionWidth = professionWidthFor(Math.max(primaryId, secondaryId));
  if (professionWidth === null) return null;

  // Insertion order, which is the order the decoder read them in: §8.2 and §8.4
  // are both unsorted, so the sequence is the code's and not ours to normalise.
  // Attribute names are non-numeric string keys, so JavaScript preserves it.
  const invested: { id: number; rank: number }[] = [];
  for (const [name, rank] of Object.entries(template.attributes)) {
    // §5.2: rank 0 is representable and no observed code spends `a + 4` bits on
    // it. An absent attribute and a rank-0 attribute are the same build.
    if (rank === undefined || rank === 0) continue;
    // The integer test is not decoration. `write` below is `value >>> index`,
    // which applies ToUint32: 3.5 would be written as 3 and `NaN` — which
    // passes both comparisons, being neither `< 0` nor `> 12` — as 0, so a
    // record off disk would encode successfully into a *different* build. The
    // skill ids below have carried this test since the start; ranks had only
    // the range half of it.
    if (!Number.isInteger(rank) || rank < 0 || rank > MAX_RANK) return null;
    const id = attributeIdOf(name);
    if (id === null) return null;
    invested.push({ id, rank });
  }
  if (invested.length > MAX_ATTRIBUTES) return null;
  const attributeWidth = Math.max(
    4,
    ...invested.map((attribute) => bitsNeeded(attribute.id)),
  );

  // The stream has one field per slot and no count, so a bar of any other
  // length has no spelling at all. Without this the ninth slot of a nine-slot
  // record is simply dropped — silently in a party loadout, where the body is
  // measured rather than re-read — and a seven-slot record writes a body no
  // decoder accepts while still being reported as a successful encode.
  if (template.skills.length !== SKILL_SLOTS.length) return null;
  const skillIds = template.skills.map((slot) => slot ?? NO_SKILL);
  for (const id of skillIds) {
    if (!Number.isInteger(id) || id < 0 || id > MAX_SKILL_ID) return null;
  }
  const skillWidth = Math.max(8, ...skillIds.map(bitsNeeded));

  const bits: number[] = [];
  const write = (value: number, width: number): void =>
    writeBits(bits, value, width);

  write((professionWidth - 4) / 2, 2);
  write(primaryId, professionWidth);
  write(secondaryId, professionWidth);
  write(invested.length, 4);
  write(attributeWidth - 4, 4);
  for (const attribute of invested) {
    write(attribute.id, attributeWidth);
    write(attribute.rank, 4);
  }
  write(skillWidth - 8, 4);
  for (const id of skillIds) write(id, skillWidth);

  return bits;
}

/**
 * Encode a template (or any `Build`) back to a code, or `null` for anything
 * `encodeTemplateBody` refuses.
 *
 * §6 is no longer open. ArenaNet's own wiki specifies the two rules this
 * function ends with, and four real codes confirm them:
 *
 *   - a mandatory trailing bit — "1 Bit - Always zero, non-optional" — which
 *     our reconstruction from Toolbox's party-loadout encoder never had,
 *     because that format has no such tail;
 *   - padding to a whole byte before base64, not to the next six-bit group.
 *
 * The two rules are not independently observable: they differ from the naive
 * six-bit rule only together, and only on some codes. Both were settled by
 * re-encoding the four vectors in
 * `tests/unit/a-skill-template-code-survives-a-round-trip.test.ts` — two of
 * them come out one `A` short under the six-bit rule and byte-identical under
 * this one. Toolbox's `vector<uint8_t>` rounding, which looked like an
 * implementation artifact, is the real format.
 *
 * @see https://wiki.guildwars.com/wiki/Skill_template_format
 */
export function encodeSkillTemplate(template: SkillTemplate): string | null {
  const body = encodeTemplateBody(template);
  if (body === null) return null;

  const head: number[] = [];
  writeBits(head, SKILL_TEMPLATE_KIND, 4);
  writeBits(head, SKILL_TEMPLATE_VERSION, 4);

  const bits = [...head, ...body, 0];
  while (bits.length % 8 !== 0) bits.push(0);
  return charsOf(bits);
}
