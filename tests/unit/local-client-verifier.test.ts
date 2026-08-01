import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENHANCEMENT_BUILDS } from "../../src/main/core/enhancement-builds.js";
import {
  isLocalClientVerification,
  LOCAL_CLIENT_BASELINE_FINGERPRINT,
  LOCAL_CLIENT_VERIFIER_ABI,
  type LocalClientVerification,
} from "../../src/main/core/local-client-verifier.js";
import {
  enhancementAddressEvidence,
} from "../../src/main/core/enhancement-address-evidence.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/core/template-save-compat.js";
import {
  concat,
  encodeCode,
  encodeSection,
  paddedIndex,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const TEMPLATE = TEMPLATE_SAVE_BUILDS[0]!;
const ENHANCEMENT = ENHANCEMENT_BUILDS[0]!;
const STATIC_FIELDS = [
  "contextRoot",
  "agentArray",
  "manualTargetAgentId",
  "automaticTargetAgentId",
  "cursorActiveArt",
  "cursorSoftwareModel",
  "cursorShowCount",
  "cursorColorBuffer",
] as const;

function addressEvidenceFixture(
  layout: typeof ENHANCEMENT.layout,
  unrelated = 7,
): Uint8Array {
  const body = Uint8Array.from([
    0,
    ...STATIC_FIELDS.flatMap((field) => [
      0x41, ...paddedIndex(layout[field]), 0x1a,
    ]),
    0x41, unrelated, 0x1a,
    0x0b,
  ]);
  return concat(
    WASM_HEADER,
    encodeSection({ id: 1, body: Uint8Array.of(1, 0x60, 0, 0) }),
    encodeSection({ id: 3, body: Uint8Array.of(1, 0) }),
    encodeSection({ id: 10, body: encodeCode([body]) }),
  );
}

function relocateLayout(
  layout: typeof ENHANCEMENT.layout,
  delta: number,
): typeof ENHANCEMENT.layout {
  return {
    ...layout,
    ...Object.fromEntries(
      STATIC_FIELDS.map((field) => [field, layout[field] + delta]),
    ),
  };
}

function valid(): LocalClientVerification {
  return {
    verifierAbi: LOCAL_CLIENT_VERIFIER_ABI,
    baselineFingerprint: LOCAL_CLIENT_BASELINE_FINGERPRINT,
    officialSha256: TEMPLATE.sha256,
    templateSaveBuild: TEMPLATE,
    // What deriveEnhancementBuild actually emits: the relocated layout under
    // the baseline's own buildId, because a locally verified client cannot
    // prove its build number. The first manifest entry carried the same id as
    // the baseline until the baseline was corrected to the build its client
    // self-reports, which is what this spread now makes explicit.
    enhancementBuild: {
      ...ENHANCEMENT,
      buildId: ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1]!.buildId,
    },
    reasons: [],
  };
}

describe("local client verification boundary", () => {
  it("proves address relocation through complete reference contexts", () => {
    const baseline = enhancementAddressEvidence(
      addressEvidenceFixture(ENHANCEMENT.layout),
      ENHANCEMENT.layout,
    );
    const relocated = relocateLayout(ENHANCEMENT.layout, 0x10);
    assert.equal(
      enhancementAddressEvidence(
        addressEvidenceFixture(relocated),
        relocated,
      ),
      baseline,
      "only the eight address immediates may move together",
    );
    assert.notEqual(
      enhancementAddressEvidence(
        addressEvidenceFixture(relocated, 8),
        relocated,
      ),
      baseline,
      "any other instruction change must invalidate the evidence",
    );
    assert.equal(
      enhancementAddressEvidence(
        addressEvidenceFixture(ENHANCEMENT.layout),
        relocated,
      ),
      null,
      "guessed addresses with no matching references are not proof",
    );
  });

  it("accepts the verifier's complete baseline proof", () => {
    assert.equal(isLocalClientVerification(valid(), TEMPLATE.sha256), true);
  });

  it("expires cached answers when verifier code changes", () => {
    assert.equal(isLocalClientVerification(
      { ...valid(), verifierAbi: LOCAL_CLIENT_VERIFIER_ABI + 1 },
      TEMPLATE.sha256,
    ), false);
    assert.equal(isLocalClientVerification(
      { ...valid(), baselineFingerprint: "0".repeat(64) },
      TEMPLATE.sha256,
    ), false);
  });

  it("rejects a proof for any other official client", () => {
    assert.equal(
      isLocalClientVerification(valid(), "0".repeat(64)),
      false,
    );
  });

  it("rejects an unconstrained enhancement layout", () => {
    assert.equal(isLocalClientVerification({
      ...valid(),
      enhancementBuild: {
        ...ENHANCEMENT,
        layout: {
          ...ENHANCEMENT.layout,
          currentMapId: ENHANCEMENT.layout.currentMapId + 4,
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("rejects a relocation beyond the one bounded supported class", () => {
    assert.equal(isLocalClientVerification({
      ...valid(),
      enhancementBuild: {
        ...ENHANCEMENT,
        layout: relocateLayout(ENHANCEMENT.layout, 0x20_0000),
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts a template-only proof and requires no enhancement behind failure", () => {
    const templateOnly: LocalClientVerification = {
      ...valid(),
      enhancementBuild: null,
      reasons: ["enhancement-layout-changed"],
    };
    assert.equal(
      isLocalClientVerification(templateOnly, TEMPLATE.sha256),
      true,
    );
    assert.equal(isLocalClientVerification({
      ...templateOnly,
      templateSaveBuild: null,
      enhancementBuild: ENHANCEMENT,
    }, TEMPLATE.sha256), false);
  });
});
