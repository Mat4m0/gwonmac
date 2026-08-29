/**
 * Focused native-kernel coverage for the certified eight-slot frame geometry.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  createKernel,
  FEATURE_PLAY_REGION_OBSERVATION,
  FEATURE_SKILL_SLOT_GEOMETRY,
  FEATURE_TOOLBOX_FOUNDATION,
  installDuplicateSkillSlot,
  installChatInputFrame,
  installSkillBarGraph,
} from "../fixtures/enhancements.ts";

describe("skill-slot geometry kernel", () => {
  it("publishes all eight rectangles or no geometry", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_SKILL_SLOT_GEOMETRY }), 0);
    assert.equal(kernel.init({
      features: FEATURE_PLAY_REGION_OBSERVATION | FEATURE_SKILL_SLOT_GEOMETRY,
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
    assert.deepEqual(kernel.skillSlots(), { status: "waiting", reason: "slot-missing" });
  });

  it("accepts a valid skill bar clipped by a viewport edge", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    for (let child = 0; child < 8; child += 1) {
      const frame = ADDRESSES.frameBuffer + (child + 2) * 0x1c8;
      kernel.view.setFloat32(frame + 0x110, -12, true);
      kernel.view.setFloat32(frame + 0x118, 36, true);
    }
    assert.equal(kernel.init({
      features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_PLAY_REGION_OBSERVATION
        | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);

    kernel.tick(1);

    const ready = kernel.skillSlots();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.deepEqual(ready.slots[0], {
      left: 100,
      bottom: -12,
      right: 148,
      top: 36,
    });
  });

  it("publishes and follows the movable chat editor", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    installChatInputFrame(kernel.view);
    assert.equal(kernel.init({
      features: FEATURE_PLAY_REGION_OBSERVATION | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);
    kernel.tick(1, 0, 11);
    const ready = kernel.skillSlots();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.chatFrameId, 11);
    assert.deepEqual(ready.chatInput, {
      left: 96, bottom: 72, right: 500, top: 96,
    });

    const frame = ADDRESSES.frameBuffer + 11 * 0x1c8;
    kernel.view.setFloat32(frame + 0x10c, 180, true);
    kernel.view.setFloat32(frame + 0x114, 640, true);
    kernel.tick(1, 0, 11);
    const moved = kernel.skillSlots();
    assert.equal(moved.status, "ready");
    if (moved.status === "ready") {
      assert.equal(moved.chatInput?.left, 180);
      assert.equal(moved.chatInput?.right, 640);
    }
  });

  it("keeps chat geometry when Guild Wars uses a separate chat viewport", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    installChatInputFrame(kernel.view);
    const frame = ADDRESSES.frameBuffer + 11 * 0x1c8;
    kernel.view.setFloat32(frame + 0x104, 1_600, true);
    kernel.view.setFloat32(frame + 0x108, 1_200, true);
    assert.equal(kernel.init({
      features: FEATURE_PLAY_REGION_OBSERVATION | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);

    kernel.tick(1, 0, 11);

    const ready = kernel.skillSlots();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.chatFrameId, 11);
    assert.equal(ready.viewportWidth, 800);
    assert.equal(ready.viewportHeight, 600);
    assert.deepEqual(ready.chatInput, {
      left: 96, bottom: 72, right: 500, top: 96,
    });
  });

  it("refuses duplicate visible frames for one skill slot", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    installDuplicateSkillSlot(kernel.view);
    assert.equal(kernel.init({
      features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_PLAY_REGION_OBSERVATION
        | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);
    kernel.tick(1);
    assert.deepEqual(kernel.skillSlots(), {
      status: "waiting",
      reason: "slot-ambiguous",
      candidateCount: 2,
    });
  });

  it("periodically audits cached frames for new ambiguity", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    installDuplicateSkillSlot(kernel.view, 1, false);
    assert.equal(kernel.init({
      features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_PLAY_REGION_OBSERVATION
        | FEATURE_SKILL_SLOT_GEOMETRY,
    }), 1);
    kernel.tick(1);
    assert.equal(kernel.skillSlots().status, "ready");

    const duplicate = ADDRESSES.frameBuffer + 10 * 0x1c8;
    kernel.view.setUint32(duplicate + 0x18c, 0x4, true);
    for (let tick = 0; tick < 30; tick += 1) kernel.tick(1);
    assert.equal(kernel.skillSlots().status, "ready");
    kernel.tick(1);
    assert.deepEqual(kernel.skillSlots(), {
      status: "waiting",
      reason: "slot-ambiguous",
      candidateCount: 2,
    });
  });
});
