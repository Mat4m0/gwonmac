import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decoded,
  readCompanionSnapshot,
  rejected,
  snapshot,
} from "../fixtures/enhancements.ts";

describe("Companion snapshot ABI", () => {
  it("decodes stable player and target state", () => {
    const state = decoded(readCompanionSnapshot(snapshot(), 0));
    assert.equal(state.status, "ready");
    assert.equal(state.mapId, 133);
    assert.equal(state.instanceName, "Outpost");
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.equal(state.targetKind, "Living");
    assert.equal(state.rangeName, "Adjacent");
    assert.equal(state.xunlaiAccess, null);
  });

  it("rejects torn, incompatible, loading, and absent-target snapshots", () => {
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ sequence: 3 }), 0)),
      "writing",
    );
    const corrupt = snapshot();
    new DataView(corrupt).setUint16(4, 1, true);
    assert.equal(rejected(readCompanionSnapshot(corrupt, 0)), "snapshot");
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 8 }), 0)),
      "loading",
    );
    const noTarget = decoded(readCompanionSnapshot(snapshot({ flags: 3 }), 0));
    assert.equal(noTarget.status, "ready");
    assert.equal(noTarget.targetValid, false);
  });

  it("decodes the Xunlai access tri-state and rejects impossible flags", () => {
    assert.equal(
      decoded(readCompanionSnapshot(snapshot({ flags: 3 | 0x10 }), 0))
        .xunlaiAccess,
      false,
    );
    assert.equal(
      decoded(readCompanionSnapshot(snapshot({ flags: 3 | 0x10 | 0x20 }), 0))
        .xunlaiAccess,
      true,
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 3 | 0x20 }), 0)),
      "snapshot",
    );
  });

  it("rejects unknown flags, invalid identities, bands, and non-finite values", () => {
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ flags: 0x40 }), 0)),
      "snapshot",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ playerId: 0 }), 0)),
      "corrupt",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ rangeBand: 9 }), 0)),
      "corrupt",
    );
    assert.equal(
      rejected(readCompanionSnapshot(snapshot({ distance: Number.NaN }), 0)),
      "corrupt",
    );
  });
});
