import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.js";
import {
  isLocalClientVerification,
  type LocalClientVerification,
} from "../../src/main/certification/local-client-verifier.js";
import { TEMPLATE_SAVE_BUILDS } from "../../src/main/certification/template-save-compat.js";

const ENHANCEMENT = ENHANCEMENT_BUILDS[0]!;
const TEMPLATE = TEMPLATE_SAVE_BUILDS.find(
  (build) => build.outputSha256 === ENHANCEMENT.sha256,
)!;
function valid(): LocalClientVerification {
  return {
    officialSha256: TEMPLATE.sha256,
    templateSaveBuild: TEMPLATE,
    // The verifier returns the exact table entry for this exact transformed
    // input. A different build in the same table must not affect this proof.
    enhancementBuild: ENHANCEMENT,
    reasons: [],
  };
}

function automaticCursor(): LocalClientVerification {
  const cursor = ENHANCEMENT.cursorEvent!;
  return {
    ...valid(),
    enhancementBuild: {
      sha256: ENHANCEMENT.sha256,
      outputSha256: { cursor: "1".repeat(64) },
      programId: ENHANCEMENT.programId,
      buildId: ENHANCEMENT.buildId + 1,
      hookFunction: ENHANCEMENT.hookFunction + 1,
      hookParams: ENHANCEMENT.hookParams,
      hookResults: ENHANCEMENT.hookResults,
      hookBodySha256: "2".repeat(64),
      tableSlot: ENHANCEMENT.tableSlot,
      cursorEvent: {
        ...cursor,
        functionIndex: cursor.functionIndex + 1,
        producerFunctions: [
          cursor.producerFunctions[0] + 1,
          cursor.producerFunctions[1] + 1,
        ],
        producerBodySha256: ["3".repeat(64), "4".repeat(64)],
        layout: {
          ...cursor.layout,
          cursorActiveArt: cursor.layout.cursorActiveArt - 112,
          cursorSoftwareModel: cursor.layout.cursorSoftwareModel - 112,
          cursorShowCount: cursor.layout.cursorShowCount - 112,
          cursorColorBuffer: cursor.layout.cursorColorBuffer - 112,
        },
      },
    },
  };
}

function automaticTarget(): LocalClientVerification {
  const observation = ENHANCEMENT.observationBase!.layout;
  const target = ENHANCEMENT.targetObservation!.layout;
  const delta = -112;
  return {
    ...valid(),
    enhancementBuild: {
      sha256: ENHANCEMENT.sha256,
      outputSha256: { target: "5".repeat(64) },
      programId: ENHANCEMENT.programId,
      buildId: ENHANCEMENT.buildId + 1,
      hookFunction: ENHANCEMENT.hookFunction + 1,
      hookParams: ENHANCEMENT.hookParams,
      hookResults: ENHANCEMENT.hookResults,
      hookBodySha256: "6".repeat(64),
      tableSlot: ENHANCEMENT.tableSlot,
      observationBase: {
        layout: {
          ...observation,
          contextRoot: observation.contextRoot + delta,
          agentArray: observation.agentArray + delta,
          areaInfo: observation.areaInfo + delta,
        },
      },
      targetObservation: {
        layout: {
          manualTargetAgentId: target.manualTargetAgentId + delta,
          automaticTargetAgentId: target.automaticTargetAgentId + delta,
        },
      },
    },
  };
}

function automaticLocalActions(): LocalClientVerification {
  const target = automaticTarget();
  const xunlai = ENHANCEMENT.xunlaiAction!;
  const readers = xunlai.accessProof!.readers;
  return {
    ...target,
    enhancementBuild: {
      ...target.enhancementBuild!,
      outputSha256: { storage: "7".repeat(64) },
      uiDispatcher: ENHANCEMENT.uiDispatcher!,
      gameThread: {
        drain: {
          ...ENHANCEMENT.gameThread!.drain,
          bodySha256: "8".repeat(64),
        },
      },
      travelAction: ENHANCEMENT.travelAction!,
      xunlaiAction: {
        ...xunlai,
        accessProof: {
          ...xunlai.accessProof!,
          readers: {
            "agent-id": { ...readers["agent-id"], bodySha256: "9".repeat(64) },
            "access-flags": { ...readers["access-flags"], bodySha256: "9".repeat(64) },
            "player-number": readers["player-number"],
          },
        },
      },
      chatAliases: {
        parser: {
          ...ENHANCEMENT.chatAliases!.parser,
          bodySha256: "a".repeat(64),
        },
      },
    },
  };
}

describe("local client verification boundary", () => {
  it("accepts the verifier's complete baseline proof", () => {
    assert.equal(isLocalClientVerification(valid(), TEMPLATE.sha256), true);
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
        observationBase: {
          layout: {
            ...ENHANCEMENT.observationBase!.layout,
            currentMapId: ENHANCEMENT.observationBase!.layout.currentMapId + 4,
          },
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("rejects any certificate other than the exact shipped build", () => {
    assert.equal(isLocalClientVerification({
      ...valid(),
      enhancementBuild: {
        ...ENHANCEMENT,
        hookFunction: ENHANCEMENT.hookFunction + 1,
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts a structurally derived cursor proof and rejects malformed layouts", () => {
    const derived = automaticCursor();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        cursorEvent: {
          ...derived.enhancementBuild!.cursorEvent!,
          layout: {
            ...derived.enhancementBuild!.cursorEvent!.layout,
            cursorShowCount:
              derived.enhancementBuild!.cursorEvent!.layout.cursorShowCount + 4,
          },
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts a field-complete Target proof and rejects one bad relocation", () => {
    const derived = automaticTarget();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        targetObservation: {
          layout: {
            ...derived.enhancementBuild!.targetObservation!.layout,
            manualTargetAgentId:
              derived.enhancementBuild!.targetObservation!.layout.manualTargetAgentId + 4,
          },
        },
      },
    }, TEMPLATE.sha256), false);
  });

  it("accepts independent local-action proofs and rejects one bad Xunlai field", () => {
    const derived = automaticLocalActions();
    assert.equal(isLocalClientVerification(derived, TEMPLATE.sha256), true);
    assert.equal(isLocalClientVerification({
      ...derived,
      enhancementBuild: {
        ...derived.enhancementBuild!,
        xunlaiAction: {
          ...derived.enhancementBuild!.xunlaiAction!,
          accessProof: {
            ...derived.enhancementBuild!.xunlaiAction!.accessProof!,
            layout: {
              ...derived.enhancementBuild!.xunlaiAction!.accessProof!.layout,
              playerRecordAccessFlags: 0x38,
            },
          },
        },
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
