import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  createKernel,
  decoded,
  DETAIL,
  FEATURE_GAME_SNAPSHOT,
  installGameGraph,
  readCompanionSnapshot,
  XUNLAI_CONFIG_START,
} from "../fixtures/enhancements.ts";

describe("Companion Xunlai access kernel", () => {
  it("publishes access from the player record without a party", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0, true);
    assert.equal(kernel.init({ features: FEATURE_GAME_SNAPSHOT }), 1);

    kernel.tick();
    const storageOnly = decoded(
      readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(storageOnly.xunlaiAccess, true);
    assert.equal(storageOnly.targetValid, false);
    assert.equal(storageOnly.targetId, 0);

    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerAccessFlags,
      0x2,
      true,
    );
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess,
      false,
    );

    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerAccessFlags,
      0,
      true,
    );
    const area = ADDRESSES.areaInfo + 133 * 0x7c;
    kernel.view.setUint32(area + 0x10, 0x1, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess,
      false,
    );

    kernel.view.setUint32(area + 0x10, 0, true);
    kernel.view.setUint32(area + DETAIL.areaInfoType, 7, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess,
      false,
    );

    kernel.view.setUint32(area + DETAIL.areaInfoType, 28, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess,
      null,
    );

    kernel.view.setUint32(area + DETAIL.areaInfoType, 0, true);
    kernel.view.setUint32(ADDRESSES.character + 0x19c, 1, true);
    kernel.view.setUint32(ADDRESSES.character + 0x23c, 1, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess,
      false,
    );
  });

  it("revokes access on corrupt records and character transitions", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_GAME_SNAPSHOT }), 1);
    const access = () =>
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess;

    kernel.tick();
    assert.equal(access(), true);

    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerAgentId,
      9,
      true,
    );
    kernel.tick();
    assert.equal(access(), null);

    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerAgentId,
      7,
      true,
    );
    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerNumber,
      43,
      true,
    );
    kernel.tick();
    assert.equal(access(), null);

    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerNumber,
      42,
      true,
    );
    kernel.view.setUint32(ADDRESSES.world + DETAIL.players + 4, 0, true);
    kernel.tick();
    assert.equal(access(), null);

    kernel.view.setUint32(ADDRESSES.world + DETAIL.players + 4, 1, true);
    kernel.view.setUint32(
      ADDRESSES.playerRecordBuffer + DETAIL.playerAccessFlags,
      0x2,
      true,
    );
    kernel.tick();
    assert.equal(access(), false);
  });

  it("publishes no access claim when the optional proof is not certified", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    kernel.config.fill(0, XUNLAI_CONFIG_START, XUNLAI_CONFIG_START + 6);
    assert.equal(kernel.init({ features: FEATURE_GAME_SNAPSHOT }), 1);

    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .xunlaiAccess,
      null,
    );
  });
});
