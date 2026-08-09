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
import {
  SKILL_SLOTS,
  type AttributeRanks,
  type HeroId,
  type ProfessionPair,
  type SkillId,
} from "./library.js";
import type {
  TeamApplyMember,
  TeamApplyPlan,
  TeamApplyResult,
} from "./team-apply.js";
import {
  preflightTeamApply,
  teamApplyProblemMessage,
} from "./team-apply.js";
import type { LiveParty, SkillUnlockObservation } from "./live-party.js";

/** The commands the enhancement exposes, as this module needs them. */
export interface TeamApplyCommands {
  setHardMode(enabled: boolean): void;
  setPlayerSecondary(profession: number): void;
  setPlayerSkills(skillIds: readonly number[]): void;
  setPlayerAttributes(
    ranks: readonly (readonly [attribute: number, rank: number])[],
  ): void;
  addHero(heroId: HeroId): void;
  kickHero(heroId: HeroId): void;
  setHeroBehaviour(heroId: HeroId, behaviour: number): void;
  setHeroSecondary(heroId: HeroId, profession: number): void;
  setHeroSkills(heroId: HeroId, skillIds: readonly number[]): void;
  setHeroAttributes(
    heroId: HeroId,
    ranks: readonly (readonly [attribute: number, rank: number])[],
  ): void;
}

export interface TeamApplyEnvironment {
  readonly commands: TeamApplyCommands;
  /** The party as last published. Read fresh at every confirmation. */
  party(): LiveParty;
  /** Stops the sequence before it can send another packet. */
  readonly signal?: AbortSignal;
  /** One bounded semantic stream for UI progress and development evidence. */
  readonly onEvent?: (event: TeamApplyEvent) => void;
  /**
   * Confirmation time. Production uses the real clock when this is absent;
   * deterministic runners can advance it without waiting one wall-clock second.
   */
  readonly confirmationTime?: {
    now(): number;
    sleep(milliseconds: number): Promise<void>;
  };
}

export type TeamApplyEvent = Readonly<{
  state: "sending" | "waiting" | "retrying" | "stable" | "confirmed"
    | "cancelled" | "failed";
  message: string;
  elapsedMs: number;
}>;

/** Matches GWToolbox++'s per-hero budget; a roster change is a server round trip. */
const CONFIRM_MS = 1_000;
/** Live profession changes can arrive well after the command was accepted. */
const PROFESSION_CONFIRM_MS = 15_000;
/** A published profession leads the client state rebuilt from that profession. */
const PROFESSION_STABLE_MS = 1_000;
/** One idempotent resend covers a packet dropped during the client transition. */
const PROFESSION_RETRY_MS = 3_000;
const SKILL_CONFIRM_MS = 3_000;
const SKILL_STABLE_MS = 1_000;
const POLL_MS = 50;
/**
 * When a step is re-sent once, if it is allowed to be.
 *
 * Skill bars and profession changes each use one bounded retry. Both writes are
 * idempotent: sending the same requested value twice has the same final state.
 */
const SKILL_RETRY_MS = 750;

const BEHAVIOUR_IDS = Object.freeze({ fight: 0, guard: 1, avoid: 2 });

class ApplyRefused extends Error {
  readonly elapsedMs: number;

  constructor(message: string, elapsedMs = 0) {
    super(message);
    this.elapsedMs = elapsedMs;
  }
}
class ApplyCancelled extends Error {}

type ConfirmationObservation<T> =
  | Readonly<{ state: "waiting" }>
  | Readonly<{ state: "confirmed"; value: T }>
  | Readonly<{ state: "candidate"; key: string; value: T }>;

type ConfirmationPolicy = Readonly<{
  timeoutMs?: number;
  stableMs?: number;
  retryAfterMs?: number;
}>;

function emit(
  environment: TeamApplyEnvironment,
  state: TeamApplyEvent["state"],
  message: string,
  elapsedMs = 0,
): void {
  environment.onEvent?.(Object.freeze({ state, message, elapsedMs }));
}

function cancelled(environment: TeamApplyEnvironment): void {
  if (environment.signal?.aborted) throw new ApplyCancelled("Apply was cancelled");
}

function send(
  environment: TeamApplyEnvironment,
  what: string,
  command: () => void,
): void {
  cancelled(environment);
  emit(environment, "sending", `Sending ${what}…`);
  command();
}

function writableParty(environment: TeamApplyEnvironment): LiveParty {
  const party = environment.party();
  if (party.status !== "ready") {
    throw new ApplyRefused("the game stopped publishing a party");
  }
  if (party.playRegion !== "pve") {
    throw new ApplyRefused(
      party.playRegion === "pvp"
        ? "the party entered PvP"
        : "the current region became unknown",
    );
  }
  if (party.inOutpost !== true) {
    throw new ApplyRefused("the party left the outpost");
  }
  return party;
}

/**
 * Waits for `check` to hold, or gives up.
 *
 * Deliberately a poll of the published projection rather than a subscription:
 * the projection is republished only when it changes, so a subscription would
 * wait forever for a change that had already happened before we asked.
 */
async function confirmObserved<T>(
  environment: TeamApplyEnvironment,
  what: string,
  observe: (party: LiveParty) => ConfirmationObservation<T>,
  retry?: () => void,
  policy: ConfirmationPolicy = {},
): Promise<T> {
  const now = environment.confirmationTime?.now ?? Date.now;
  const sleep = environment.confirmationTime?.sleep
    ?? ((milliseconds: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  const started = now();
  const deadline = started + (policy.timeoutMs ?? CONFIRM_MS);
  let candidateKey: string | null = null;
  let candidateSince = 0;
  let resent = false;
  emit(environment, "waiting", `Waiting for ${what}…`);
  for (;;) {
    cancelled(environment);
    const party = writableParty(environment);
    const observation = observe(party);
    if (observation.state === "confirmed") {
      emit(environment, "confirmed", `${what} confirmed.`, now() - started);
      return observation.value;
    }
    if (now() >= deadline) {
      throw new ApplyRefused(`${what} did not take effect`, now() - started);
    }
    if (observation.state === "candidate") {
      if (candidateKey !== observation.key) {
        candidateKey = observation.key;
        candidateSince = now();
      }
      if (now() - candidateSince >= (policy.stableMs ?? 0)) {
        emit(environment, "stable", `${what} settled.`, now() - started);
        return observation.value;
      }
    } else {
      candidateKey = null;
      candidateSince = 0;
    }
    if (
      retry
      && !resent
      && policy.retryAfterMs !== undefined
      && now() - started >= policy.retryAfterMs
    ) {
      resent = true;
      cancelled(environment);
      emit(environment, "retrying", `Retrying ${what}…`, now() - started);
      retry();
    }
    await sleep(POLL_MS);
  }
}

/** The bar the game currently shows for `hero`, or `null` if it was not read. */
function liveBar(party: LiveParty, hero: number): readonly number[] | null {
  const skills = party.heroes.find((one) => one.hero === hero)?.skills;
  return skills ? skills.map((skill) => skill ?? 0) : null;
}

function livePlayerBar(party: LiveParty): readonly number[] | null {
  return party.player?.skills?.map((skill) => skill ?? 0) ?? null;
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
 * Applies one bar and accepts the stable partial bar Guild Wars publishes when
 * the account cannot equip every requested skill. Every skipped id is added to
 * the operation-wide set, so a later hero cannot erase an earlier refusal.
 */
async function applySkillBar(
  environment: TeamApplyEnvironment,
  what: string,
  wanted: readonly number[],
  before: readonly number[] | null,
  read: (party: LiveParty) => readonly number[] | null,
  command: () => void,
  skipped: Set<number>,
  unlocks: SkillUnlockObservation | null,
): Promise<boolean> {
  if (before !== null && sameBar(before, wanted)) return false;
  send(environment, what, command);
  const result = await confirmObserved(
    environment,
    what,
    (party) => {
      const bar = read(party);
      if (bar === null) return { state: "waiting" };
      if (sameBar(bar, wanted)) return { state: "confirmed", value: bar };
      if (before !== null && sameBar(bar, before)) return { state: "waiting" };
      return { state: "candidate", key: bar.join(","), value: bar };
    },
    () => send(environment, what, command),
    {
      timeoutMs: SKILL_CONFIRM_MS,
      stableMs: SKILL_STABLE_MS,
      retryAfterMs: SKILL_RETRY_MS,
    },
  );
  wanted.forEach((skill, slot) => {
    if (skill === 0 || result[slot] === skill) return;
    if (
      unlocks !== null
      && skill < unlocks.knownThrough
      && unlocks.unlocked.has(skill as SkillId)
    ) {
      throw new ApplyRefused(
        `${what} omitted reportedly unlocked skill ${skill} from slot ${slot + 1}`,
      );
    }
    skipped.add(skill);
  });
  return true;
}

function buildProfessionProblem(
  subject: string,
  member: TeamApplyMember,
  professions: ProfessionPair | null,
): string | null {
  if (member.build === null) return null;
  if (professions === null) {
    return `${subject}'s professions have not been observed yet`;
  }
  if (professions[0] !== member.build.professions[0]) {
    return `${subject} is ${professions[0]}, but the assigned build is for `
      + member.build.professions[0];
  }
  return null;
}

function sameAttributes(
  live: AttributeRanks | null | undefined,
  wanted: AttributeRanks,
): boolean {
  if (live === null || live === undefined) return false;
  const names = new Set([
    ...Object.keys(live),
    ...Object.keys(wanted),
  ] as (keyof AttributeRanks)[]);
  return [...names].every((name) =>
    (live[name] ?? 0) === (wanted[name] ?? 0));
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
  const preflight = preflightTeamApply(plan, opening);
  if (!preflight.ready) {
    const message = `${teamApplyProblemMessage(preflight.blockers[0])} `
      + "0 changes were confirmed.";
    emit(environment, "failed", message);
    throw new Error(message);
  }

  const wanted = plan.members
    .filter((member): member is TeamApplyMember & { hero: number } =>
      member.hero !== null);
  const wantedHeroes = new Set(wanted.map((member) => member.hero));

  const playerMember = plan.members[0];
  let completedChanges = 0;
  const skipped = new Set<number>();

  try {
    if (plan.mode !== "none") {
      if (opening.hardMode === null) {
        throw new ApplyRefused("the current Normal or Hard Mode was not observed");
      }
      const wantedHard = plan.mode === "hard";
      if (opening.hardMode !== wantedHard) {
        send(environment, wantedHard ? "enabling Hard Mode" : "enabling Normal Mode", () => {
          writableParty(environment);
          environment.commands.setHardMode(wantedHard);
        });
        await confirmObserved(
          environment,
          wantedHard ? "enabling Hard Mode" : "enabling Normal Mode",
          (party) => party.playRegion === "pve" && party.hardMode === wantedHard
            ? { state: "confirmed", value: undefined }
            : { state: "waiting" },
        );
        completedChanges += 1;
      }
    }

    if (playerMember?.build !== null && playerMember?.build !== undefined) {
      const current = writableParty(environment).player;
      if (current === null || current.agentId === 0) {
        throw new ApplyRefused("the player's own build was not observed");
      }
      const [, secondary] = playerMember.build.professions;
      const wantedSecondary = secondary === null ? 0 : PROFESSIONS[secondary].id;
      if ((current.professions?.[1] ?? null) !== secondary) {
        const setSecondary = () => send(environment, "the player's secondary profession", () => {
          writableParty(environment);
          environment.commands.setPlayerSecondary(wantedSecondary);
        });
        setSecondary();
        await confirmObserved(
          environment,
          "the player's secondary profession",
          (party) => (party.player?.professions?.[1] ?? null) === secondary
            ? { state: "candidate", key: String(secondary), value: undefined }
            : { state: "waiting" },
          setSecondary,
          {
            timeoutMs: PROFESSION_CONFIRM_MS,
            stableMs: PROFESSION_STABLE_MS,
            retryAfterMs: PROFESSION_RETRY_MS,
          },
        );
        completedChanges += 1;
      }

      const skills = skillIds(playerMember);
      const before = livePlayerBar(environment.party());
      if (await applySkillBar(
        environment,
        "the player's skill bar",
        skills,
        before,
        livePlayerBar,
        () => {
          if (writableParty(environment).player === null) {
            throw new ApplyRefused("the player was no longer observed");
          }
          environment.commands.setPlayerSkills(skills);
        },
        skipped,
        opening.characterSkills,
      )) {
        completedChanges += 1;
      }

      const ranks = attributePairs(playerMember);
      const wantedRanks = playerMember.build.attributes;
      const settled = (party: LiveParty) =>
        sameAttributes(party.player?.attributes, wantedRanks);
      if (!settled(environment.party())) {
        if (writableParty(environment).player === null) {
          throw new ApplyRefused("the player was no longer observed");
        }
        send(environment, "the player's attributes", () => {
          environment.commands.setPlayerAttributes(ranks);
        });
        await confirmObserved(
          environment,
          "the player's attributes",
          (party) => settled(party)
            ? { state: "confirmed", value: undefined }
            : { state: "waiting" },
        );
        completedChanges += 1;
      }
    }

    let rosterActions = 0;
    for (;;) {
      const current = writableParty(environment);
      const unwanted = current.heroes.find(({ hero }) => !wantedHeroes.has(hero));
      if (unwanted) {
        if (unwanted.hero === 38) {
          throw new ApplyRefused("Devona cannot be removed safely; remove her manually");
        }
        if (++rosterActions > 16) throw new ApplyRefused("the party roster kept changing");
        send(environment, `removing ${heroLabel(unwanted.hero)}`, () => {
          environment.commands.kickHero(unwanted.hero);
        });
        await confirmObserved(
          environment,
          `removing ${heroLabel(unwanted.hero)}`,
          (party) => !party.heroes.some((hero) => hero.hero === unwanted.hero)
            ? { state: "confirmed", value: undefined }
            : { state: "waiting" },
        );
        completedChanges += 1;
        continue;
      }
      const missing = wanted.find(
        (member) => !current.heroes.some(({ hero }) => hero === member.hero),
      );
      if (!missing) break;
      if (++rosterActions > 16) throw new ApplyRefused("the party roster kept changing");
      send(environment, `adding ${heroLabel(missing.hero)}`, () => {
        environment.commands.addHero(missing.hero);
      });
      await confirmObserved(
        environment,
        `adding ${heroLabel(missing.hero)}`,
        (party) => party.heroes.some(
          (hero) => hero.hero === missing.hero && hero.agentId > 0)
          ? { state: "confirmed", value: undefined }
          : { state: "waiting" },
      );
      completedChanges += 1;
    }

    for (const member of wanted) {
      if ((environment.party().heroes
        .find((hero) => hero.hero === member.hero)?.agentId ?? 0) === 0) {
        throw new ApplyRefused(
          `${heroLabel(member.hero)} has no agent to command`,
        );
      }

      if (member.build !== null) {
        const observed = writableParty(environment).heroes
          .find((hero) => hero.hero === member.hero);
        if (observed === undefined) {
          throw new ApplyRefused(`${heroLabel(member.hero)} was no longer observed`);
        }
        const professionProblem = buildProfessionProblem(
          heroLabel(member.hero),
          member,
          observed.professions,
        );
        if (professionProblem !== null) {
          throw new ApplyRefused(professionProblem);
        }
        // The secondary profession comes first, and it is not optional.
        //
        // Changing it resets the bar and the attribute lines that belonged to
        // the old one, so setting skills or ranks before it would apply them
        // and then throw them away. GWCA's `LoadSkillTemplate` runs the same
        // three in this order for the same reason.
        //
        // Only the secondary. A hero's primary is immutable; the preflight
        // above refuses a build for a different primary before reaching here.
        const [, secondary] = member.build.professions;
        const live = environment.party().heroes
          .find((hero) => hero.hero === member.hero);
        const wantedSecondary = secondary === null ? 0 : PROFESSIONS[secondary].id;
        if ((live?.professions?.[1] ?? null) !== secondary) {
          const subject = `${heroLabel(member.hero)}'s secondary profession`;
          const setSecondary = () => send(environment, subject, () => {
            writableParty(environment);
            environment.commands.setHeroSecondary(member.hero, wantedSecondary);
          });
          setSecondary();
          await confirmObserved(
            environment,
            subject,
            (party) => (party.heroes.find(
              (hero) => hero.hero === member.hero)?.professions?.[1] ?? null)
              === secondary
              ? { state: "candidate", key: String(secondary), value: undefined }
              : { state: "waiting" },
            setSecondary,
            {
              timeoutMs: PROFESSION_CONFIRM_MS,
              stableMs: PROFESSION_STABLE_MS,
              retryAfterMs: PROFESSION_RETRY_MS,
            },
          );
          completedChanges += 1;
        }

        const skills = skillIds(member);
        const before = liveBar(environment.party(), member.hero);
        if (await applySkillBar(
          environment,
          `${heroLabel(member.hero)}'s skill bar`,
          skills,
          before,
          (party) => liveBar(party, member.hero),
          () => {
            writableParty(environment);
            environment.commands.setHeroSkills(member.hero, skills);
          },
          skipped,
          opening.accountSkills,
        )) {
          completedChanges += 1;
        }

        const ranks = attributePairs(member);
        const wanted = member.build.attributes;
        const settled = (party: LiveParty) => sameAttributes(
          party.heroes.find((hero) => hero.hero === member.hero)?.attributes,
          wanted,
        );
        if (!settled(environment.party())) {
          writableParty(environment);
          const subject = `${heroLabel(member.hero)}'s attributes`;
          send(environment, subject, () => {
            environment.commands.setHeroAttributes(member.hero, ranks);
          });
          await confirmObserved(
            environment,
            subject,
            (party) => settled(party)
              ? { state: "confirmed", value: undefined }
              : { state: "waiting" },
          );
          completedChanges += 1;
        }
      }

      if (member.behaviour !== null) {
        const behaviour = BEHAVIOUR_IDS[member.behaviour];
        const live = environment.party().heroes
          .find((hero) => hero.hero === member.hero);
        if (live?.behaviour !== member.behaviour) {
          writableParty(environment);
          const subject = `${heroLabel(member.hero)}'s behaviour`;
          send(environment, subject, () => {
            environment.commands.setHeroBehaviour(member.hero, behaviour);
          });
          await confirmObserved(
            environment,
            subject,
            (party) => party.heroes.find(
              (hero) => hero.hero === member.hero)?.behaviour === member.behaviour
              ? { state: "confirmed", value: undefined }
              : { state: "waiting" },
          );
          completedChanges += 1;
        }
      }
    }
    const finalHeroes = writableParty(environment).heroes.map(({ hero }) => hero);
    if (finalHeroes.length !== wantedHeroes.size
      || finalHeroes.some((hero) => !wantedHeroes.has(hero))) {
      throw new ApplyRefused("the final party roster did not match the team");
    }
  } catch (cause) {
    if (cause instanceof ApplyRefused || cause instanceof ApplyCancelled) {
      const confirmed = completedChanges === 1
        ? "1 change was confirmed"
        : `${completedChanges} changes were confirmed`;
      const wasCancelled = cause instanceof ApplyCancelled;
      emit(
        environment,
        wasCancelled ? "cancelled" : "failed",
        cause.message,
        cause instanceof ApplyRefused ? cause.elapsedMs : 0,
      );
      const error = new Error(
        `${cause.message}. ${confirmed} before Apply stopped; the party window `
        + "shows where it got to.",
        { cause },
      );
      if (wasCancelled) error.name = "AbortError";
      throw error;
    }
    emit(
      environment,
      "failed",
      cause instanceof Error ? cause.message : "Team Apply failed",
    );
    throw cause;
  }

  return Object.freeze({
    commandId,
    completedChanges,
    // Named, not counted. "Guild Wars skipped a skill" is not actionable; the
    // skill it skipped tells the player it is one they have not unlocked.
    skippedSkills: Object.freeze([...skipped]),
  });
}
