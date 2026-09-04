/**
 * Feature-owned certification and byte rewrite for skill HUD observation.
 * The root transform still owns cross-feature ordering and index allocation.
 */
import { createHash } from "node:crypto";
import type { EnhancementCapabilities } from "../../shared/enhancement-contracts.js";
import {
  concat,
  paddedIndex,
  uleb,
  type FunctionType,
} from "../core/wasm-binary.js";
import type { KnownEnhancementBuild } from "./enhancement-builds.js";

export type ResolvedSkillFunction = Readonly<{
  localIndex: number;
  typeIndex: number;
  type: FunctionType;
}>;

type ResolveFunction = (
  label: string,
  functionIndex: number,
  expectedParams: readonly string[],
  expectedResults: readonly string[],
) => ResolvedSkillFunction;

type SkillSlotGeometryCertificate = NonNullable<
  KnownEnhancementBuild["skillSlotGeometry"]
>;
type SkillCooldownCertificate = NonNullable<
  KnownEnhancementBuild["skillCooldownObservation"]
>;
type PlayerEffectCertificate = NonNullable<
  KnownEnhancementBuild["playerEffectObservation"]
>;
type EffectGeometryCertificate = NonNullable<
  KnownEnhancementBuild["effectIconGeometry"]
>;

export type EnhancementSkillTransformResolution = Readonly<{
  geometry: Readonly<{
    certificate: SkillSlotGeometryCertificate;
    initializer: ResolvedSkillFunction;
    constructor: ResolvedSkillFunction;
  }> | null;
  cooldown: Readonly<{
    certificate: SkillCooldownCertificate;
    reader: ResolvedSkillFunction;
    timer: ResolvedSkillFunction;
  }> | null;
  effects: Readonly<{
    certificate: PlayerEffectCertificate;
    timer: ResolvedSkillFunction;
  }> | null;
  effectGeometry: Readonly<{
    certificate: EffectGeometryCertificate;
    initializer: ResolvedSkillFunction;
    constructor: ResolvedSkillFunction;
  }> | null;
}>;

function bodyHash(
  bodies: readonly Uint8Array[],
  importCount: number,
  functionIndex: number,
  fail: (message: string) => never,
): string {
  const body = bodies[functionIndex - importCount];
  if (!body) fail(`function ${functionIndex} has no body`);
  return createHash("sha256").update(body).digest("hex");
}

/** Resolve and verify the exact skill functions selected by this profile. */
export function resolveEnhancementSkillTransform(options: Readonly<{
  build: KnownEnhancementBuild;
  capabilities: EnhancementCapabilities;
  bodies: readonly Uint8Array[];
  importCount: number;
  resolveFunction: ResolveFunction;
  fail: (message: string) => never;
}>): EnhancementSkillTransformResolution {
  const {
    build,
    capabilities,
    bodies,
    importCount,
    resolveFunction,
    fail,
  } = options;
  let geometry: EnhancementSkillTransformResolution["geometry"] = null;
  if (capabilities.skillSlotGeometry) {
    const certificate = build.skillSlotGeometry
      ?? fail("skill-slot geometry is not certified");
    const initializer = resolveFunction(
      "SkillBar initializer",
      certificate.initializer.functionIndex,
      certificate.initializer.params,
      certificate.initializer.results,
    );
    const constructor = resolveFunction(
      "SkillBar frame constructor",
      certificate.constructor.functionIndex,
      certificate.constructor.params,
      certificate.constructor.results,
    );
    if (
      bodyHash(bodies, importCount, certificate.initializer.functionIndex, fail)
        !== certificate.initializer.bodySha256
      || bodyHash(bodies, importCount, certificate.constructor.functionIndex, fail)
        !== certificate.constructor.bodySha256
    ) fail("SkillBar frame capture bodies do not match their certificates");
    const operand = certificate.initializer.constructorCallOperand;
    const body = bodies[initializer.localIndex]!;
    const expected = paddedIndex(certificate.constructor.functionIndex);
    if (
      body[operand - 1] !== 0x10
      || expected.some((byte, index) => body[operand + index] !== byte)
    ) fail("SkillBar constructor call site does not match its certificate");
    geometry = { certificate, initializer, constructor };
  }

  let cooldown: EnhancementSkillTransformResolution["cooldown"] = null;
  if (capabilities.skillCooldownObservation) {
    const certificate = build.skillCooldownObservation
      ?? fail("skill cooldown observation is not certified");
    const reader = resolveFunction(
      "skill recharge reader",
      certificate.reader.functionIndex,
      certificate.reader.params,
      certificate.reader.results,
    );
    const timer = resolveFunction(
      "precise skill timer",
      certificate.timer.functionIndex,
      certificate.timer.params,
      certificate.timer.results,
    );
    if (
      bodyHash(bodies, importCount, certificate.reader.functionIndex, fail)
        !== certificate.reader.bodySha256
      || bodyHash(bodies, importCount, certificate.timer.functionIndex, fail)
        !== certificate.timer.bodySha256
    ) fail("skill cooldown bodies do not match their certificates");
    const operand = certificate.reader.timerCallOperand;
    const body = bodies[reader.localIndex]!;
    const expected = paddedIndex(certificate.timer.functionIndex);
    if (
      body[operand - 1] !== 0x10
      || expected.some((byte, index) => body[operand + index] !== byte)
    ) fail("skill timer call site does not match its certificate");
    cooldown = { certificate, reader, timer };
  }

  let effects: EnhancementSkillTransformResolution["effects"] = null;
  if (capabilities.playerEffectObservation) {
    const certificate = build.playerEffectObservation
      ?? fail("player effect observation is not certified");
    const timer = resolveFunction(
      "precise effect timer", certificate.timer.functionIndex,
      certificate.timer.params, certificate.timer.results,
    );
    if (bodyHash(bodies, importCount, certificate.timer.functionIndex, fail)
      !== certificate.timer.bodySha256) fail("effect timer body does not match its certificate");
    for (const functionCertificate of [
      ...certificate.accessors,
      certificate.mutations.addTimed,
      certificate.mutations.renewTimed,
      certificate.mutations.remove,
    ]) {
      if (bodyHash(bodies, importCount, functionCertificate.functionIndex, fail)
        !== functionCertificate.bodySha256) {
        fail("effect collection body does not match its certificate");
      }
    }
    effects = { certificate, timer };
  }

  let effectGeometry: EnhancementSkillTransformResolution["effectGeometry"] = null;
  if (capabilities.effectIconGeometry) {
    const certificate = build.effectIconGeometry
      ?? fail("effect icon geometry is not certified");
    const initializer = resolveFunction(
      "Effects initializer", certificate.initializer.functionIndex,
      certificate.initializer.params, certificate.initializer.results,
    );
    const constructor = resolveFunction(
      "Effects frame constructor", certificate.constructor.functionIndex,
      certificate.constructor.params, certificate.constructor.results,
    );
    if (bodyHash(bodies, importCount, certificate.initializer.functionIndex, fail)
        !== certificate.initializer.bodySha256
      || bodyHash(bodies, importCount, certificate.constructor.functionIndex, fail)
        !== certificate.constructor.bodySha256
      || bodyHash(bodies, importCount, certificate.childBuilder.functionIndex, fail)
        !== certificate.childBuilder.bodySha256) {
      fail("Effects frame bodies do not match their certificates");
    }
    const operand = certificate.initializer.constructorCallOperand;
    const body = bodies[initializer.localIndex]!;
    const expected = paddedIndex(certificate.constructor.functionIndex);
    if (body[operand - 1] !== 0x10
      || expected.some((byte, index) => body[operand + index] !== byte)) {
      fail("Effects constructor call site does not match its certificate");
    }
    effectGeometry = { certificate, initializer, constructor };
  }

  return { geometry, cooldown, effects, effectGeometry };
}

/** Append the capture wrapper and replace only the certified call operand. */
export function rewriteSkillBarConstructorCapture(options: Readonly<{
  resolution: EnhancementSkillTransformResolution;
  nextBodies: Uint8Array[];
  skillBarFrameGlobalIndex: number;
  appendFunction: (typeIndex: number, body: Uint8Array) => number;
}>): void {
  const {
    resolution,
    nextBodies,
    skillBarFrameGlobalIndex,
    appendFunction,
  } = options;
  const geometry = resolution.geometry;
  if (!geometry) return;
  const {
    certificate: skillSlotGeometry,
    initializer: skillInitializer,
    constructor: skillConstructor,
  } = geometry;

  const wrapperIndex = appendFunction(
    skillConstructor.typeIndex,
    concat(
      // One i32 local holds the constructor result while it is published.
      uleb(1), uleb(1), Uint8Array.of(0x7f),
      ...Array.from({ length: 6 }, (_, index) =>
        concat(Uint8Array.of(0x20), uleb(index))),
      Uint8Array.of(0x10), uleb(skillSlotGeometry.constructor.functionIndex),
      Uint8Array.of(0x22), uleb(6),
      Uint8Array.of(0x24), uleb(skillBarFrameGlobalIndex),
      Uint8Array.of(0x20), uleb(6),
      Uint8Array.of(0x0b),
    ),
  );
  const rewrittenInitializer = new Uint8Array(
    nextBodies[skillInitializer.localIndex]!,
  );
  rewrittenInitializer.set(
    paddedIndex(wrapperIndex),
    skillSlotGeometry.initializer.constructorCallOperand,
  );
  nextBodies[skillInitializer.localIndex] = rewrittenInitializer;
}
