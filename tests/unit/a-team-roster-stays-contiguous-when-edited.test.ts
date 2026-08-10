import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildId,
  compactTeamMembers,
  heroId,
  moveTeamMember,
  removeTeamMember,
  teamSlotsOf,
  type TeamSlot,
} from "../../src/shared/builds/library.js";

const empty = (): TeamSlot => ({ build: null, hero: null, behaviour: "guard" });
const member = (hero: number, build: string, behaviour: TeamSlot["behaviour"]): TeamSlot => ({
  hero: heroId(hero),
  build: buildId(build),
  behaviour,
});
const player: TeamSlot = { hero: null, build: buildId("player"), behaviour: null };

describe("the stored team roster", () => {
  it("compacts complete member records without moving the player", () => {
    const devona = member(38, "devona", "fight");
    const althea = member(39, "althea", "guard");
    const slots = teamSlotsOf((position) => position === 0
      ? player
      : position === 2 ? devona : position === 5 ? althea : empty());

    const compacted = compactTeamMembers(slots);

    assert.deepEqual(compacted[0], player);
    assert.deepEqual(compacted[1], devona);
    assert.deepEqual(compacted[2], althea);
    assert.deepEqual(compacted.slice(3), Array.from({ length: 5 }, empty));
  });

  it("preserves repairable legacy records while compacting", () => {
    const legacy: TeamSlot = {
      hero: null,
      build: buildId("orphaned-build"),
      behaviour: "avoid",
    };
    const slots = teamSlotsOf((position) => position === 0
      ? player
      : position === 4 ? legacy : empty());

    assert.deepEqual(compactTeamMembers(slots)[1], legacy);
  });

  it("removes the whole member and closes the gap", () => {
    const devona = member(38, "devona", "fight");
    const althea = member(39, "althea", "guard");
    const slots = teamSlotsOf((position) => position === 0
      ? player
      : position === 1 ? devona : position === 2 ? althea : empty());

    const removed = removeTeamMember(slots, 1);

    assert.deepEqual(removed[1], althea);
    assert.deepEqual(removed[2], empty());
  });

  it("moves configured members up, down, and to the last configured position", () => {
    const a = member(38, "a", "fight");
    const b = member(39, "b", "guard");
    const c = member(6, "c", "avoid");
    const slots = teamSlotsOf((position) => position === 0
      ? player
      : [a, b, c][position - 1] ?? empty());

    assert.deepEqual(moveTeamMember(slots, 3, 1).slice(1, 4), [c, a, b]);
    assert.deepEqual(moveTeamMember(slots, 1, 2).slice(1, 4), [b, a, c]);
    assert.deepEqual(moveTeamMember(slots, 1, 7).slice(1, 4), [b, c, a]);
  });

  it("does not move the player or an empty source", () => {
    const slots = teamSlotsOf((position) => position === 0 ? player : empty());

    assert.equal(moveTeamMember(slots, 0, 2), slots);
    assert.equal(moveTeamMember(slots, 3, 1), slots);
    assert.equal(removeTeamMember(slots, 0), slots);
  });
});
