import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  readToolboxSnapshot,
} from "../../src/renderer/toolbox-snapshot.js";

const MAGIC = 0x42545747;

function snapshot(overrides = {}) {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  const flags = overrides.flags ?? 7;
  const hasPlayer = (flags & 2) !== 0;
  const hasTarget = (flags & 4) !== 0;
  view.setUint32(12, flags, true);
  view.setUint32(16, overrides.tickCount ?? 40, true);
  view.setUint32(20, overrides.mapId ?? (hasPlayer ? 133 : 0), true);
  view.setUint32(24, overrides.instanceType ?? 0, true);
  view.setUint32(28, overrides.playerId ?? (hasPlayer ? 7 : 0), true);
  view.setFloat32(32, overrides.playerX ?? (hasPlayer ? -9827.3 : 0), true);
  view.setFloat32(36, overrides.playerY ?? (hasPlayer ? 34130.2 : 0), true);
  view.setUint32(40, overrides.targetId ?? (hasTarget ? 9 : 0), true);
  view.setUint32(44, overrides.targetType ?? (hasTarget ? 0xdb : 0), true);
  view.setFloat32(48, overrides.targetX ?? (hasTarget ? -9700 : 0), true);
  view.setFloat32(52, overrides.targetY ?? (hasTarget ? 34100 : 0), true);
  view.setFloat32(56, overrides.distance ?? (hasTarget ? 130.8 : 0), true);
  view.setUint32(60, overrides.rangeBand ?? (hasTarget ? 1 : 0), true);
  return buffer;
}

describe("Toolbox snapshot ABI", () => {
  it("decodes stable player and target state", () => {
    const state = readToolboxSnapshot(snapshot(), 0);
    assert.equal(state.status, "ready");
    assert.equal(state.mapId, 133);
    assert.equal(state.instanceName, "Outpost");
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.equal(state.targetKind, "Living");
    assert.equal(state.rangeName, "Adjacent");
  });

  it("rejects torn, incompatible, loading, and absent-target snapshots", () => {
    assert.equal(
      readToolboxSnapshot(snapshot({ sequence: 3 }), 0).reason,
      "writing",
    );
    const corrupt = snapshot();
    new DataView(corrupt).setUint16(4, 2, true);
    assert.equal(readToolboxSnapshot(corrupt, 0).reason, "snapshot");
    assert.equal(
      readToolboxSnapshot(snapshot({ flags: 8 }), 0).reason,
      "loading",
    );
    const noTarget = readToolboxSnapshot(snapshot({ flags: 3 }), 0);
    assert.equal(noTarget.status, "ready");
    assert.equal(noTarget.targetValid, false);
  });

  it("rejects unknown flags, invalid identities, bands, and non-finite values", () => {
    assert.equal(
      readToolboxSnapshot(snapshot({ flags: 0x10 }), 0).reason,
      "snapshot",
    );
    assert.equal(
      readToolboxSnapshot(snapshot({ playerId: 0 }), 0).reason,
      "corrupt",
    );
    assert.equal(
      readToolboxSnapshot(snapshot({ rangeBand: 9 }), 0).reason,
      "corrupt",
    );
    assert.equal(
      readToolboxSnapshot(snapshot({ distance: Number.NaN }), 0).reason,
      "corrupt",
    );
  });
});

describe("Toolbox companion kernel", () => {
  it("calls the original once and publishes a checked snapshot", async () => {
    const bytes = await readFile("build/renderer/toolbox-kernel.wasm");
    const memory = new WebAssembly.Memory({ initial: 256 });
    let originalCalls = 0;
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: { memory },
      game: {
        toolbox_tick_original: () => {
          originalCalls += 1;
        },
      },
    });

    const snapshotPointer = 0x1000;
    const configPointer = 0x1100;
    const config = new Uint32Array(memory.buffer, configPointer, 16);
    const contextRoot = 0x2000;
    const contexts = 0x2100;
    const game = 0x2200;
    const character = 0x2300;
    const agentArray = 0x2400;
    const agentBuffer = 0x2500;
    const player = 0x2600;
    const target = 0x2800;
    const targetIdAddress = 0x2a00;
    config.set([
      contextRoot, agentArray, targetIdAddress, 6, 0x44, 0x198, 0x19c,
      0x234, 0x23c, 0x2ac, 0x2c, 0x74, 0x78, 0x9c, 0xf4, 0xf6,
    ]);
    const view = new DataView(memory.buffer);
    view.setUint32(contextRoot, contexts, true);
    view.setUint32(contexts + 24, game, true);
    view.setUint32(game + 0x44, character, true);
    view.setUint32(character + 0x198, 133, true);
    view.setUint32(character + 0x19c, 0, true);
    view.setUint32(character + 0x234, 133, true);
    view.setUint32(character + 0x23c, 0, true);
    view.setUint32(character + 0x2ac, 42, true);
    view.setUint32(agentArray, agentBuffer, true);
    view.setUint32(agentArray + 4, 16, true);
    view.setUint32(agentArray + 8, 10, true);
    view.setUint32(agentBuffer + 7 * 4, player, true);
    view.setUint32(agentBuffer + 9 * 4, target, true);
    view.setUint32(player + 0x2c, 7, true);
    view.setFloat32(player + 0x74, 10, true);
    view.setFloat32(player + 0x78, 20, true);
    view.setUint32(player + 0x9c, 0xdb, true);
    view.setUint16(player + 0xf4, 42, true);
    view.setUint16(player + 0xf6, 0x3000, true);
    view.setUint32(target + 0x2c, 9, true);
    view.setFloat32(target + 0x74, 110, true);
    view.setFloat32(target + 0x78, 20, true);
    view.setUint32(target + 0x9c, 0xdb, true);
    view.setUint32(targetIdAddress, 9, true);

    assert.equal(
      instance.exports.toolbox_init(0xffff_fffc, 64, configPointer, 64),
      0,
    );
    assert.equal(
      instance.exports.toolbox_init(snapshotPointer, 63, configPointer, 64),
      0,
    );
    assert.equal(
      instance.exports.toolbox_init(snapshotPointer, 64, configPointer, 64),
      1,
    );
    instance.exports.toolbox_tick(123);
    assert.equal(originalCalls, 1);
    const state = readToolboxSnapshot(memory.buffer, snapshotPointer);
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.ok(Math.abs(state.distance - 100) < 0.1);
    assert.equal(state.rangeName, "Adjacent");

    const boundaries = [
      [166, 1],
      [166.25, 2],
      [252.25, 3],
      [322.25, 4],
      [1_012.25, 5],
      [1_248.25, 6],
      [2_500.25, 7],
      [5_000.25, 8],
    ];
    for (const [distance, band] of boundaries) {
      view.setFloat32(target + 0x74, 10 + distance, true);
      instance.exports.toolbox_tick(123);
      assert.equal(
        readToolboxSnapshot(memory.buffer, snapshotPointer).rangeBand,
        band,
      );
    }

    view.setUint32(targetIdAddress, 0, true);
    instance.exports.toolbox_tick(123);
    assert.equal(
      readToolboxSnapshot(memory.buffer, snapshotPointer).targetValid,
      false,
    );

    view.setUint32(character + 0x23c, 2, true);
    instance.exports.toolbox_tick(123);
    const loading = readToolboxSnapshot(memory.buffer, snapshotPointer);
    assert.equal(loading.reason, "loading");
    assert.equal("playerId" in loading, false);
    assert.equal("targetId" in loading, false);

    view.setUint32(character + 0x23c, 0, true);
    view.setFloat32(player + 0x74, Number.NaN, true);
    instance.exports.toolbox_tick(123);
    assert.equal(
      readToolboxSnapshot(memory.buffer, snapshotPointer).reason,
      "game",
    );

    config[0] = 0xffff_fffc;
    assert.equal(
      instance.exports.toolbox_init(snapshotPointer, 64, configPointer, 64),
      1,
    );
    instance.exports.toolbox_tick(123);
    assert.equal(
      readToolboxSnapshot(memory.buffer, snapshotPointer).reason,
      "game",
    );
    assert.equal(originalCalls, boundaries.length + 5);
  });
});
