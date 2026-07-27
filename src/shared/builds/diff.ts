// What changed between two builds, said precisely enough to show a player.
//
// The parent link stored in `library.ts` is decoration until something can
// answer "what did I actually change?", and the capture flow cannot offer "this
// is a variant of Discord Necro" until something can answer "what is this bar
// closest to?". Both questions are one comparison, so they live in one file.
//
// The comparison is not invented here either: it is the one the UX prototype at
// `plans/research/toolbox/11-teams-ux-prototype.html` arrived at by being used.
// Three of its decisions are the reason this is worth having:
//
//  1. A changed slot carries *both* skills, not the slot number. "Slot 3
//     changed" is a diff a machine is satisfied by; "Aegis → Protective Spirit"
//     is the sentence the player came for, and the from/to pair is what lets a
//     caller render it. The same record covers the two ends of a bar being
//     filled in, because an empty slot is a real value: `null → Aegis` and
//     `Aegis → null` are both named swaps.
//  2. Distance is a single integer — one per changed slot, one per changed
//     attribute, one for a changed profession pair — because everything that
//     consumes a diff is really asking "how far apart are these?": the fork
//     prompt, the merge-back offer, and the near-duplicate ceiling below.
//     Weighting an elite swap above a rank change would be a better model of
//     the *game* and a worse model of the question.
//  3. A candidate with a different primary profession is not near anything.
//     Two bars can be one skill apart and still be a Monk build and a Ritualist
//     build, and offering the second as a variant of the first would be
//     confidently wrong. Secondary professions are compared as a difference,
//     not as a disqualifier — re-secondarying a bar is an ordinary variant.
//
// Where this departs from the prototype, and why:
//   - The empty summary is `"identical"`, not the prototype's "identical to its
//     parent". The same string is shown beside a variant *and* in the capture
//     flow, where there is no parent and the caller supplies the context
//     ("… from Discord Necro"). A function that names a relationship it was not
//     told about is one the second caller has to work around.
//   - `droppedByTeam` answers in heroes rather than in live party slots. The
//     prototype computes the slot index and every caller then ignores it, so
//     the index is not part of the answer.
//
// Pure and total: no I/O, no throwing, no Electron. Main and the renderer both
// import this, and a diff runs while the player types.
import type {
  Attribute,
  AttributeRank,
  Build,
  BuildId,
  BuildLibrary,
  HeroId,
  ProfessionPair,
  SkillSlot,
  SkillSlotIndex,
  Team,
} from "./library.js";
import { SKILL_SLOTS, buildById } from "./library.js";

/** One changed position, with the skill that left and the skill that arrived. */
export interface SkillChange {
  readonly slot: SkillSlotIndex;
  /** `null` when this position was empty before the change. */
  readonly from: SkillSlot;
  /** `null` when the change emptied this position. */
  readonly to: SkillSlot;
}

/** One changed rank. An attribute absent from a build is rank 0 on both sides. */
export interface AttributeChange {
  readonly attribute: Attribute;
  readonly from: AttributeRank;
  readonly to: AttributeRank;
}

/** Both pairs in full: a secondary swap and a primary swap read differently. */
export interface ProfessionChange {
  readonly from: ProfessionPair;
  readonly to: ProfessionPair;
}

export interface BuildDiff {
  readonly skills: readonly SkillChange[];
  readonly attributes: readonly AttributeChange[];
  /** `null` when both builds are the same primary/secondary pair. */
  readonly professions: ProfessionChange | null;
  /** Distance: one per changed slot, one per changed attribute, one for the pair. */
  readonly total: number;
}

/**
 * The attributes either build mentions, in the order they are stored: the
 * left-hand build's first, then whatever the right-hand one adds. `Object.keys`
 * has to be re-typed because it answers in `string`; the value is a
 * `Partial<Record<Attribute, …>>`, so an unexpected key can only come from a
 * record that lied about its own type, and such a key compares 0 against 0 and
 * drops out below rather than becoming a change.
 */
const mentionedAttributes = (
  from: Build,
  to: Build,
): ReadonlySet<Attribute> =>
  new Set([
    ...(Object.keys(from.attributes) as readonly Attribute[]),
    ...(Object.keys(to.attributes) as readonly Attribute[]),
  ]);

/**
 * What `to` changed relative to `from`. Direction matters: every field reads
 * "from the first build, to the second", so a caller rendering "variant vs
 * parent" passes the parent first.
 */
export function diffBuilds(from: Build, to: Build): BuildDiff {
  const skills: SkillChange[] = [];
  for (const slot of SKILL_SLOTS) {
    // `?? null` rather than a bare read: a record parsed from a stored file can
    // be short despite the tuple type, and a missing position is an empty one,
    // not an `undefined` to hand back to a renderer.
    const before = from.skills[slot] ?? null;
    const after = to.skills[slot] ?? null;
    if (before !== after) skills.push({ slot, from: before, to: after });
  }

  const attributes: AttributeChange[] = [];
  for (const attribute of mentionedAttributes(from, to)) {
    // Absent is rank 0, so investing nothing and storing an explicit 0 are the
    // same build. Reporting that pair as a change would put "0 → 0" in front of
    // a player who changed nothing.
    const before = from.attributes[attribute] ?? 0;
    const after = to.attributes[attribute] ?? 0;
    if (before !== after) attributes.push({ attribute, from: before, to: after });
  }

  const professions: ProfessionChange | null =
    from.professions[0] === to.professions[0] &&
    from.professions[1] === to.professions[1]
      ? null
      : { from: from.professions, to: to.professions };

  return {
    skills,
    attributes,
    professions,
    total: skills.length + attributes.length + (professions === null ? 0 : 1),
  };
}

/**
 * The diff as one line of English. The verb is the whole difficulty: a single
 * countable thing takes "differs", and anything else — a plural count, or two
 * things listed together — takes "differ". "1 skill differs", "2 skills differ",
 * "1 skill, 1 attribute differ", "2 skills, 1 attribute differ".
 */
export function diffSummary(diff: BuildDiff): string {
  const parts: string[] = [];
  let plural = false;

  if (diff.skills.length > 0) {
    parts.push(`${diff.skills.length} skill${diff.skills.length === 1 ? "" : "s"}`);
    if (diff.skills.length > 1) plural = true;
  }
  if (diff.attributes.length > 0) {
    parts.push(
      `${diff.attributes.length} attribute${diff.attributes.length === 1 ? "" : "s"}`,
    );
    if (diff.attributes.length > 1) plural = true;
  }
  if (diff.professions !== null) {
    parts.push("professions");
    plural = true;
  }

  if (parts.length === 0) return "identical";
  return `${parts.join(", ")} ${parts.length === 1 && !plural ? "differs" : "differ"}`;
}

/** A library build near the one asked about, and how near. */
export interface NearestBuild {
  readonly build: Build;
  readonly diff: BuildDiff;
  /** Nothing differs at all: reuse this build instead of storing another. */
  readonly exact: boolean;
}

/**
 * The library build closest to `build`, or `null` if nothing is close enough.
 * This is what stops capture and import filling the library with
 * near-duplicates: an exact match is a build the player already has, and a near
 * match is the "a variant of X" offer.
 *
 * `maxDistance` defaults to 3, the prototype's ceiling — beyond about three
 * changes the offer stops being helpful and starts being a wrong guess the
 * player has to decline. An exact match is returned regardless of the ceiling
 * and immediately, because there is nothing closer to keep looking for. Ties go
 * to the first candidate in library order; the caller can always choose
 * differently, and a stable answer is worth more than an arbitrary later one.
 */
export function nearestBuild(
  library: BuildLibrary,
  build: Build,
  maxDistance = 3,
): NearestBuild | null {
  let best: NearestBuild | null = null;
  for (const candidate of library.builds) {
    // A build is not a near-duplicate of itself; without this, re-examining a
    // stored build would always report an exact match with itself.
    if (candidate.id === build.id) continue;
    if (candidate.professions[0] !== build.professions[0]) continue;

    // Candidate first: the summary reads "1 skill differs" *from* the build
    // whose name the caller is about to print.
    const diff = diffBuilds(candidate, build);
    if (diff.total === 0) return { build: candidate, diff, exact: true };
    if (diff.total <= maxDistance && (best === null || diff.total < best.diff.total)) {
      best = { build: candidate, diff, exact: false };
    }
  }
  return best;
}

/** A build that exists and has at least one skill on it. */
const isFilled = (library: BuildLibrary, id: BuildId | null): boolean => {
  if (id === null) return false;
  const build = buildById(library, id);
  return build !== null && build.skills.some((slot) => slot !== null);
};

/**
 * The heroes currently working in `party` that `team` has no place for. Applying
 * a team is destructive to the party you already have, and this is the sentence
 * that warns you before it happens: "Livia and Olias are in your party and not
 * in this team".
 *
 * A hero with an empty build is doing nothing and is not worth warning about.
 * Each hero is named once even if the party somehow lists it twice — a
 * duplicate is a party state the client should not produce, and repeating the
 * name in the warning would describe the bug rather than the loss.
 */
export function droppedByTeam(
  library: BuildLibrary,
  party: Team,
  team: Team,
): readonly HeroId[] {
  const wanted = new Set<HeroId>();
  for (const slot of team.slots) {
    if (slot.hero !== null) wanted.add(slot.hero);
  }

  const dropped = new Set<HeroId>();
  for (const slot of party.slots) {
    // Slot 0 is the player, who carries no hero and is never dropped.
    if (slot.hero === null || wanted.has(slot.hero)) continue;
    if (isFilled(library, slot.build)) dropped.add(slot.hero);
  }
  return [...dropped];
}
