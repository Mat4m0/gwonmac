import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANION_PLAY_REGION_BYTES,
  COMPANION_PLAY_REGION_ABI,
  readCompanionPlayRegion,
} from "../../src/renderer/companion-play-region-snapshot.ts";

function snapshot(overrides: Readonly<{
  magic?: number;
  abi?: number;
  bytes?: number;
  sequence?: number;
  flags?: number;
  mapId?: number;
  instanceType?: number;
  playRegion?: number;
  characterLow?: number;
  characterHigh?: number;
  unlockedMapWords?: readonly number[];
}> = {}) {
  const buffer = new ArrayBuffer(COMPANION_PLAY_REGION_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, overrides.magic ?? 0x5250_5747, true);
  view.setUint16(4, overrides.abi ?? COMPANION_PLAY_REGION_ABI, true);
  view.setUint16(6, overrides.bytes ?? COMPANION_PLAY_REGION_BYTES, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  view.setUint32(12, overrides.flags ?? 1, true);
  view.setUint32(16, overrides.mapId ?? 133, true);
  view.setUint32(20, overrides.instanceType ?? 0, true);
  view.setUint32(24, overrides.playRegion ?? 1, true);
  view.setUint32(28, overrides.characterLow ?? 0, true);
  view.setUint32(32, overrides.characterHigh ?? 0, true);
  overrides.unlockedMapWords?.forEach((word, index) =>
    view.setUint32(36 + index * 4, word, true));
  return buffer;
}

describe("play-region snapshot ABI", () => {
  it("decodes only a complete certified PvE or PvP record", () => {
    assert.deepEqual(readCompanionPlayRegion(snapshot(), 0), {
      status: "ready",
      sequence: 2,
      mapId: 133,
      instanceType: 0,
      playRegion: "pve",
      characterKey: null,
      unlockedMapWords: null,
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({
      mapId: 248,
      instanceType: 1,
      playRegion: 2,
    }), 0), {
      status: "ready",
      sequence: 2,
      mapId: 248,
      instanceType: 1,
      playRegion: "pvp",
      characterKey: null,
      unlockedMapWords: null,
    });
  });

  it("fails closed for memory, torn headers, contradictory flags, and values", () => {
    assert.deepEqual(readCompanionPlayRegion(new ArrayBuffer(COMPANION_PLAY_REGION_BYTES - 1), 0), {
      status: "waiting", reason: "memory",
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ sequence: 3 }), 0), {
      status: "waiting", reason: "writing",
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ magic: 0 }), 0), {
      status: "waiting", reason: "snapshot",
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ flags: 3 }), 0), {
      status: "waiting", reason: "snapshot",
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ mapId: 2_001 }), 0), {
      status: "waiting", reason: "corrupt",
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ playRegion: 0 }), 0), {
      status: "waiting", reason: "corrupt",
    });
  });

  it("requires loading and unavailable publications to clear every value", () => {
    assert.deepEqual(readCompanionPlayRegion(snapshot({
      flags: 2, mapId: 0, instanceType: 0, playRegion: 0,
    }), 0), { status: "waiting", reason: "loading" });
    assert.deepEqual(readCompanionPlayRegion(snapshot({
      flags: 0, mapId: 0, instanceType: 0, playRegion: 0,
    }), 0), { status: "waiting", reason: "game" });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ flags: 2 }), 0), {
      status: "waiting", reason: "corrupt",
    });
    assert.deepEqual(readCompanionPlayRegion(snapshot({ flags: 0 }), 0), {
      status: "waiting", reason: "corrupt",
    });
  });
});
