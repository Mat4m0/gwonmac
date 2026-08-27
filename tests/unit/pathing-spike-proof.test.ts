import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validPathingShapeFacts,
  type PathingShapeFacts,
} from "../../src/main/certification/pathing-spike-proof.js";

const VALID: PathingShapeFacts = Object.freeze({
  pathMapTrapezoidCount: 0x14,
  pathMapTrapezoidPointer: 0x18,
  liveStride: 0x30,
  livePortalFields: Object.freeze([0x14, 0x16]),
  liveCoordinateFields: Object.freeze([0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c]),
  definitionCoordinateFields: Object.freeze([0x14, 0x18, 0x1c, 0x20, 0x24, 0x28]),
  definitionReferenceMaximumExclusive: 1024,
});

describe("the pathing shape spike", () => {
  it("accepts only the jointly proved exact shape", () => {
    assert.equal(validPathingShapeFacts(VALID), true);
    for (const key of [
      "pathMapTrapezoidCount",
      "pathMapTrapezoidPointer",
      "liveStride",
      "definitionReferenceMaximumExclusive",
    ] as const) {
      assert.equal(validPathingShapeFacts({ ...VALID, [key]: VALID[key] + 1 }), false, key);
    }
  });

  it("refuses every changed portal and coordinate field", () => {
    for (const key of [
      "livePortalFields",
      "liveCoordinateFields",
      "definitionCoordinateFields",
    ] as const) {
      for (let index = 0; index < VALID[key].length; index += 1) {
        const changed = [...VALID[key]];
        changed[index] = changed[index]! + 1;
        assert.equal(validPathingShapeFacts({ ...VALID, [key]: changed }), false, `${key}.${index}`);
      }
    }
  });
});
