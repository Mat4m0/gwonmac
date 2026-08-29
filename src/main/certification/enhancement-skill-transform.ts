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

export type EnhancementSkillTransformResolution = Readonly<{
  geometry: Readonly<{
    certificate: SkillSlotGeometryCertificate;
    initializer: ResolvedSkillFunction;
    chatInitializer: ResolvedSkillFunction;
    constructor: ResolvedSkillFunction;
  }> | null;
  cooldown: Readonly<{
    certificate: SkillCooldownCertificate;
    reader: ResolvedSkillFunction;
    timer: ResolvedSkillFunction;
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
    const chatInitializer = resolveFunction(
      "chat editor initializer",
      certificate.chatInitializer.functionIndex,
      certificate.chatInitializer.params,
      certificate.chatInitializer.results,
    );
    if (
      bodyHash(bodies, importCount, certificate.initializer.functionIndex, fail)
        !== certificate.initializer.bodySha256
      || bodyHash(bodies, importCount, certificate.constructor.functionIndex, fail)
        !== certificate.constructor.bodySha256
      || bodyHash(bodies, importCount, certificate.chatInitializer.functionIndex, fail)
        !== certificate.chatInitializer.bodySha256
    ) fail("SkillBar frame capture bodies do not match their certificates");
    const expected = paddedIndex(certificate.constructor.functionIndex);
    const certifiedCall = (
      resolved: ResolvedSkillFunction,
      operand: number,
      label: string,
    ) => {
      const body = bodies[resolved.localIndex]!;
      if (
        body[operand - 1] !== 0x10
        || expected.some((byte, index) => body[operand + index] !== byte)
      ) fail(`${label} constructor call site does not match its certificate`);
    };
    certifiedCall(
      initializer,
      certificate.initializer.constructorCallOperand,
      "SkillBar",
    );
    certifiedCall(
      chatInitializer,
      certificate.chatInitializer.constructorCallOperand,
      "chat editor",
    );
    geometry = { certificate, initializer, chatInitializer, constructor };
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

  return { geometry, cooldown };
}

/** Append the capture wrapper and replace only the certified call operand. */
export function rewriteInterfaceFrameCaptures(options: Readonly<{
  resolution: EnhancementSkillTransformResolution;
  nextBodies: Uint8Array[];
  skillBarFrameGlobalIndex: number;
  chatInputFrameGlobalIndex: number;
  appendFunction: (typeIndex: number, body: Uint8Array) => number;
}>): void {
  const {
    resolution,
    nextBodies,
    skillBarFrameGlobalIndex,
    chatInputFrameGlobalIndex,
    appendFunction,
  } = options;
  const geometry = resolution.geometry;
  if (!geometry) return;
  const {
    certificate: skillSlotGeometry,
    initializer: skillInitializer,
    chatInitializer,
    constructor: skillConstructor,
  } = geometry;

  const captureWrapper = (globalIndex: number) => appendFunction(
    skillConstructor.typeIndex,
    concat(
      // Zero is constructor refusal, not a frame. Retain the last successful
      // frame so a later optional UI initialization cannot erase it; the
      // kernel still validates that retained id against the live frame table.
      uleb(1), uleb(1), Uint8Array.of(0x7f),
      ...Array.from({ length: 6 }, (_, index) =>
        concat(Uint8Array.of(0x20), uleb(index))),
      Uint8Array.of(0x10), uleb(skillSlotGeometry.constructor.functionIndex),
      Uint8Array.of(0x21), uleb(6),
      Uint8Array.of(0x20), uleb(6),
      Uint8Array.of(0x04, 0x40),
      Uint8Array.of(0x20), uleb(6),
      Uint8Array.of(0x24), uleb(globalIndex),
      Uint8Array.of(0x0b),
      Uint8Array.of(0x20), uleb(6),
      Uint8Array.of(0x0b),
    ),
  );
  const rewriteCapture = (
    resolved: ResolvedSkillFunction,
    operand: number,
    globalIndex: number,
  ) => {
    const rewritten = new Uint8Array(nextBodies[resolved.localIndex]!);
    rewritten.set(paddedIndex(captureWrapper(globalIndex)), operand);
    nextBodies[resolved.localIndex] = rewritten;
  };
  rewriteCapture(
    skillInitializer,
    skillSlotGeometry.initializer.constructorCallOperand,
    skillBarFrameGlobalIndex,
  );
  rewriteCapture(
    chatInitializer,
    skillSlotGeometry.chatInitializer.constructorCallOperand,
    chatInputFrameGlobalIndex,
  );
}
