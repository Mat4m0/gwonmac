/**
 * The closed, certified team-command surface exposed by an Enhancement build.
 *
 * Lifecycle and memory ownership stay in `enhancements.ts`; this module owns
 * only the command boundary: validating domain values, copying bounded payloads
 * into the one scratch region, and selecting one of the reviewed opcodes.
 * Keeping those concerns apart prevents the installer from becoming the place
 * every new team operation adds another branch.
 */
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { TeamApplyCommands } from "../shared/builds/team-apply-runner.js";

const SKILL_WORDS = 8;
const ATTRIBUTE_WORDS = 16;

/** The fixed scratch-region size the installer allocates for these commands. */
export const TEAM_COMMAND_PAYLOAD_BYTES =
  (SKILL_WORDS + ATTRIBUTE_WORDS * 2) * Uint32Array.BYTES_PER_ELEMENT;

export type EnhancementCommandThunk = (
  opcode: number,
  a0: number,
  a1: number,
  a2: number,
  a3: number,
) => number;

type TeamCommandOptions = Readonly<{
  memory: WebAssembly.Memory;
  payloadPointer: number;
  send: EnhancementCommandThunk;
  /** Bounded semantic command evidence for unpackaged development launches. */
  development?: boolean;
  /** Refuses unless commands are currently safe and returns the fresh party. */
  ready(): ToolboxObservation;
}>;

export function createTeamApplyCommands({
  memory,
  payloadPointer,
  send,
  ready,
  development = false,
}: TeamCommandOptions): TeamApplyCommands {
  const hero = (heroId: number) => {
    if (!Number.isInteger(heroId) || heroId < 1 || heroId > 39) {
      throw new Error(`hero id ${heroId} is not a hero`);
    }
  };
  const agent = (agentId: number) => {
    if (!Number.isInteger(agentId) || agentId < 1) {
      throw new Error(`agent id ${agentId} is not an agent`);
    }
  };
  const validProfession = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new Error(`profession ${value} is not one the client defines`);
    }
  };
  // A fresh view every call: `memory.buffer` detaches when the heap grows.
  const payload = (offset: number, values: readonly number[]) => {
    const words = new Uint32Array(
      memory.buffer,
      payloadPointer + offset * Uint32Array.BYTES_PER_ELEMENT,
      values.length,
    );
    words.set(values);
    return payloadPointer + offset * Uint32Array.BYTES_PER_ELEMENT;
  };
  const playerAgent = (observed: ToolboxObservation) => {
    const player = observed.party?.slots?.[0];
    if (!player?.occupied || !player.agentId) {
      throw new Error("the observed player has no commandable agent");
    }
    agent(player.agentId);
    return player.agentId;
  };
  const heroAgent = (heroId: number, observed: ToolboxObservation) => {
    hero(heroId);
    const member = observed.party?.slots?.find(
      (slot) => slot.occupied && slot.hero === heroId,
    );
    if (!member?.agentId) throw new Error(`hero ${heroId} is not in the observed party`);
    agent(member.agentId);
    return member.agentId;
  };
  const sent = (
    operation: string,
    opcode: number,
    result: number,
    fields: Readonly<Record<string, number | boolean>> = {},
  ) => {
    if (development) {
      console.debug(`[tools:dev] command ${JSON.stringify({
        operation,
        opcode,
        accepted: result === 1,
        ...fields,
      })}`);
    }
    if (result !== 1) throw new Error("Guild Wars refused the command packet");
  };
  const skills = (agentId: number, skillIds: readonly number[]) => {
    if (skillIds.length > SKILL_WORDS) {
      throw new Error(`a skill bar holds ${SKILL_WORDS} skills`);
    }
    if (skillIds.some((id) => !Number.isInteger(id) || id < 0)) {
      throw new Error("every skill must be a non-negative id");
    }
    const at = payload(0, skillIds);
    sent("skills", 93, send(93, agentId, skillIds.length, at, 0), {
      agentId,
      count: skillIds.length,
    });
  };
  const attributes = (
    agentId: number,
    ranks: readonly (readonly [attribute: number, rank: number])[],
  ) => {
    if (ranks.length > ATTRIBUTE_WORDS) {
      throw new Error(`at most ${ATTRIBUTE_WORDS} attributes`);
    }
    if (ranks.some(([id, rank]) =>
      !Number.isInteger(id) || id < 0 || id > 44
      || !Number.isInteger(rank) || rank < 0 || rank > 12
    )) {
      throw new Error("every attribute must be a known id at a rank of 0-12");
    }
    const ids = payload(SKILL_WORDS, ranks.map(([id]) => id));
    const levels = payload(
      SKILL_WORDS + ATTRIBUTE_WORDS,
      ranks.map(([, rank]) => rank),
    );
    sent("attributes", 16, send(16, agentId, ranks.length, ids, levels), {
      agentId,
      count: ranks.length,
    });
  };

  return Object.freeze({
    setHardMode(enabled: boolean) {
      ready();
      if (typeof enabled !== "boolean") {
        throw new Error("Hard Mode must be enabled or disabled");
      }
      sent("hard-mode", 155, send(155, enabled ? 1 : 0, 0, 0, 0), { enabled });
    },
    setPlayerSecondary(profession: number) {
      const observed = ready();
      const agentId = playerAgent(observed);
      validProfession(profession);
      sent("secondary", 65, send(65, agentId, profession, 0, 0), {
        agentId,
        profession,
      });
    },
    setPlayerSkills(skillIds: readonly number[]) {
      skills(playerAgent(ready()), skillIds);
    },
    setPlayerAttributes(
      ranks: readonly (readonly [attribute: number, rank: number])[],
    ) {
      attributes(playerAgent(ready()), ranks);
    },
    addHero(heroId: number) {
      ready();
      hero(heroId);
      sent("add-hero", 30, send(30, heroId, 0, 0, 0), { heroId });
    },
    kickHero(heroId: number) {
      ready();
      hero(heroId);
      sent("kick-hero", 31, send(31, heroId, 0, 0, 0), { heroId });
    },
    setHeroBehaviour(heroId: number, behaviour: number) {
      const agentId = heroAgent(heroId, ready());
      if (!Number.isInteger(behaviour) || behaviour < 0 || behaviour > 2) {
        throw new Error(`behaviour ${behaviour} is not one the client defines`);
      }
      sent("hero-behaviour", 21, send(21, agentId, behaviour, 0, 0), {
        heroId,
        agentId,
        behaviour,
      });
    },
    setHeroSecondary(heroId: number, profession: number) {
      const agentId = heroAgent(heroId, ready());
      validProfession(profession);
      sent("secondary", 65, send(65, agentId, profession, 0, 0), {
        heroId,
        agentId,
        profession,
      });
    },
    setHeroSkills(heroId: number, skillIds: readonly number[]) {
      skills(heroAgent(heroId, ready()), skillIds);
    },
    setHeroAttributes(
      heroId: number,
      ranks: readonly (readonly [attribute: number, rank: number])[],
    ) {
      attributes(heroAgent(heroId, ready()), ranks);
    },
  });
}
