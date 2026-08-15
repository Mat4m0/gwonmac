import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import {
  createCarryForwardReport,
  formatCarryForwardMarkdown,
} from "../../src/tools/carry-forward.js";
import {
  currentMessageAnchors,
  recertifyEnhancementBytes,
} from "../../src/tools/enhancement-recert.js";
import { inspectTemplateSaveCandidate } from "../../src/tools/template-save-recert.js";

describe("patch-day carry-forward report", () => {
  it("fails closed when no capability can be located", () => {
    const template = inspectTemplateSaveCandidate(WASM_HEADER);
    const enhancement = recertifyEnhancementBytes(
      WASM_HEADER,
      currentMessageAnchors(),
    );
    const report = createCarryForwardReport(
      template,
      enhancement,
      "not-located",
      "2026-08-14T12:00:00.000Z",
    );

    assert.deepEqual(report.capabilities, {
      gameFileSaving: "not-located",
      nativeDoubleClick: "not-located",
      nativeCursor: "not-located",
      targetObservation: "not-located",
      partyObservation: "not-located",
      teamApply: "not-located",
      xunlaiStorage: "not-located",
    });
    assert.equal(report.canonicalCertificate, null);
    assert.match(formatCarryForwardMarkdown(report), /Apply team \| not-located/);
    assert.match(formatCarryForwardMarkdown(report), /Xunlai storage \| not-located/);
    assert.match(
      formatCarryForwardMarkdown(report),
      /does not authorize memory reads or Apply team/,
    );
  });
});
