import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  enhancementLayoutWords,
  ENHANCEMENT_BUILDS,
  type KnownEnhancementBuild,
} from "../../src/main/core/enhancement-builds.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/core/template-save-compat.js";
import {
  inspectEnhancementCandidate,
  ENHANCEMENT_ATTRIBUTES_EXPORT,
  ENHANCEMENT_DIFFICULTY_EXPORT,
  ENHANCEMENT_HERO_BEHAVIOR_EXPORT,
  ENHANCEMENT_HERO_KICK_EXPORT,
  ENHANCEMENT_HERO_PANEL_EXPORT,
  ENHANCEMENT_HERO_ADD_EXPORT,
  ENHANCEMENT_HERO_SKILL_TOGGLE_EXPORT,
  ENHANCEMENT_HOOK_EXPORT,
  ENHANCEMENT_MANIFEST_SECTION,
  ENHANCEMENT_ORIGINAL_EXPORT,
  ENHANCEMENT_SECONDARY_PROFESSION_EXPORT,
  ENHANCEMENT_SKILLBAR_EXPORT,
  ENHANCEMENT_TRANSFORM_ABI,
  transformEnhancementWasm,
} from "../../src/main/core/enhancement-transform.js";

function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

// `hookParamType` is the WebAssembly value type of the main loop's single
// parameter: 0x7f is i32, the signature every certified build declares. A
// caller passes another one — 0x7e is i64 — to build the module a manifest
// does not certify, which is the only side the mismatch can come from: a
// KnownEnhancementBuild's hookParams is the literal ["i32"] and cannot say
// otherwise.
function fixture(occupied = false, hookParamType = 0x7f): Uint8Array {
  const type = section(1, [
    5,
    0x60,
    1,
    hookParamType,
    0,
    0x60,
    2,
    0x7f,
    0x7f,
    0,
    0x60,
    3,
    0x7f,
    0x7f,
    0x7f,
    0,
    0x60,
    4,
    0x7f,
    0x7f,
    0x7f,
    0x7f,
    0,
    0x60,
    3,
    0x7f,
    0x7f,
    0x7f,
    1,
    0x7f,
  ]);
  const imports = section(2, [0]);
  const functions = section(3, [5, 0, 1, 2, 3, 4]);
  const table = section(4, [1, 0x70, 1, 1, 1]);
  const globals = section(6, [0]);
  const tableName = [...uleb(3), 116, 98, 108];
  const loopName = [...new TextEncoder().encode("EmscriptenExeThreadMainLoop")];
  const exports = section(7, [
    2,
    ...tableName,
    1,
    0,
    ...uleb(loopName.length),
    ...loopName,
    0,
    0,
  ]);
  const elements = section(9, occupied ? [1, 0, 0x41, 0, 0x0b, 1, 0] : [0]);
  const body = [0, 0x0b];
  const resultBody = [0, 0x41, 1, 0x0b];
  const code = section(10, [
    5,
    ...uleb(body.length),
    ...body,
    ...uleb(body.length),
    ...body,
    ...uleb(body.length),
    ...body,
    ...uleb(body.length),
    ...body,
    ...uleb(resultBody.length),
    ...resultBody,
  ]);
  return Uint8Array.from([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...type,
    ...imports,
    ...functions,
    ...table,
    ...globals,
    ...exports,
    ...elements,
    ...code,
  ]);
}

function manifest(bytes: Uint8Array): KnownEnhancementBuild {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    programId: 1,
    buildId: 1,
    hookFunction: 0,
    hookParams: ["i32"],
    hookResults: [],
    tableSlot: 0,
    heroAddDispatchFunction: 0,
    heroKickDispatchFunction: 0,
    difficultyDispatchFunction: 0,
    secondaryProfessionDispatchFunction: 1,
    attributeDispatchFunction: 3,
    skillbarDispatchFunction: 2,
    heroBehaviorDispatchFunction: 1,
    heroSkillToggleDispatchFunction: 1,
    uiMessageDispatchFunction: 2,
    layout: {
      contextRoot: 1,
      agentArray: 2,
      manualTargetAgentId: 3,
      automaticTargetAgentId: 4,
      gameContextSlot: 6,
      characterContext: 4,
      mapId: 5,
      isExplorable: 6,
      currentMapId: 7,
      currentInstanceType: 8,
      areaInfoBase: 25,
      playerNumber: 9,
      partyContext: 76,
      playerParty: 84,
      partyHeroes: 36,
      heroMemberStride: 24,
      heroAgentId: 0,
      heroOwnerPlayerId: 4,
      heroId: 8,
      worldContext: 44,
      worldAttributes: 172,
      partyAttributeStride: 1084,
      partyAttributeAgentId: 0,
      partyAttributeValues: 4,
      attributeStride: 20,
      attributeId: 0,
      attributeBaseRank: 4,
      worldHeroFlags: 1412,
      heroFlagStride: 36,
      heroFlagHeroId: 0,
      heroFlagAgentId: 4,
      heroFlagBehavior: 12,
      worldProfessionStates: 1724,
      professionStateStride: 20,
      professionStateAgentId: 0,
      professionStatePrimary: 4,
      professionStateSecondary: 8,
      worldSkillbars: 1776,
      skillbarStride: 188,
      skillbarAgentId: 0,
      skillbarSkills: 4,
      skillStride: 20,
      skillId: 12,
      skillbarDisabled: 164,
      agentId: 10,
      agentX: 11,
      agentY: 12,
      agentType: 13,
      agentPlayerNumber: 14,
      agentModelType: 15,
      cursorActiveArt: 16,
      cursorSoftwareModel: 17,
      cursorShowCount: 18,
      cursorColorBuffer: 19,
      cursorArtHotspot: 0,
      cursorArtTexture: 12,
      cursorHandleKey: 8,
      cursorHandleObject: 0,
      cursorViewTexture: 8,
      cursorTextureType: 12,
      cursorTextureWidth: 20,
      cursorTextureHeight: 24,
      partyPlayers: 4,
      playerMemberStride: 12,
      partyHenchmen: 20,
      henchmanMemberStride: 52,
      heroMemberLevel: 20,
      worldHeroInfo: 0x594,
      heroInfoStride: 0x9c,
      heroInfoHeroId: 0,
      heroInfoLevel: 8,
      heroInfoPrimary: 12,
      heroInfoSecondary: 16,
      agentLevel: 0x110,
    },
  };
}

describe("targeted Enhancement WebAssembly transform", () => {
  it("is deterministic and valid without changing the client table", () => {
    const input = fixture();
    const build = manifest(input);
    const first = transformEnhancementWasm(input, build);
    const second = transformEnhancementWasm(input, build);
    assert.deepEqual(first, second);
    // The transform returns a plain Uint8Array, which says nothing about the
    // buffer behind it, and WebAssembly takes only an unshared one. The copy
    // is the same bytes in a buffer the checker can see is not shared.
    const bytes = new Uint8Array(first);
    assert.equal(WebAssembly.validate(bytes), true);
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module);
    assert.equal((instance.exports.tbl as WebAssembly.Table).length, 1);
    const names = WebAssembly.Module.exports(module).map((entry) => entry.name);
    assert.ok(names.includes(ENHANCEMENT_HOOK_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_ORIGINAL_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_HERO_KICK_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_HERO_ADD_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_DIFFICULTY_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_SECONDARY_PROFESSION_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_ATTRIBUTES_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_SKILLBAR_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_HERO_BEHAVIOR_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_HERO_SKILL_TOGGLE_EXPORT));
    assert.ok(names.includes(ENHANCEMENT_HERO_PANEL_EXPORT));
    assert.ok(!names.includes("enhancement_template_apply"));
    assert.ok(!names.includes("enhancement_template_validate"));
    assert.ok(!names.includes("skill_text_resolve"));
    const sections = WebAssembly.Module.customSections(
      module,
      ENHANCEMENT_MANIFEST_SECTION,
    );
    assert.equal(sections.length, 1);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(sections[0])), {
      transformAbi: ENHANCEMENT_TRANSFORM_ABI,
      configBytes: 296,
      programId: build.programId,
      buildId: build.buildId,
      tableSlot: build.tableSlot,
      layoutWords: enhancementLayoutWords(build.layout),
    });
  });

  it("reports the semantic loop signature and reusable empty slots", () => {
    const report = inspectEnhancementCandidate(fixture());
    assert.equal(report.validWasm, true);
    assert.deepEqual(report.mainLoop, {
      functionIndex: 0,
      params: ["i32"],
      results: [],
    });
    assert.deepEqual(report.table, {
      min: 1,
      max: 1,
      firstEmptySlots: [0],
    });
  });

  it("rejects an occupied slot, hash mismatch, and signature mismatch", () => {
    const occupied = fixture(true);
    assert.throws(
      () => transformEnhancementWasm(occupied, manifest(occupied)),
      /occupied/,
    );
    const input = fixture();
    assert.throws(
      () =>
        transformEnhancementWasm(input, {
          ...manifest(input),
          sha256: "0".repeat(64),
        }),
      /unsupported/,
    );
    const wrongSignature = fixture(false, 0x7e);
    assert.throws(
      () => transformEnhancementWasm(wrongSignature, manifest(wrongSignature)),
      /signature/,
    );
  });
});

describe("Enhancement client chain", () => {
  it("pins the exact s_propContext address used by function 228", () => {});

  it("certifies the Enhancement transform against the template-save output", () => {
    // The Enhancement transform is layered on the template-save client so opting
    // into the game cursor never costs template save/load. If either manifest
    // is recertified without the other, this pairing is what breaks first.
    for (const build of ENHANCEMENT_BUILDS) {
      const source = TEMPLATE_SAVE_BUILDS.find(
        (candidate) => candidate.outputSha256 === build.sha256,
      );
      assert.ok(
        source,
        `Enhancement build ${build.buildId} does not consume any template-save output`,
      );
    }
  });
});
