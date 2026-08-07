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
import { ATTRIBUTES } from "./heroes.js";
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
): Promise<void> {
  const deadline = Date.now() + CONFIRM_MS;
  for (;;) {
    const party = environment.party();
    if (party.status !== "ready") {
      throw new ApplyRefused("the game stopped publishing a party");
    }
    if (check(party)) return;
    if (Date.now() >= deadline) {
      throw new ApplyRefused(`${what} did not take effect`);
    }
    await environment.settle();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
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
  let completedChanges = 0;
  let skillsSkipped = false;

  try {
    // Out first, so a full party has room for the heroes coming in.
    for (const present of opening.heroes) {
      if (wantedHeroes.has(present.hero)) continue;
      if (present.hero === 38) {
        throw new ApplyRefused(
          "Devona shares her hero id with the client's kick-all sentinel, "
          + "so this cannot remove her. Remove her in the party window first.",
        );
      }
      environment.commands.kickHero(present.hero);
      await confirm(
        environment,
        `removing hero ${present.hero}`,
        (party) => !party.heroes.some((hero) => hero.hero === present.hero),
      );
      completedChanges += 1;
    }

    for (const member of wanted) {
      if (!environment.party().heroes.some((hero) => hero.hero === member.hero)) {
        environment.commands.addHero(member.hero);
        await confirm(
          environment,
          `adding hero ${member.hero}`,
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
        throw new ApplyRefused(`hero ${member.hero} has no agent to command`);
      }

      if (member.build !== null) {
        // A build's secondary profession is deliberately not applied. The
        // command exists — opcode 65 is certified — but changing a hero's
        // secondary is an unlock-gated decision about that hero, not part of
        // loading a bar onto it. A bar needing a secondary the hero does not
        // have is dropped skill by skill by the client, which is exactly what
        // `skillsSkipped` reports.
        const skills = skillIds(member);
        environment.commands.setHeroSkills(agentId, skills);
        await confirm(
          environment,
          `the skill bar for hero ${member.hero}`,
          (party) => {
            const live = party.heroes.find((hero) => hero.hero === member.hero);
            const bar = live?.skills;
            if (!bar) return false;
            const applied = bar.map((skill) => skill ?? 0);
            if (applied.every((skill, slot) => skill === skills[slot])) return true;
            // The client drops a skill the character cannot use rather than
            // refusing the bar. That is a real, reportable outcome and not a
            // failure to apply — but only once the bar has stopped changing.
            if (applied.some((skill, slot) => skill !== 0 && skill !== skills[slot])) {
              return false;
            }
            skillsSkipped = applied.some((skill) => skill === 0)
              && skills.some((skill) => skill !== 0);
            return skillsSkipped;
          },
        );
        completedChanges += 1;

        const ranks = attributePairs(member);
        if (ranks.length > 0) {
          environment.commands.setHeroAttributes(agentId, ranks);
          // Attributes are not published per hero, so there is nothing to
          // confirm them against. The change is counted only after the roster
          // has settled, which at least proves the party survived the packet.
          await environment.settle();
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
            `the behaviour of hero ${member.hero}`,
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

  return Object.freeze({ commandId, completedChanges, skillsSkipped });
}
