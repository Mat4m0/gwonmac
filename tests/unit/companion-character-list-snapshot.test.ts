import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPANION_ABI } from "../../src/shared/companion-abi.ts";
import {
  readCompanionCharacterList,
  sameCharacterListPresentation,
} from "../../src/renderer/companion-character-list-snapshot.ts";

const POINTER = 64;

function snapshot() {
  const buffer = new ArrayBuffer(POINTER + COMPANION_ABI.characterList.bytes);
  const view = new DataView(buffer, POINTER);
  view.setUint32(0, 0x4843_5747, true);
  view.setUint16(4, COMPANION_ABI.characterList.abi, true);
  view.setUint16(6, COMPANION_ABI.characterList.bytes, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, 0, true);
  for (const [index, unit] of [..."Rudolph", "\0"].entries()) {
    view.setUint16(24 + index * 2, unit.charCodeAt(0), true);
  }
  view.setUint32(64, 3, true);
  view.setUint32(68, 4, true);
  view.setUint32(72, 0, true);
  view.setUint32(76, 2, true);
  view.setUint32(80, 20, true);
  view.setUint32(84, 55, true);
  view.setUint32(88, 0x7654_3210, true);
  view.setUint32(92, 0xfedc_ba98, true);
  return { buffer, view };
}

describe("companion character-list snapshot", () => {
  it("decodes only a complete bounded publication", () => {
    const { buffer } = snapshot();
    assert.deepEqual(readCompanionCharacterList(buffer, POINTER), {
      status: "ready",
      sequence: 2,
      selectedIndex: 0,
      characters: [{
        name: "Rudolph",
        characterKey: "fedcba9876543210",
        primaryProfession: 3,
        secondaryProfession: 4,
        characterType: "roleplaying",
        campaign: 2,
        level: 20,
        mapId: 55,
      }],
    });
  });

  it("rejects torn, duplicate, unterminated, and out-of-range records", () => {
    for (const mutate of [
      (view: DataView) => view.setUint32(8, 3, true),
      (view: DataView) => view.setUint32(16, 65, true),
      (view: DataView) => view.setUint32(64, 11, true),
      (view: DataView) => view.setUint32(68, 11, true),
      (view: DataView) => { view.setUint32(88, 0, true); view.setUint32(92, 0, true); },
      (view: DataView) => {
        for (let index = 0; index < 20; index += 1) view.setUint16(24 + index * 2, 65, true);
      },
    ]) {
      const { buffer, view } = snapshot();
      mutate(view);
      assert.equal(readCompanionCharacterList(buffer, POINTER).status, "waiting");
    }

    const { buffer, view } = snapshot();
    view.setUint32(16, 2, true);
    view.setUint32(20, 0xffff_ffff, true);
    new Uint8Array(buffer, POINTER + 96, 72).set(new Uint8Array(buffer, POINTER + 24, 72));
    assert.equal(readCompanionCharacterList(buffer, POINTER).status, "waiting");

    for (const [index, unit] of [..."Comet", "\0"].entries()) {
      view.setUint16(96 + index * 2, unit.charCodeAt(0), true);
    }
    assert.equal(
      readCompanionCharacterList(buffer, POINTER).status,
      "waiting",
      "a duplicate privacy-safe key must fail even when names differ",
    );
  });

  it("distinguishes absence and root warming without exposing partial records", () => {
    const { buffer, view } = snapshot();
    view.setUint32(12, 4, true);
    view.setUint32(16, 0, true);
    view.setUint32(20, 0xffff_ffff, true);
    assert.equal(readCompanionCharacterList(buffer, POINTER).status, "absent");
    view.setUint32(12, 2, true);
    view.setUint32(16, 1, true);
    assert.deepEqual(readCompanionCharacterList(buffer, POINTER), {
      status: "warming", sequence: 2,
    });
  });

  it("does not repaint for sequence-only publications", () => {
    const first = readCompanionCharacterList(snapshot().buffer, POINTER);
    const secondSnapshot = snapshot();
    secondSnapshot.view.setUint32(8, 4, true);
    const second = readCompanionCharacterList(secondSnapshot.buffer, POINTER);
    assert.equal(sameCharacterListPresentation(first, second), true);

    secondSnapshot.view.setUint32(20, 0xffff_ffff, true);
    const changed = readCompanionCharacterList(secondSnapshot.buffer, POINTER);
    assert.equal(sameCharacterListPresentation(first, changed), false);
  });
});
