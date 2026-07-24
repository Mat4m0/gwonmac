import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readToolboxSnapshot } from "../../src/renderer/toolbox.js";

const MAGIC = 0x42545747;

function snapshot(overrides = {}) {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 64, true);
  view.setUint32(8, overrides.sequence ?? 2, true);
  view.setUint32(12, overrides.flags ?? 7, true);
  view.setUint32(16, overrides.tickCount ?? 40, true);
  view.setUint32(20, overrides.mapId ?? 133, true);
  view.setUint32(24, overrides.instanceType ?? 0, true);
  view.setUint32(28, overrides.playerId ?? 7, true);
  view.setFloat32(32, overrides.playerX ?? -9827.3, true);
  view.setFloat32(36, overrides.playerY ?? 34130.2, true);
  view.setUint32(40, overrides.targetId ?? 9, true);
  view.setUint32(44, overrides.targetType ?? 0xdb, true);
  view.setFloat32(48, overrides.targetX ?? -9700, true);
  view.setFloat32(52, overrides.targetY ?? 34100, true);
  view.setFloat32(56, overrides.distance ?? 130.8, true);
  view.setUint32(60, overrides.rangeBand ?? 1, true);
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
  });
});
