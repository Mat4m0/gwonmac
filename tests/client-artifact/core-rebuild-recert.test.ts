/** Exact-shortcut-disabled qualification for the three Core client proofs. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/certification/local-client-verifier.js";
import {
  concat,
  encodeCode,
  encodeSection,
  paddedIndex,
  parseCode,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";

const CORE_CAPABILITIES = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  chatFiltering: false,
  skillSlotGeometry: false,
  skillCooldownObservation: false,
  playerEffectObservation: false,
  playRegionObservation: true,
  preGameControls: true,
  characterSwitchAction: true,
  quickItemMove: false,
});

function rewriteCode(
  input: Uint8Array,
  edit: (bodies: Uint8Array[]) => void,
): Uint8Array {
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  edit(bodies);
  return concat(WASM_HEADER, ...sections.map((section) => encodeSection(
    section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
  )));
}

test("Core proofs survive the retained client rebuild and fail locally", {
  timeout: 120_000,
}, async () => {
  const artifact = process.env.GW_CLIENT_WASM;
  assert.ok(artifact, "GW_CLIENT_WASM must name a retained official artifact");
  const bytes = new Uint8Array(await readFile(artifact));
  const result = verifyLocalClientBytes(bytes, CORE_CAPABILITIES);
  assert.equal(result.status, "proved");
  assert.equal(
    isLocalClientVerification(result, result.officialSha256, CORE_CAPABILITIES),
    true,
  );
  assert.equal(result.featureVerdicts?.nativeCursor.status, "proved");
  assert.equal(result.featureVerdicts?.playRegionObservation.status, "proved");
  assert.equal(result.featureVerdicts?.preGameControls.status, "proved");
  assert.equal(result.featureVerdicts?.characterSwitchAction.status, "proved");
  const build = result.enhancementBuild;
  assert.ok(build?.cursorEvent);
  assert.ok(build.playRegionObservation);
  assert.ok(build.preGameControls);
  assert.equal(
    build.cursorEvent.layout.cursorSoftwareModel,
    build.cursorEvent.layout.cursorActiveArt + 4,
  );
  assert.equal(
    build.cursorEvent.layout.cursorShowCount,
    build.cursorEvent.layout.cursorActiveArt + 8,
  );
  assert.equal(
    build.preGameControls.layout.frameCount,
    build.preGameControls.layout.frameArray + 8,
  );
  assert.notEqual(
    build.preGameControls.characterSwitchAction.frameDispatch.functionIndex,
    6841,
    "low frame messages must not use the external API that rejects IDs below FRAME_MSG_EX",
  );
  assert.equal(
    build.preGameControls.characterSwitchAction.frameResolver.functionIndex,
    6534,
    "native child and parent IDs must be checked through the client's own ID manager",
  );

  const module = wasmEvidence(bytes)!.moduleView();
  const cursorProducer = build.cursorEvent.producerFunctions[0]!
    - module.functionImportCount;
  const changedCursor = rewriteCode(bytes, (bodies) => {
    const body = bodies[cursorProducer]!;
    body[77] = body[77]! ^ 1;
  });
  const cursorRefusal = verifyLocalClientBytes(changedCursor, CORE_CAPABILITIES);
  assert.equal(cursorRefusal.featureVerdicts?.nativeCursor.status, "changed");
  assert.equal(cursorRefusal.featureVerdicts?.playRegionObservation.status, "proved");
  assert.equal(cursorRefusal.featureVerdicts?.preGameControls.status, "proved");

  const areaInfo = build.playRegionObservation.layout.areaInfo;
  const areaNeedle = paddedIndex(areaInfo);
  const areaLookup = module.bodies.findIndex((body) =>
    body.byteLength === 47
    && areaNeedle.every((byte, index) => body[40 + index] === byte),
  );
  assert.notEqual(areaLookup, -1);
  const changedAreaStride = rewriteCode(bytes, (bodies) => {
    const body = bodies[areaLookup]!;
    body[36] = body[36]! ^ 1;
  });
  const areaRefusal = verifyLocalClientBytes(changedAreaStride, CORE_CAPABILITIES);
  assert.equal(areaRefusal.featureVerdicts?.nativeCursor.status, "proved");
  assert.equal(areaRefusal.featureVerdicts?.playRegionObservation.status, "changed");
  assert.equal(areaRefusal.featureVerdicts?.preGameControls.status, "changed");

  const changedHashTable = rewriteCode(bytes, (bodies) => {
    const hashFunction = build.preGameControls!.hashFunction.functionIndex
      - module.functionImportCount;
    const body = bodies[hashFunction]!;
    body[84] = body[84]! ^ 1;
  });
  const hashRefusal = verifyLocalClientBytes(changedHashTable, CORE_CAPABILITIES);
  assert.equal(hashRefusal.featureVerdicts?.nativeCursor.status, "proved");
  assert.equal(hashRefusal.featureVerdicts?.playRegionObservation.status, "proved");
  assert.equal(hashRefusal.featureVerdicts?.preGameControls.status, "changed");
});
