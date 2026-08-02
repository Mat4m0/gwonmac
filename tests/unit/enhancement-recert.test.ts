import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inspectPostTemplateEnhancementBytes,
  recertifyEnhancementBytes,
} from "../../src/tools/enhancement-recert.js";
import {
  concat,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const MESSAGE_ANCHORS = Object.freeze({
  playerChatMessage: 0x1000_0082,
  nearbyPlayerMessages: Object.freeze([
    0x1000_007f,
    0x1000_0080,
  ] as [number, number]),
});

function postTemplateFixture(): Uint8Array {
  const loopName = new TextEncoder().encode("EmscriptenExeThreadMainLoop");
  return concat(
    WASM_HEADER,
    encodeSection({
      id: 1,
      body: Uint8Array.of(1, 0x60, 1, 0x7f, 0),
    }),
    encodeSection({ id: 2, body: uleb(0) }),
    encodeSection({ id: 3, body: encodeIndexVector([0]) }),
    encodeSection({
      id: 4,
      body: Uint8Array.of(1, 0x70, 1, 1, 1),
    }),
    encodeSection({
      id: 7,
      body: concat(
        uleb(1),
        uleb(loopName.byteLength),
        loopName,
        Uint8Array.of(0),
        uleb(0),
      ),
    }),
    encodeSection({ id: 9, body: uleb(0) }),
    encodeSection({ id: 10, body: encodeCode([Uint8Array.of(0, 0x0b)]) }),
  );
}

describe("Enhancement re-certification input", () => {
  it("fails closed without inspecting raw official bytes", () => {
    const official = WASM_HEADER.slice();
    assert.equal(WebAssembly.validate(official), true);

    const report = recertifyEnhancementBytes(official, MESSAGE_ANCHORS);

    assert.equal(report.templateSaveApplied, false);
    assert.equal(report.templateSaveResolution, "underivable");
    assert.equal(report.candidateInspected, false);
    assert.equal(report.structuralEvidence, null);
    assert.equal(report.derivedOutputSha256, null);
    assert.equal(report.bundleVerified, false);
    assert.match(report.bundleFailure, /candidate was not inspected/);
    assert.equal("sha256" in report, false);
  });

  it("nests structural candidates as review evidence without promoting them", () => {
    const postTemplate = postTemplateFixture();
    assert.equal(WebAssembly.validate(new Uint8Array(postTemplate)), true);

    const report = inspectPostTemplateEnhancementBytes(
      "a".repeat(64),
      postTemplate,
      "structurally-derived",
      MESSAGE_ANCHORS,
    );

    assert.equal(report.candidateInspected, true);
    assert.equal(report.structuralEvidence.sha256, report.sha256);
    assert.equal(report.structuralEvidence.tick.status, "candidate");
    assert.equal(report.structuralEvidence.tick.candidate?.functionIndex, 0);
    assert.equal(report.structuralEvidence.playerChatUi.status, "unavailable");
    assert.equal(report.structuralEvidence.cursor.status, "unavailable");
    assert.equal(report.certifiedBuildId, null);
    assert.equal(report.derivedOutputSha256, null);
    assert.equal(report.bundleVerified, false);
    assert.equal(report.bundleFailure, null);
  });
});
