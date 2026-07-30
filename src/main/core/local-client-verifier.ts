import { createHash } from "node:crypto";
import {
  ENHANCEMENT_BUILDS,
  type EnhancementLayout,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  inspectEnhancementCandidate,
  transformEnhancementWasm,
} from "./enhancement-transform.js";
import {
  TEMPLATE_SAVE_BUILDS,
  rewriteTemplateSaveWasm,
  type BridgeKind,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";
import {
  deriveEquivalentTemplateSaveBuild,
  TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT,
} from "./template-save-verifier.js";
import {
  readSleb,
  readUleb,
  sectionById,
  splitSections,
} from "./wasm-binary.js";
import { enhancementAddressEvidence } from "./enhancement-address-evidence.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

/**
 * Bump when the local proof accepts a different class of client change. The
 * value is stored beside a derived result so an app update never inherits a
 * decision made by older verifier code.
 */
export const LOCAL_CLIENT_VERIFIER_ABI = 2;

export type LocalVerificationReason =
  | "invalid-wasm"
  | "template-shape-changed"
  | "template-transform-failed"
  | "enhancement-layout-changed"
  | "enhancement-transform-failed";

export interface LocalClientVerification {
  readonly verifierAbi: number;
  readonly baselineFingerprint: string;
  readonly officialSha256: string;
  readonly templateSaveBuild: KnownTemplateSaveBuild | null;
  readonly enhancementBuild: KnownEnhancementBuild | null;
  readonly reasons: readonly LocalVerificationReason[];
}

interface DataSegmentShape {
  readonly base: number;
  readonly size: number;
}

/**
 * Exact initialized-data topology of the current live-measured Enhancement
 * baseline. A future candidate may propose one common delta from this shape,
 * but the code-reference fingerprint below must prove every relocated address.
 */
const ENHANCEMENT_DATA_BASELINE: readonly DataSegmentShape[] = Object.freeze([
  Object.freeze({ base: 0x10_0000, size: 1_580_804 }),
  Object.freeze({ base: 2_629_392, size: 19_880 }),
  Object.freeze({ base: 2_649_272, size: 23_358 }),
  Object.freeze({ base: 2_672_630, size: 1_060 }),
]);

const TEMPLATE_BRIDGE_KINDS: readonly BridgeKind[] = Object.freeze([
  "ensureDirectory",
  "findFiles",
  "fileBaseName",
  "deleteFile",
  "fileExists",
]);
/**
 * Normalized code-reference identity for the current measured layout. Every
 * relevant address must appear in the same complete function bodies; only the
 * five-byte address immediates themselves may move together.
 */
const ENHANCEMENT_ADDRESS_EVIDENCE_FINGERPRINT =
  "97e05f36c3d2881b8c7ddbfe6d47e87c36af0c99b8d715880aef7ab360fc5da2";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function baselineFingerprint(): string {
  return sha256(JSON.stringify({
    verifierAbi: LOCAL_CLIENT_VERIFIER_ABI,
    template: TEMPLATE_SAVE_BUILDS[TEMPLATE_SAVE_BUILDS.length - 1],
    templateSemantics: TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT,
    enhancement: ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1],
    data: ENHANCEMENT_DATA_BASELINE,
    addressEvidence: ENHANCEMENT_ADDRESS_EVIDENCE_FINGERPRINT,
  }));
}

export const LOCAL_CLIENT_BASELINE_FINGERPRINT = baselineFingerprint();

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dataSegments(input: Uint8Array): DataSegmentShape[] {
  const bytes = sectionById(splitSections(input), 11);
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const segments: DataSegmentShape[] = [];
  for (let index = 0; index < count; index += 1) {
    if (readUleb(bytes, cursor) !== 0) {
      throw new Error("local verifier: passive data segment");
    }
    if (bytes[cursor.offset++] !== 0x41) {
      throw new Error("local verifier: non-constant data segment");
    }
    const base = readSleb(bytes, cursor);
    if (bytes[cursor.offset++] !== 0x0b) {
      throw new Error("local verifier: malformed data segment");
    }
    const size = readUleb(bytes, cursor);
    const end = cursor.offset + size;
    if (base < 0 || end > bytes.byteLength) {
      throw new Error("local verifier: data segment out of range");
    }
    segments.push({ base, size });
    cursor.offset = end;
  }
  if (cursor.offset !== bytes.byteLength) {
    throw new Error("local verifier: trailing data bytes");
  }
  return segments;
}

function inferStaticDelta(input: Uint8Array): number | null {
  let current: DataSegmentShape[];
  try {
    current = dataSegments(input);
  } catch {
    return null;
  }
  if (current.length !== ENHANCEMENT_DATA_BASELINE.length) return null;

  const first = current[0];
  const baselineFirst = ENHANCEMENT_DATA_BASELINE[0];
  if (!first || !baselineFirst || first.base !== baselineFirst.base) return null;
  const delta = first.size - baselineFirst.size;
  if (
    !Number.isSafeInteger(delta)
    || Math.abs(delta) > 0x10_0000
    || (delta & 0x0f) !== 0
  ) {
    return null;
  }
  for (let index = 1; index < current.length; index += 1) {
    const actual = current[index]!;
    const expected = ENHANCEMENT_DATA_BASELINE[index]!;
    if (
      actual.base !== expected.base + delta
      || actual.size !== expected.size
    ) {
      return null;
    }
  }
  return delta;
}

function shifted(value: number, delta: number): number {
  const next = value + delta;
  if (!Number.isSafeInteger(next) || next <= 0 || next > 0xffff_ffff) {
    throw new Error("local verifier: relocated address out of range");
  }
  return next;
}

function relocateEnhancementLayout(
  layout: EnhancementLayout,
  delta: number,
): EnhancementLayout {
  return {
    ...layout,
    contextRoot: shifted(layout.contextRoot, delta),
    agentArray: shifted(layout.agentArray, delta),
    manualTargetAgentId: shifted(layout.manualTargetAgentId, delta),
    automaticTargetAgentId: shifted(layout.automaticTargetAgentId, delta),
    cursorActiveArt: shifted(layout.cursorActiveArt, delta),
    cursorSoftwareModel: shifted(layout.cursorSoftwareModel, delta),
    cursorShowCount: shifted(layout.cursorShowCount, delta),
    cursorColorBuffer: shifted(layout.cursorColorBuffer, delta),
  };
}

function deriveEnhancementBuild(
  official: Uint8Array,
  templateOutput: Uint8Array,
): KnownEnhancementBuild | null {
  const baseline = ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1];
  if (!baseline) return null;
  const delta = inferStaticDelta(official);
  if (delta === null) return null;
  const layout = relocateEnhancementLayout(baseline.layout, delta);
  if (
    enhancementAddressEvidence(official, layout)
    !== ENHANCEMENT_ADDRESS_EVIDENCE_FINGERPRINT
  ) {
    return null;
  }

  const report = inspectEnhancementCandidate(templateOutput);
  if (
    !report.validWasm
    || !report.mainLoop
    || !sameJson(report.mainLoop.params, baseline.hookParams)
    || !sameJson(report.mainLoop.results, baseline.hookResults)
    || !report.table?.firstEmptySlots.includes(baseline.tableSlot)
  ) {
    return null;
  }

  const build: KnownEnhancementBuild = {
    sha256: report.sha256,
    programId: baseline.programId,
    // This identifies the companion/layout contract. A new semantic build ID
    // requires a shipped baseline rather than a local relocation decision.
    buildId: baseline.buildId,
    hookFunction: report.mainLoop.functionIndex,
    hookParams: baseline.hookParams,
    hookResults: baseline.hookResults,
    tableSlot: baseline.tableSlot,
    layout,
  };
  transformEnhancementWasm(templateOutput, build);
  return build;
}

/**
 * Pure verifier entry point. It reads no profile state and performs no writes;
 * the utility-process host supplies the exact official bytes and owns caching.
 */
export function verifyLocalClientBytes(
  official: Uint8Array,
): LocalClientVerification {
  const officialSha256 = sha256(official);
  const reasons: LocalVerificationReason[] = [];
  const base = {
    verifierAbi: LOCAL_CLIENT_VERIFIER_ABI,
    baselineFingerprint: LOCAL_CLIENT_BASELINE_FINGERPRINT,
    officialSha256,
  };
  if (!WebAssembly.validate(official)) {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["invalid-wasm"],
    };
  }

  const templateSaveBuild = deriveEquivalentTemplateSaveBuild(official);
  if (!templateSaveBuild) {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-shape-changed"],
    };
  }

  let templateOutput: Uint8Array;
  try {
    templateOutput = rewriteTemplateSaveWasm(official, templateSaveBuild);
  } catch {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-transform-failed"],
    };
  }

  let enhancementBuild: KnownEnhancementBuild | null = null;
  try {
    enhancementBuild = deriveEnhancementBuild(official, templateOutput);
    if (!enhancementBuild) reasons.push("enhancement-layout-changed");
  } catch {
    reasons.push("enhancement-transform-failed");
  }
  return {
    ...base,
    templateSaveBuild,
    enhancementBuild,
    reasons,
  };
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTemplateSaveBuild(
  value: unknown,
  officialSha256: string,
): value is KnownTemplateSaveBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<KnownTemplateSaveBuild>;
  if (
    build.sha256 !== officialSha256
    || !isDigest(build.outputSha256)
    || !isIndex(build.importCount)
    || !isIndex(build.carrierImport)
    || !Array.isArray(build.bridges)
    || build.bridges.length
      !== TEMPLATE_SAVE_BUILDS[TEMPLATE_SAVE_BUILDS.length - 1]?.bridges.length
  ) {
    return false;
  }
  const kinds = new Set<BridgeKind>();
  for (const bridge of build.bridges) {
    if (
      !bridge
      || !TEMPLATE_BRIDGE_KINDS.includes(bridge.kind)
      || kinds.has(bridge.kind)
      || !isIndex(bridge.stubFunction)
      || !Array.isArray(bridge.callSites)
      || bridge.callSites.length === 0
      || !bridge.callSites.every(
        (site: unknown) => {
          if (!site || typeof site !== "object") return false;
          const callSite = site as {
            localFunction?: unknown;
            bodyOffset?: unknown;
          };
          return isIndex(callSite.localFunction) && isIndex(callSite.bodyOffset);
        },
      )
      || (
        bridge.stubBody !== undefined
        && (
          !Array.isArray(bridge.stubBody)
          || !bridge.stubBody.every(
            (byte: unknown) =>
              typeof byte === "number"
              && Number.isInteger(byte)
              && byte >= 0
              && byte <= 0xff,
          )
        )
      )
    ) {
      return false;
    }
    kinds.add(bridge.kind);
  }
  return kinds.size === TEMPLATE_BRIDGE_KINDS.length;
}

function isRelocatedEnhancementBuild(
  value: unknown,
  inputSha256: string,
): value is KnownEnhancementBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<KnownEnhancementBuild>;
  const baseline = ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1];
  if (
    !baseline
    || build.sha256 !== inputSha256
    || build.programId !== baseline.programId
    || build.buildId !== baseline.buildId
    || !isIndex(build.hookFunction)
    || !sameJson(build.hookParams, baseline.hookParams)
    || !sameJson(build.hookResults, baseline.hookResults)
    || build.tableSlot !== baseline.tableSlot
    || !build.layout
  ) {
    return false;
  }

  const delta = build.layout.contextRoot - baseline.layout.contextRoot;
  if (
    !Number.isSafeInteger(delta)
    || Math.abs(delta) > 0x10_0000
    || (delta & 0x0f) !== 0
  ) {
    return false;
  }
  const relocated = relocateEnhancementLayout(baseline.layout, delta);
  return sameJson(build.layout, relocated);
}

/**
 * Boundary check for utility-process messages and the derived on-disk cache.
 * Production transforms still re-check every body/callsite before use.
 */
export function isLocalClientVerification(
  value: unknown,
  officialSha256: string,
): value is LocalClientVerification {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LocalClientVerification>;
  if (
    result.verifierAbi !== LOCAL_CLIENT_VERIFIER_ABI
    || result.baselineFingerprint !== LOCAL_CLIENT_BASELINE_FINGERPRINT
    || result.officialSha256 !== officialSha256
    || !isDigest(result.officialSha256)
    || !Array.isArray(result.reasons)
    || !result.reasons.every((reason) =>
      typeof reason === "string"
      && [
        "invalid-wasm",
        "template-shape-changed",
        "template-transform-failed",
        "enhancement-layout-changed",
        "enhancement-transform-failed",
      ].includes(reason)
    )
  ) {
    return false;
  }
  if (result.templateSaveBuild === null) {
    return result.enhancementBuild === null
      && result.reasons.some((reason) =>
        reason === "invalid-wasm"
        || reason === "template-shape-changed"
        || reason === "template-transform-failed"
      );
  }
  if (!isTemplateSaveBuild(result.templateSaveBuild, officialSha256)) {
    return false;
  }
  if (result.enhancementBuild === null) {
    return result.reasons.some((reason) =>
      reason === "enhancement-layout-changed"
      || reason === "enhancement-transform-failed"
    );
  }
  return result.reasons.length === 0
    && isRelocatedEnhancementBuild(
      result.enhancementBuild,
      result.templateSaveBuild.outputSha256,
    );
}
