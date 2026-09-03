/**
 * Exercises the renderer trust boundary for the fixed friend snapshot without
 * depending on native records or an ArenaNet client artifact.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCompanionFriends } from "../../src/renderer/companion-friend-snapshot.ts";
import { COMPANION_ABI } from "../../src/shared/companion-abi.ts";

function snapshot(): ArrayBuffer {
  const buffer = new ArrayBuffer(COMPANION_ABI.friends.bytes);
  const view = new DataView(buffer);
  view.setUint32(0, 0x5246_5747, true);
  view.setUint16(4, COMPANION_ABI.friends.abi, true);
  view.setUint16(6, COMPANION_ABI.friends.bytes, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 7, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, 1, true);
  view.setUint32(28, 2, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 449, true);
  for (const [offset, value] of [[40, "Romi"], [80, "Example Ranger"]] as const) {
    [...value].forEach((character, index) => view.setUint16(
      offset + index * 2, character.codePointAt(0)!, true,
    ));
  }
  return buffer;
}

describe("companion friend snapshot", () => {
  it("decodes only pointer-free friend fields", () => {
    assert.deepEqual(readCompanionFriends(snapshot(), 0), {
      status: "ready", sequence: 2, generation: 7,
      friends: [{ key: "0000000200000001", status: "online", mapId: 449,
        alias: "Romi", character: "Example Ranger" }],
    });
  });

  it("rejects torn, oversized, duplicate, and unterminated records", () => {
    for (const mutate of [
      (view: DataView) => view.setUint32(8, 3, true),
      (view: DataView) => view.setUint32(20, 129, true),
      (view: DataView) => { view.setUint32(20, 2, true); view.setUint32(120, 1, true); view.setUint32(124, 2, true); },
      (view: DataView) => { for (let i = 0; i < 20; i += 1) view.setUint16(40 + i * 2, 65, true); },
    ]) {
      const buffer = snapshot(); mutate(new DataView(buffer));
      assert.notEqual(readCompanionFriends(buffer, 0).status, "ready");
    }
  });
});
