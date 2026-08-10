import assert from "node:assert/strict";
import test from "node:test";
import {
  createTeamApplyCommands,
  TEAM_COMMAND_PAYLOAD_BYTES,
  type EnhancementCommandEnqueue,
} from "../../src/renderer/enhancement-team-commands.ts";
import type { ToolboxObservation } from "../../src/shared/builds/live-party.ts";
import { heroId } from "../../src/shared/builds/library.ts";

const PLAYER_AGENT = 7;
const PAYLOAD = 0x100;

const observation: ToolboxObservation = {
  status: "ready",
  party: {
    status: "ready",
    slots: [{
      index: 0,
      occupied: true,
      hero: null,
      agentId: PLAYER_AGENT,
      level: 20,
      professions: [1, 2],
      behaviour: null,
      skills: null,
      disabled: null,
      attributes: null,
    }, {
      index: 1, occupied: true, hero: 6, agentId: 11, level: 20,
      professions: [1, 2], behaviour: 1, skills: null, disabled: null,
      attributes: null,
    }],
  },
};

test("the closed team surface selects only its reviewed opcodes and payloads", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const sent: unknown[][] = [];
  const send: EnhancementCommandEnqueue = (opcode, a0, a1, a2, a3) => {
    const call: unknown[] = [opcode, a0, a1, a2, a3];
    if (opcode === 93) {
      call.push([...new Uint32Array(memory.buffer, a2, a1)]);
    } else if (opcode === 16) {
      call.push(
        [...new Uint32Array(memory.buffer, a2, a1)],
        [...new Uint32Array(memory.buffer, a3, a1)],
      );
    }
    sent.push(call);
    return 1;
  };
  const commands = createTeamApplyCommands({
    memory,
    payloadPointer: PAYLOAD,
    send,
    ready: () => observation,
  });

  commands.cancelPending();
  commands.setHardMode(true);
  commands.setPlayerSecondary(2);
  commands.setPlayerSkills([1, 2, 3]);
  commands.setPlayerAttributes([[17, 7], [19, 12]]);
  commands.addHero(heroId(6));
  commands.kickAllHeroes();
  commands.kickHero(heroId(7));
  commands.setHeroBehaviour(heroId(6), 1);
  commands.setHeroSecondary(heroId(6), 3);
  commands.setHeroSkills(heroId(6), [4, 5]);
  commands.setHeroAttributes(heroId(6), [[1, 10]]);

  assert.deepEqual(sent, [
    [0, 0, 0, 0, 0],
    [155, 1, 0, 0, 0],
    [65, PLAYER_AGENT, 2, 0, 0],
    [93, PLAYER_AGENT, 3, PAYLOAD, 0, [1, 2, 3]],
    [16, PLAYER_AGENT, 2, PAYLOAD + 8 * 4, PAYLOAD + 24 * 4, [17, 19], [7, 12]],
    [30, 6, 0, 0, 0],
    [31, 0x26, 0, 0, 0],
    [31, 7, 0, 0, 0],
    [21, 11, 1, 0, 0],
    [65, 11, 3, 0, 0],
    [93, 11, 2, PAYLOAD, 0, [4, 5]],
    [16, 11, 1, PAYLOAD + 8 * 4, PAYLOAD + 24 * 4, [1], [10]],
  ]);
  assert.equal(TEAM_COMMAND_PAYLOAD_BYTES, 160);
});

test("invalid values are refused before the command queue", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let sends = 0;
  const commands = createTeamApplyCommands({
    memory,
    payloadPointer: PAYLOAD,
    send: () => { sends += 1; return 1; },
    ready: () => observation,
  });

  assert.throws(() => commands.setHardMode(1 as unknown as boolean), /enabled or disabled/);
  assert.throws(() => commands.setHeroSkills(heroId(7), [1]), /not in the observed party/);
  assert.throws(() => commands.setHeroSkills(heroId(6), Array(9).fill(1)), /holds 8 skills/);
  assert.throws(() => commands.setHeroAttributes(heroId(6), [[45, 1]]), /known id/);
  assert.throws(() => commands.setHeroBehaviour(heroId(6), 3), /not one the client defines/);
  assert.throws(() => commands.addHero(heroId(40)), /not a hero/);
  assert.equal(sends, 0);
});

test("hero identity is resolved again for every packet and rejected packets throw", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let agentId = 11;
  const sent: number[][] = [];
  const current = (): ToolboxObservation => ({
    ...observation,
    party: {
      ...observation.party!,
      slots: observation.party!.slots!.map((slot) => slot.hero === 6
        ? { ...slot, agentId }
        : slot),
    },
  });
  const commands = createTeamApplyCommands({
    memory,
    payloadPointer: PAYLOAD,
    ready: current,
    send: (opcode, a0, a1, a2, a3) => {
      sent.push([opcode, a0, a1, a2, a3]);
      return opcode === 93 ? 0 : 1;
    },
  });

  commands.setHeroBehaviour(heroId(6), 1);
  agentId = 22;
  assert.throws(
    () => commands.setHeroSkills(heroId(6), [1]),
    /command queue is busy/,
  );
  assert.deepEqual(sent.map((call) => call.slice(0, 2)), [[21, 11], [93, 22]]);
});
