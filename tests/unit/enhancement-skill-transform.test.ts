import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EnhancementCapabilities } from "../../src/shared/enhancement-contracts.js";
import type { KnownEnhancementBuild } from "../../src/main/certification/enhancement-builds.js";
import {
  resolveEnhancementSkillTransform,
  rewriteSkillBarConstructorCapture,
} from "../../src/main/certification/enhancement-skill-transform.js";
import { concat, paddedIndex, uleb } from "../../src/main/core/wasm-binary.js";

const capabilities: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  teamApply: false,
  travelAction: false,
  xunlaiAction: false,
  chatAliases: false,
  chatFiltering: false,
  skillSlotGeometry: true,
  skillCooldownObservation: true,
  playRegionObservation: true,
    preGameControls: false,
    characterSwitchAction: false,
    quickItemMove: false,
});

const hash = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");

const initializer = concat(Uint8Array.of(0), Uint8Array.of(0x10), paddedIndex(1), Uint8Array.of(0x0b));
const constructor = Uint8Array.of(0, 0x41, 0, 0x0b);
const reader = concat(Uint8Array.of(0), Uint8Array.of(0x10), paddedIndex(3), Uint8Array.of(0x0b));
const timer = Uint8Array.of(0, 0x41, 0, 0x0b);
const bodies = [initializer, constructor, reader, timer] as const;

function build(): KnownEnhancementBuild {
  return {
    sha256: "0".repeat(64),
    outputSha256: {},
    programId: 1,
    buildId: 1,
    hookFunction: 0,
    hookParams: ["i32"],
    hookResults: [],
    hookBodySha256: "0".repeat(64),
    tableSlot: 1,
    skillSlotGeometry: {
      initializer: {
        functionIndex: 0,
        params: ["i32", "i32"],
        results: [],
        bodySha256: hash(initializer),
        constructorCallOperand: 2,
      },
      constructor: {
        functionIndex: 1,
        params: ["i32", "i32", "i32", "i32", "i32", "i32"],
        results: ["i32"],
        bodySha256: hash(constructor),
      },
      labelAddress: 0,
      layout: {} as never,
    },
    skillCooldownObservation: {
      reader: {
        functionIndex: 2,
        params: ["i32", "i32", "i32"],
        results: ["i32"],
        bodySha256: hash(reader),
        timerCallOperand: 2,
      },
      timer: {
        functionIndex: 3,
        params: [],
        results: ["i32"],
        bodySha256: hash(timer),
      },
      layout: {} as never,
    },
  };
}

const fail = (message: string): never => {
  throw new Error(`enhancement transform: ${message}`);
};

function resolve(
  candidate = build(),
  selectedCapabilities = capabilities,
) {
  const labels: string[] = [];
  const resolution = resolveEnhancementSkillTransform({
    build: candidate,
    capabilities: selectedCapabilities,
    bodies,
    importCount: 0,
    resolveFunction: (label, functionIndex) => {
      labels.push(label);
      return {
        localIndex: functionIndex,
        typeIndex: 40 + functionIndex,
        type: { params: [], results: [] },
      };
    },
    fail,
  });
  return { labels, resolution };
}

test("skill transform resolves and verifies only its four certified functions", () => {
  const { labels, resolution } = resolve();
  assert.deepEqual(labels, [
    "SkillBar initializer",
    "SkillBar frame constructor",
    "skill recharge reader",
    "precise skill timer",
  ]);
  assert.ok(resolution.geometry);
  assert.ok(resolution.cooldown);
});

test("unselected skill facts stay absent and selected missing facts fail clearly", () => {
  const original = build();
  const withoutSkillFacts: KnownEnhancementBuild = {
    sha256: original.sha256,
    outputSha256: original.outputSha256,
    programId: original.programId,
    buildId: original.buildId,
    hookFunction: original.hookFunction,
    hookParams: original.hookParams,
    hookResults: original.hookResults,
    hookBodySha256: original.hookBodySha256,
    tableSlot: original.tableSlot,
  };
  const unselected = resolve(withoutSkillFacts, {
    ...capabilities,
    skillSlotGeometry: false,
    skillCooldownObservation: false,
  });
  assert.deepEqual(unselected.labels, []);
  assert.deepEqual(unselected.resolution, { geometry: null, cooldown: null });
  assert.throws(
    () => resolve(withoutSkillFacts),
    /skill-slot geometry is not certified/u,
  );
});

test("skill transform refuses changed bodies and changed certified call operands", () => {
  const original = build();
  const changedBody: KnownEnhancementBuild = {
    ...original,
    skillSlotGeometry: {
      ...original.skillSlotGeometry!,
      constructor: {
        ...original.skillSlotGeometry!.constructor,
        bodySha256: "0".repeat(64),
      },
    },
  };
  assert.throws(
    () => resolve(changedBody),
    /SkillBar frame capture bodies do not match their certificates/u,
  );

  const changedSite: KnownEnhancementBuild = {
    ...original,
    skillCooldownObservation: {
      ...original.skillCooldownObservation!,
      reader: {
        ...original.skillCooldownObservation!.reader,
        timerCallOperand: 3,
      },
    },
  };
  assert.throws(
    () => resolve(changedSite),
    /skill timer call site does not match its certificate/u,
  );
});

test("SkillBar capture rewrites only the certified operand and preserves wrapper bytes", () => {
  const { resolution } = resolve();
  const nextBodies = bodies.map((body) => new Uint8Array(body));
  let wrapper: Uint8Array | null = null;
  rewriteSkillBarConstructorCapture({
    resolution,
    nextBodies,
    skillBarFrameGlobalIndex: 12,
    appendFunction: (typeIndex, body) => {
      assert.equal(typeIndex, 41);
      wrapper = body;
      return 99;
    },
  });

  const expectedInitializer = new Uint8Array(initializer);
  expectedInitializer.set(paddedIndex(99), 2);
  assert.deepEqual(nextBodies[0], expectedInitializer);
  assert.deepEqual(nextBodies.slice(1), bodies.slice(1));
  assert.deepEqual(
    wrapper,
    concat(
      uleb(1), uleb(1), Uint8Array.of(0x7f),
      ...Array.from({ length: 6 }, (_, index) =>
        concat(Uint8Array.of(0x20), uleb(index))),
      Uint8Array.of(0x10), uleb(1),
      Uint8Array.of(0x22), uleb(6),
      Uint8Array.of(0x24), uleb(12),
      Uint8Array.of(0x20), uleb(6),
      Uint8Array.of(0x0b),
    ),
  );
});
