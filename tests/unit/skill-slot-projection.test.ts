import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSkillSlots } from "../../src/renderer/skill-slot-projection.ts";

test("projects a valid Guild Wars skill slot clipped by the viewport edge", () => {
  const state = Object.freeze({
    status: "ready" as const,
    sequence: 2,
    frameId: 1,
    viewportWidth: 800,
    viewportHeight: 600,
    slots: Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
      left: 100 + index * 52,
      bottom: -12,
      right: 148 + index * 52,
      top: 36,
    }))),
  });
  const canvas = {
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: 1_600,
      height: 1_200,
    }),
  } as HTMLCanvasElement;

  const projected = projectSkillSlots(state, canvas);

  assert.ok(projected);
  assert.deepEqual(projected[0], {
    x: 210,
    y: 1_148,
    width: 96,
    height: 96,
  });
});
