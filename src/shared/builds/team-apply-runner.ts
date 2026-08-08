/**
 * Turns one checked `TeamApplyPlan` into the sequence of certified commands
 * that makes the running party match it.
 *
 * ## Every step is confirmed by a read, never by a return value
 *
 * The commands are client-to-server packets. `addHero` returning true says the
 * packet was built and handed to the sender — not that a hero joined, and not
 * that the server agreed. GWCAjs records exactly this trap: `MsgSendLeave`
 * returned normally without leaving the party, because the real button ran two
 * further calls.
 *
 * So the roster the companion publishes is the only evidence this module
 * accepts. A hero is added when it *appears*, and the count it reports is the
 * number of changes it watched land, not the number of packets it sent.
 *
 * ## What it will not do
 *
 * It never kicks with hero id 38. `KickAllHeroes` is `kick(0x26)` and `0x26` is
 * 38, which is also Devona — so on a build that has her, one of those two
 * meanings is wrong and nobody has yet established which. Removing heroes one
 * at a time is the same outcome and never touches the value in doubt, at the
 * cost of one packet each.
 *
 * It also stops at the first step that does not land. A team applied halfway is
 * worse than one that refused: the player can see a refusal, and cannot see
 * that hero four kept yesterday's bar.
 */
import { ATTRIBUTES, heroLabel, PROFESSIONS } from "./heroes.js";
import { SKILL_SLOTS } from "./library.js";
import type {
  TeamApplyMember,
  TeamApplyPlan,
  TeamApplyResult,
} from "./team-apply.js";
import type { LiveParty } from "./live-party.js";

/** The commands the enhancement exposes, as this module needs them. */
export interface TeamApplyCommands {
  addHero(heroId: number): boolean;
  kickHero(heroId: number): boolean;
  setHeroBehaviour(agentId: number, behaviour: number): boolean;
  setHeroSecondary(agentId: number, profession: number): boolean;
  setHeroSkills(agentId: number, skillIds: readonly number[]): boolean;
  setHeroAttributes(
    agentId: number,
    ranks: readonly (readonly [attribute: number, rank: number])[],
  ): boolean;
}

export interface TeamApplyEnvironment {
  readonly commands: TeamApplyCommands;
  /** The party as last published. Read fresh at every confirmation. */
  party(): LiveParty;
  /** Resolves after roughly one published update, or a little longer. */
  settle(): Promise<void>;
}

/** Matches GWToolbox++'s per-hero budget; a roster change is a server round trip. */
const CONFIRM_MS = 1_000;
const POLL_MS = 50;
/**
 * When a step is re-sent once, if it is allowed to be.
 *
 * Only the skill bar uses it, and only because it follows a profession change:
 * the client rebuilds the bar when the secondary moves, and a set that arrives
 * during that rebuild can be dropped. Re-sending is safe because writing the
 * same bar twice is the same bar.
 */
const RETRY_MS = 300;

const BEHAVIOUR_IDS = Object.freeze({ fight: 0, guard: 1, avoid: 2 });

class ApplyRefused extends Error {}

/**
 * Waits for `check` to hold, or gives up.
 *
 * Deliberately a poll of the published projection rather than a subscription:
 * the projection is republished only when it changes, so a subscription would
 * wait forever for a change that had already happened before we asked.
 */
async function confirm(
  environment: TeamApplyEnvironment,
  what: string,
  check: (party: LiveParty) => boolean,
  retry?: () => void,
): Promise<void> {
  const started = Date.now();
  const deadline = started + CONFIRM_MS;
  let resent = false;
  for (;;) {
    const party = environment.party();
    if (party.status !== "ready") {
      throw new ApplyRefused("the game stopped publishing a party");
    }
    if (check(party)) return;
    if (Date.now() >= deadline) {
      throw new ApplyRefused(`${what} did not take effect`);
    }
    if (retry && !resent && Date.now() - started >= RETRY_MS) {
      resent = true;
      retry();
    }
    await environment.settle();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The bar the game currently shows for `hero`, or `null` if it was not read. */
function liveBar(party: LiveParty, hero: number): readonly number[] | null {
  const skills = party.heroes.find((one) => one.hero === hero)?.skills;
  return skills ? skills.map((skill) => skill ?? 0) : null;
}

function sameBar(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((skill, slot) => skill === right[slot]);
}

/** The attribute ranks of one member, as the client's numeric pairs. */
function attributePairs(
  member: TeamApplyMember,
): readonly (readonly [number, number])[] {
  const build = member.build;
  if (build === null) return [];
  // Keyed off the table rather than off the record: `Object.entries` widens the
  // key to `string`, and a name the table does not know would then index it as
  // `any` and send whatever `undefined.id` produced.
  const pairs: (readonly [number, number])[] = [];
  for (const [name, facts] of Object.entries(ATTRIBUTES)) {
    const rank = build.attributes[name as keyof typeof ATTRIBUTES];
    if (typeof rank === "number" && rank > 0) pairs.push([facts.id, rank]);
  }
  return pairs;
}

/** The eight skill ids of one member, zero for an empty slot. */
function skillIds(member: TeamApplyMember): readonly number[] {
  const build = member.build;
  if (build === null) return [];
  return SKILL_SLOTS.map((slot) => build.skills[slot] ?? 0);
}

/**
 * Applies `plan`, or refuses.
 *
 * The order is GWToolbox++'s, for the reason it chose it: a hero has no agent
 * id until it is in the party, and everything except adding and removing is
 * keyed by agent id.
 */
export async function runTeamApply(
  plan: TeamApplyPlan,
  environment: TeamApplyEnvironment,
  commandId: number,
): Promise<TeamApplyResult> {
  const opening = environment.party();
  if (opening.status !== "ready") {
    throw new Error("No party has been observed yet.");
  }
  if (opening.inOutpost !== true) {
    throw new Error(
      opening.inOutpost === false
        ? "A team can only be applied in an outpost."
        : "Whether this is an outpost has not been observed yet.",
    );
  }

  const wanted = plan.members
    .filter((member): member is TeamApplyMember & { hero: number } =>
      member.hero !== null);
  const wantedHeroes = new Set(wanted.map((member) => member.hero));

  // Preflight the complete opening party before changing it. Devona's hero id
  // is also the client's kick-all sentinel; discovering her after removing an
  // earlier hero would turn a refusal into a half-applied team.
  if (opening.heroes.some(
    (present) => present.hero === 38 && !wantedHeroes.has(present.hero),
  )) {
    throw new Error(
      "Devona shares her hero id with the client's kick-all sentinel, so this "
      + "cannot remove her. Remove her in the party window first. 0 changes "
      + "were made.",
    );
  }
  let completedChanges = 0;
  let skillsSkipped = false;
  let skipped: readonly number[] = [];

  try {
    // Out first, so a full party has room for the heroes coming in.
    for (const present of opening.heroes) {
      if (wantedHeroes.has(present.hero)) continue;
      environment.commands.kickHero(present.hero);
      await confirm(
        environment,
        `removing ${heroLabel(present.hero)}`,
        (party) => !party.heroes.some((hero) => hero.hero === present.hero),
      );
      completedChanges += 1;
    }

    for (const member of wanted) {
      if (!environment.party().heroes.some((hero) => hero.hero === member.hero)) {
        environment.commands.addHero(member.hero);
        await confirm(
          environment,
          `adding ${heroLabel(member.hero)}`,
          // Both the identity and the agent id: the hero appears in the roster
          // before it has one, and every command below is keyed by it.
          (party) => party.heroes.some(
            (hero) => hero.hero === member.hero && hero.agentId > 0),
        );
        completedChanges += 1;
      }
      const agentId = environment.party().heroes
        .find((hero) => hero.hero === member.hero)?.agentId ?? 0;
      if (agentId === 0) {
        throw new ApplyRefused(
          `${heroLabel(member.hero)} has no agent to command`,
        );
      }

      if (member.build !== null) {
        // The secondary profession comes first, and it is not optional.
        //
        // Changing it resets the bar and the attribute lines that belonged to
        // the old one, so setting skills or ranks before it would apply them
        // and then throw them away. GWCA's `LoadSkillTemplate` runs the same
        // three in this order for the same reason.
        //
        // Only the secondary. A hero's *primary* is who they are and no
        // message changes it — a build whose primary the hero does not have is
        // a build for a different hero, and the client drops the skills it
        // cannot use, which is what `skillsSkipped` reports.
        const [, secondary] = member.build.professions;
        const live = environment.party().heroes
          .find((hero) => hero.hero === member.hero);
        const wantedSecondary = secondary === null ? 0 : PROFESSIONS[secondary].id;
        // Unread professions are not a mismatch. Sending a change nobody asked
        // for costs a wasted reset of the bar we are about to write.
        if (live?.professions !== null
          && live?.professions !== undefined
          && (live.professions[1] ?? null) !== secondary) {
          environment.commands.setHeroSecondary(agentId, wantedSecondary);
          await confirm(
            environment,
            `${heroLabel(member.hero)}'s secondary profession`,
            (party) => (party.heroes.find(
              (hero) => hero.hero === member.hero)?.professions?.[1] ?? null)
              === secondary,
          );
          completedChanges += 1;
        }

        const skills = skillIds(member);
        const before = liveBar(environment.party(), member.hero);
        if (before === null || !sameBar(before, skills)) {
          const send = () => environment.commands.setHeroSkills(agentId, skills);
          send();
          // The client keeps a skill the hero may not use out of the bar, and
          // leaves whatever was in that slot. So the answer is not "the bar
          // matches" or "the bar is empty where it could not comply" — it is
          // whatever the bar settles on, which may differ from the request in
          // slots the request cared about. Waiting for an exact match is what
          // reported a partly-applied bar as a failure.
          let steady: readonly number[] | null = null;
          await confirm(
            environment,
            `${heroLabel(member.hero)}'s skill bar`,
            (party) => {
              const bar = liveBar(party, member.hero);
              if (bar === null) return false;
              if (sameBar(bar, skills)) return true;
              // A bar still showing what it showed before is a bar in flight,
              // not the client's answer.
              if (before !== null && sameBar(bar, before)) return false;
              // And the same different bar twice, because the client can
              // publish an intermediate state on its way to the final one.
              if (steady === null || !sameBar(steady, bar)) {
                steady = bar;
                return false;
              }
              skipped = skills
                .map((skill, slot) => (skill !== 0 && bar[slot] !== skill ? skill : 0))
                .filter((skill) => skill !== 0);
              skillsSkipped = skipped.length > 0;
              return true;
            },
            send,
          );
          completedChanges += 1;
        }

        const ranks = attributePairs(member);
        const wanted = member.build.attributes;
        const settled = (party: LiveParty) => {
          const live = party.heroes
            .find((hero) => hero.hero === member.hero)?.attributes;
          if (!live) return false;
          // Every rank asked for, at the value asked for. Not equality: the
          // client keeps ranks the build says nothing about, and a build that
          // mentions eight attributes is not a claim that the other
          // thirty-four are zero.
          return Object.entries(wanted).every(([name, rank]) =>
            rank === undefined || rank === 0
            || live[name as keyof typeof wanted] === rank);
        };
        if (ranks.length > 0 && !settled(environment.party())) {
          environment.commands.setHeroAttributes(agentId, ranks);
          await confirm(
            environment,
            `${heroLabel(member.hero)}'s attributes`,
            settled,
          );
          completedChanges += 1;
        }
      }

      if (member.behaviour !== null) {
        const behaviour = BEHAVIOUR_IDS[member.behaviour];
        const live = environment.party().heroes
          .find((hero) => hero.hero === member.hero);
        if (live?.behaviour !== member.behaviour) {
          environment.commands.setHeroBehaviour(agentId, behaviour);
          await confirm(
            environment,
            `${heroLabel(member.hero)}'s behaviour`,
            (party) => party.heroes.find(
              (hero) => hero.hero === member.hero)?.behaviour === member.behaviour,
          );
          completedChanges += 1;
        }
      }
    }
  } catch (cause) {
    if (cause instanceof ApplyRefused) {
      throw new Error(
        `${cause.message}. ${completedChanges} `
        + `${completedChanges === 1 ? "change" : "changes"} were made before it `
        + "stopped; the party window shows where it got to.",
        { cause },
      );
    }
    throw cause;
  }

  return Object.freeze({
    commandId,
    completedChanges,
    skillsSkipped,
    // Named, not counted. "Guild Wars skipped a skill" is not actionable; the
    // skill it skipped tells the player it is one they have not unlocked.
    skippedSkills: Object.freeze(skipped),
  });
}
