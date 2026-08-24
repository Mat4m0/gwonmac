/**
 * Focused native-kernel coverage for the certified eight-slot frame geometry.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  createKernel,
  FEATURE_SKILL_SLOT_GEOMETRY,
  FEATURE_TOOLBOX_FOUNDATION,
  installDuplicateSkillSlot,
  installSkillBarGraph,
} from "../fixtures/enhancements.ts";

describe("skill-slot geometry kernel", () => {
  it("publishes all eight rectangles or no geometry", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_SKILL_SLOT_GEOMETRY }), 0);
    assert.equal(kernel.init({
      features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);
    kernel.tick(1);
    const ready = kernel.skillSlots();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.frameId, 1);
    assert.equal(ready.viewportWidth, 800);
    assert.equal(ready.viewportHeight, 600);
    assert.deepEqual(ready.slots[7], {
      left: 464,
      bottom: 20,
      right: 512,
      top: 68,
    });

    kernel.view.setUint32(ADDRESSES.frameTable + 9 * 4, 0, true);
    kernel.tick(1);
    assert.deepEqual(kernel.skillSlots(), { status: "waiting", reason: "frame" });
  });

  it("refuses duplicate visible frames for one skill slot", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    installDuplicateSkillSlot(kernel.view);
    assert.equal(kernel.init({
      features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);
    kernel.tick(1);
    assert.deepEqual(kernel.skillSlots(), { status: "waiting", reason: "frame" });
  });

  it("periodically audits cached frames for new ambiguity", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    installDuplicateSkillSlot(kernel.view, 1, false);
    assert.equal(kernel.init({
      features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);
    kernel.tick(1);
    assert.equal(kernel.skillSlots().status, "ready");

    const duplicate = ADDRESSES.frameBuffer + 10 * 0x1c8;
    kernel.view.setUint32(duplicate + 0x18c, 0x4, true);
    for (let tick = 0; tick < 30; tick += 1) kernel.tick(1);
    assert.equal(kernel.skillSlots().status, "ready");
    kernel.tick(1);
    assert.deepEqual(kernel.skillSlots(), { status: "waiting", reason: "frame" });
  });
});
