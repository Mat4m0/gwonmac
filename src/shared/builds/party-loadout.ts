/**
 * The party-loadout code: the `f…` string whose first byte is `0x1F`, carrying
 * a whole party — a hero id and a skill bar per member — in one base64 code.
 * GWToolbox calls it a *Daybreak team build*. The layout is
 * `plans/tools/hero-builds/evidence/party-loadout-codec.md`, and section
 * numbers below refer to that document.
 *
 * ## Nothing calls this yet, and that is deliberate
 *
 * There is no production caller — only the suite beside it. That is a decision,
 * not an oversight, so a later reader does not delete it as dead code or wire
 * it up as though it were finished: the codec is complete and proven against
 * the layout document, and what is missing is a counterparty, which no amount
 * of reading C++ can supply. It stays uncalled until `primitives.md` §6.1 (does
 * the client import one?) or §6.2 (can it export one?) is answered in a live
 * session. If both come back no, delete this file rather than finding it a use.
 *
 * ## Read this before putting the codec in front of a player
 *
 * The bit layout is settled: §1.3 cites a working encoder and decoder line by
 * line, and every field below names the line it came from. What is **not**
 * settled is whether anything outside this repository speaks the format.
 * §"WHAT THIS DECIDES" is blunt about it — the only claim that the game itself
 * produces and consumes these codes is one comment whose own worked example
 * fails its own decoder, nothing in GWToolbox ever writes one, nothing ever
 * reads one from the client, and the name "Daybreak" refers elsewhere in that
 * tree to a third-party launcher rather than to anything ArenaNet ships.
 *
 * So this file implements a format with one known implementation and no proven
 * counterparty. `primitives.md` §6.1 (does the client import one?) and §6.2
 * (can it export one?) are each a single live session and neither can be
 * answered by reading more C++. Until one of them is recorded, a code produced
 * here is a code only we can read: fine as our own transport, and not something
 * to describe to a player as "your party loadout, importable in game".
 * §1.7 derives the cheapest probe there is — the empty party, `fAA` under
 * Toolbox's padding rule and `fA` under this one (see §1.6 below); both decode
 * here, and `encodePartyLoadout([])` writes the shorter.
 *
 * ## There is no version field
 *
 * `primitives.md` §A3 and the commit that introduced the codec both describe
 * "header 15, type 1, version 1" — three fields for two nibbles. The
 * implementation writes exactly two (`TeamBuildEncoder.cpp:642-643`) and checks
 * exactly two (`:696-697`). The third nibble is the member count. A decoder
 * written from the prose would read a party of one as a valid version and then
 * mis-align every member after it, which is why this is stated here rather than
 * left as a footnote.
 *
 * ## What a party loadout carries, and what it silently drops
 *
 * Per member: a hero id and a skill bar (professions, invested attributes,
 * eight skill ids). That is all (§1.4). Behaviour, the pinned skill panel, the
 * disabled-skill mask, every name, the team's tags and its mode are **not in
 * the format** — the encoder touches two fields of its input and the decoder
 * sets two (`TeamBuildEncoder.cpp:646-650`, `:726-730`). Toolbox scrapes
 * behaviour and the disabled mask from the live game and persists them to its
 * own JSON precisely because a code cannot hold them. A round trip through this
 * module is therefore lossy by construction, and the test beside it asserts
 * exactly which fields survive rather than pretending the loss is a bug.
 *
 * ## Empty party positions
 *
 * The format has no spelling for "nobody here": a member is a hero id followed
 * by a bar, and there is no presence bit anywhere in the stream. Toolbox's own
 * Daybreak encoder therefore *aborts* on an empty member — its capture path
 * always pushes eight entries and the first default-constructed one sinks the
 * whole code (§1.5), so a captured party of four heroes cannot be encoded at
 * all. §1.5 names that as the first bug not to reproduce, without saying what
 * to do instead.
 *
 * This module drops empty positions and writes the members that remain, which
 * is what the sibling encoder in the same file already does — skip the empty
 * build, patch the count down (`TeamBuildEncoder.cpp:570-571`, `:575-578`).
 * The alternative, writing an all-zero member as a placeholder, would mean
 * inventing a meaning for profession id 0 in a member slot; the skill-template
 * evidence records that a primary of `None` is how Toolbox detects a *failed*
 * decode (skill-template-codec.md §7.2), so such a member is indistinguishable
 * from corruption. Dropping loses which party positions were occupied and
 * invents nothing. `partyMembersOf` is the one place that decision is taken.
 *
 * ## Why the per-member body lives in `skill-template.ts`
 *
 * A party loadout does not embed template *strings* — §1.1 corrects the plan on
 * exactly this point. What it embeds is the skill template *body*: the same
 * bits in the same order, with the 8-bit `kind`/`version` head replaced by an
 * 8-bit hero id (skill-template-codec.md §9). So this file owns the party frame
 * — magic, type, member count, hero id — and hands every body to
 * `skill-template.ts`, which owns the width rules and every semantic rejection
 * and reads the id tables out of `heroes.ts`. Duplicating that here would give
 * the two formats two disagreeing opinions about what attribute 26 means.
 *
 * Members are packed with no alignment between them and a body is
 * variable-length, so this file also needs to know where one *ends*. It is told
 * rather than measuring: `decodeTemplateBody` answers with the template and the
 * width it consumed, and `encodeTemplateBody` answers in bits. Measuring the
 * body here would mean a second statement of §5.2's four width rules, which is
 * the same duplication one paragraph up, just spelled in arithmetic.
 *
 * ## Hero ids are checked against the hero table, and skill ids are not
 *
 * The two look symmetrical in the stream and are not. `heroes.ts` holds the
 * whole closed `HeroID` enum, `library.ts` says the module owning that table is
 * what mints a `HeroId`, and a member naming hero 200 — or 40, which is the
 * enum's `Count` end marker — would hand every reader downstream a lookup that
 * answers `undefined`. So an unknown hero id is refused at both ends, exactly
 * as an unknown profession or attribute id is. An unknown *skill* id is
 * accepted, because the skill table is open and a skill from a newer client is
 * a thing this format is expected to carry (skill-template-codec.md §7.3).
 *
 * ## Rejections
 *
 * `decodePartyLoadout` is total: it returns `null` for anything it cannot fully
 * decode and never throws, because its input is a string a stranger pasted.
 * §1.5 lists what Toolbox's decoder refuses (empty, header ≠ 15, type ≠ 1, bit
 * exhaustion) and, more usefully, what it does not: a character outside the
 * alphabet silently truncates the stream instead of rejecting, no field is
 * range-checked, and a member count of 13-15 walks off the end of a
 * fixed-size array. This decoder refuses all of those. Two of its limits are
 * ours rather than the format's, and are marked where they are declared: a
 * member count above eight, and a maximum code length.
 */

import type { BuildLibrary, HeroId, Team } from "./library.js";
import { buildById, heroId } from "./library.js";
import { HERO_BY_ID } from "./heroes.js";
import type { SkillTemplate } from "./skill-template.js";
import {
  bitsOf,
  charsOf,
  decodeTemplateBody,
  encodeTemplateBody,
  readAt,
  writeBits,
} from "./skill-template.js";

/**
 * One party position that holds someone. `hero` is `null` for the player, who
 * occupies a member slot like any hero and is spelled `NoHero` (§1.3).
 *
 * There is no member shape for an empty position, because the format has none:
 * see the header. A loadout is the members it has, in order.
 */
export interface PartyLoadoutMember {
  readonly hero: HeroId | null;
  readonly template: SkillTemplate;
}

/** Field 0, always 15. `kDaybreakMagicByte` is this plus the type below. (`:642`, `:696`) */
const PARTY_LOADOUT_HEADER = 15;

/** Field 1, always 1. Not a version — see the header. (`:643`, `:697`) */
const PARTY_LOADOUT_TYPE = 1;

/**
 * `HeroID` is written as a raw byte, and `NoHero` (0) is the player.
 * (`:650`, `:705`)
 *
 * The byte is the field's *width*, not the range of a hero id. Which numbers
 * name a hero is `heroes.ts`'s answer and is checked against it at both ends —
 * see `decodePartyLoadout`.
 */
const HERO_ID_BITS = 8;
const NO_HERO = 0;

/**
 * Eight members, because a Guild Wars party has eight positions and
 * `TeamSlots` in `library.ts` is eight long.
 *
 * This is *our* limit, not the format's: the count field is four bits and the
 * encoder writes `builds.size()` into it with no clamp, so nine to fifteen
 * members encode and decode cleanly in Toolbox (§1.3). Refusing them here costs
 * nothing we can represent and closes the case §1.5 warns about, where a count
 * of 13-15 hands a decoder more entries than its arrays hold.
 */
const PARTY_SIZE = 8;

/**
 * The longest string that can be a party loadout, so a megabyte of `A`s is
 * refused by length rather than patiently decoded.
 *
 * Derived, not read: §1.6 records that the source imposes no length limit at
 * all. A skill template's widest payload is 502 bits — a 10-bit profession
 * field, 12 attributes with 19-bit ids, 23-bit skills (skill-template-codec.md
 * §5.1) — of which 8 are the head a member replaces with its hero id, so a
 * member is at most 502 bits too. Eight of them behind a 12-bit head is 4028
 * bits, and `ceil(4028 / 6)` is 672. §1.6's other padding rule rounds to 504
 * whole bytes first and lands on the same 672.
 */
const MAX_CODE_LENGTH = 672;

/**
 * The members of `team`, in party order, ready to encode. `null` when a slot
 * names a build the library does not hold — a dangling reference is a library
 * to repair, not a party to publish with a hole in it.
 *
 * Empty positions are dropped rather than represented; the header explains why,
 * and this is the one place that happens.
 */
export function partyMembersOf(
  library: BuildLibrary,
  team: Team,
): readonly PartyLoadoutMember[] | null {
  const members: PartyLoadoutMember[] = [];
  for (const slot of team.slots) {
    if (slot.build === null) continue;
    const build = buildById(library, slot.build);
    if (build === null) return null;
    members.push({
      hero: slot.hero,
      template: {
        professions: build.professions,
        skills: build.skills,
        attributes: build.attributes,
      },
    });
  }
  return members;
}

/**
 * Encode a party loadout. `null` when the party cannot be spelled: more members
 * than a party holds, a hero the client's table does not name, or a bar
 * `encodeTemplateBody` refuses.
 *
 * Padding follows §6 of the skill-template evidence and `skill-template.ts`:
 * zero bits to the next character, and no rounding to a whole byte first. So
 * the empty party is `"fA"` where §1.7 derives `"fAA"` from Toolbox's
 * `vector<uint8_t>` intermediate. The two rules differ by at most one trailing
 * `A` and `decodePartyLoadout` accepts both, which is what keeps the question
 * open rather than decided by us.
 */
export function encodePartyLoadout(
  members: readonly PartyLoadoutMember[],
): string | null {
  if (members.length > PARTY_SIZE) return null;

  const bits: number[] = [];
  const write = (value: number, width: number) => writeBits(bits, value, width);

  write(PARTY_LOADOUT_HEADER, 4);
  write(PARTY_LOADOUT_TYPE, 4);
  write(members.length, 4);

  for (const member of members) {
    const hero = member.hero;
    // `null` is the player and is written as `NoHero`. Everything else must be
    // a hero `heroes.ts` holds: a stored `0` would be the player's eight bits
    // with a different meaning and `library.ts` says the sentinel has no second
    // spelling, and a stored 200 is not a hero at all. See the header.
    if (hero !== null && !HERO_BY_ID.has(hero)) return null;

    // The body comes from `skill-template.ts` as bits: same width rules, one
    // implementation, and no code string in between. The next member starts at
    // the very next bit with no alignment (§1.3).
    const body = encodeTemplateBody(member.template);
    if (body === null) return null;

    write(hero ?? NO_HERO, HERO_ID_BITS);
    bits.push(...body);
  }

  return charsOf(bits);
}

/**
 * Decode a party loadout. Returns `null` — never a partial party, never a
 * thrown exception — for anything that is not a complete, valid code.
 *
 * A partial party is the shape a caller misreads as success, so a member this
 * cannot decode rejects the whole code rather than shortening the party by one
 * and leaving the others looking authoritative.
 */
export function decodePartyLoadout(
  code: string,
): readonly PartyLoadoutMember[] | null {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return null;
  const bits = bitsOf(code);
  if (bits === null) return null;

  let at = 0;
  const read = (width: number): number | null => {
    const value = readAt(bits, at, width);
    if (value === null) return null;
    at += width;
    return value;
  };

  if (read(4) !== PARTY_LOADOUT_HEADER) return null;
  if (read(4) !== PARTY_LOADOUT_TYPE) return null;
  const count = read(4);
  if (count === null || count > PARTY_SIZE) return null;

  const members: PartyLoadoutMember[] = [];
  for (let index = 0; index < count; index++) {
    const raw = read(HERO_ID_BITS);
    if (raw === null) return null;

    // A byte the client has no hero for is refused rather than minted into a
    // `HeroId`. `library.ts` says where the brand is declared that the
    // reference-data module owning the hero table is what mints these, and the
    // reason is downstream: hero 200 decodes to a member every `HERO_BY_ID`
    // lookup answers `undefined` for, with no typed failure anywhere. 40 is not
    // even a hero — it is the enum's `Count` end marker.
    //
    // This is the opposite call from the *skill* ids inside the body, and
    // deliberately so: skill-template.ts's header explains that an unknown
    // skill id is a skill from a newer client, while the hero enum is closed
    // and `heroes.ts` holds all of it. `PROFESSION_BY_ID` and `ATTRIBUTE_BY_ID`
    // are refused the same way in the same stream.
    let hero: HeroId | null = null;
    if (raw !== NO_HERO) {
      const known = HERO_BY_ID.get(heroId(raw));
      if (known === undefined) return null;
      hero = known.id;
    }

    // `skill-template.ts` owns the body: how wide it is, and every question
    // about what is in it — including the ones this file has no table for.
    const body = decodeTemplateBody(bits, at);
    if (body === null) return null;
    at += body.length;

    members.push({ hero, template: body.template });
  }

  // Everything after the last member is padding, and padding is zero. §1.6
  // leaves two padding rules open — pad to a character, or to a byte and then
  // to a character — and they differ only in trailing zero bits, so accepting
  // zeros of any length keeps both readable while a code with junk stapled to
  // the end is still refused.
  while (at < bits.length) {
    if (read(1) !== 0) return null;
  }

  return members;
}
