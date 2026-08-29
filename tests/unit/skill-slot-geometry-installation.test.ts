import assert from "node:assert/strict";
import test from "node:test";
import { createSkillSlotGeometryInstallation } from "../../src/renderer/skill-slot-geometry-installation.js";
import type { CompanionSkillSlotState } from "../../src/renderer/companion-interface-geometry-snapshot.js";

const geometry = (sequence: number, left = 0): CompanionSkillSlotState => ({
  status: "ready",
  sequence,
  frameId: 4,
  chatFrameId: 0,
  chatInput: null,
  viewportWidth: 800,
  viewportHeight: 600,
  slots: Array.from({ length: 8 }, (_, index) => ({
    left: left + index * 50,
    bottom: 20,
    right: left + index * 50 + 48,
    top: 68,
  })),
});

test("geometry listeners ignore heartbeat-only publications but receive moved bars", () => {
  const installation = createSkillSlotGeometryInstallation(true);
  const observed: CompanionSkillSlotState[] = [];
  installation.setActive(true);
  installation.subscribe((state) => observed.push(state));

  installation.sink?.update(geometry(2));
  installation.sink?.update(geometry(4));
  assert.equal(observed.length, 2, "waiting plus the first geometry publication");
  assert.deepEqual(installation.state, geometry(4), "heartbeat sequence still advances");

  installation.sink?.update(geometry(6, 12));
  assert.equal(observed.length, 3);
  assert.deepEqual(observed.at(-1), geometry(6, 12));
  installation.dispose();
});
