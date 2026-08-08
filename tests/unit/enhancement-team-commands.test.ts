import assert from "node:assert/strict";
import test from "node:test";
import {
  createTeamApplyCommands,
  TEAM_COMMAND_PAYLOAD_BYTES,
  type EnhancementCommandThunk,
} from "../../src/renderer/enhancement-team-commands.ts";
import type { ToolboxObservation } from "../../src/shared/builds/live-party.ts";

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
    }],
  },
};

test("the closed team surface selects only its reviewed opcodes and payloads", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const sent: unknown[][] = [];
  const send: EnhancementCommandThunk = (opcode, a0, a1, a2, a3) => {
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

  assert.equal(commands.setHardMode(true), true);
  assert.equal(commands.setPlayerSecondary(PLAYER_AGENT, 2), true);
  assert.equal(commands.setPlayerSkills(PLAYER_AGENT, [1, 2, 3]), true);
  assert.equal(commands.setPlayerAttributes(PLAYER_AGENT, [[17, 7], [19, 12]]), true);
  assert.equal(commands.addHero(6), true);
  assert.equal(commands.kickHero(7), true);
  assert.equal(commands.setHeroBehaviour(11, 1), true);
  assert.equal(commands.setHeroSecondary(11, 3), true);
  assert.equal(commands.setHeroSkills(11, [4, 5]), true);
  assert.equal(commands.setHeroAttributes(11, [[1, 10]]), true);

  assert.deepEqual(sent, [
    [155, 1, 0, 0, 0],
    [65, PLAYER_AGENT, 2, 0, 0],
    [93, PLAYER_AGENT, 3, PAYLOAD, 0, [1, 2, 3]],
    [16, PLAYER_AGENT, 2, PAYLOAD + 8 * 4, PAYLOAD + 24 * 4, [17, 19], [7, 12]],
    [30, 6, 0, 0, 0],
    [31, 7, 0, 0, 0],
    [21, 11, 1, 0, 0],
    [65, 11, 3, 0, 0],
    [93, 11, 2, PAYLOAD, 0, [4, 5]],
    [16, 11, 1, PAYLOAD + 8 * 4, PAYLOAD + 24 * 4, [1], [10]],
  ]);
  assert.equal(TEAM_COMMAND_PAYLOAD_BYTES, 160);
});

test("invalid values are refused before the command thunk", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let sends = 0;
  const commands = createTeamApplyCommands({
    memory,
    payloadPointer: PAYLOAD,
    send: () => { sends += 1; return 1; },
    ready: () => observation,
  });

  assert.throws(() => commands.setHardMode(1 as unknown as boolean), /enabled or disabled/);
  assert.throws(() => commands.setPlayerSkills(8, [1]), /not the observed player/);
  assert.throws(() => commands.setHeroSkills(11, Array(9).fill(1)), /holds 8 skills/);
  assert.throws(() => commands.setHeroAttributes(11, [[45, 1]]), /known id/);
  assert.throws(() => commands.setHeroBehaviour(11, 3), /not one the client defines/);
  assert.throws(() => commands.addHero(40), /not a hero/);
  assert.equal(sends, 0);
});
