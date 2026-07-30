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
import { inspectTemplateSaveCandidate } from "./template-save-verifier.js";
import {
  readSleb,
  readUleb,
  sectionById,
  splitSections,
} from "./wasm-binary.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

/**
 * Bump when the local proof accepts a different class of client change. The
 * value is stored beside a derived result so an app update never inherits a
 * decision made by older verifier code.
 */
export const LOCAL_CLIENT_VERIFIER_ABI = 1;

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
 * Exact initialized-data topology of the build whose Enhancement layout was
 * measured live. ArenaNet's current rebuild inserted bytes into the first
 * segment and moved every later segment, BSS address and static pointer by one
 * common delta. Relative object fields do not move.
 */
const ENHANCEMENT_DATA_BASELINE: readonly DataSegmentShape[] = Object.freeze([
  Object.freeze({ base: 0x10_0000, size: 1_580_612 }),
  Object.freeze({ base: 2_629_200, size: 19_880 }),
  Object.freeze({ base: 2_649_080, size: 23_358 }),
  Object.freeze({ base: 2_672_438, size: 1_060 }),
]);

const EXPECTED_TEMPLATE_SIGNATURES: Readonly<Record<BridgeKind, string>> =
  Object.freeze({
    ensureDirectory: "(i32,i32)->(i32)",
    findFiles: "(i32,i32,i32)->()",
    fileBaseName: "(i32,i32,i32,i32,i32,i32)->(i32)",
    deleteFile: "(i32)->(i32)",
    fileExists: "(i32,i32,i32)->(i32)",
  });

const EXPECTED_DELETE_ASSERTION = Object.freeze({
  message: "not implemented",
  file: "../../../../Base/Os/Emscripten/Exe/EmscriptenExeFile.cpp",
  line: 840,
});

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function baselineFingerprint(): string {
  return sha256(JSON.stringify({
    verifierAbi: LOCAL_CLIENT_VERIFIER_ABI,
    template: TEMPLATE_SAVE_BUILDS[0],
    enhancement: ENHANCEMENT_BUILDS[0],
    data: ENHANCEMENT_DATA_BASELINE,
  }));
}

export const LOCAL_CLIENT_BASELINE_FINGERPRINT = baselineFingerprint();

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function templateShapeIsEquivalent(
  report: ReturnType<typeof inspectTemplateSaveCandidate>,
): report is ReturnType<typeof inspectTemplateSaveCandidate> & {
  entry: KnownTemplateSaveBuild;
} {
  const entry = report.entry;
  const baseline = TEMPLATE_SAVE_BUILDS[0];
  if (
    !baseline
    || !entry
    || report.status !== "derived"
    || !report.validWasm
    || report.encodings.canonical !== 0
    || !sameJson(report.deleteAssertion, EXPECTED_DELETE_ASSERTION)
    || entry.bridges.length !== baseline.bridges.length
  ) {
    return false;
  }

  for (const expected of baseline.bridges) {
    const candidate = entry.bridges.find(
      (bridge) => bridge.kind === expected.kind,
    );
    const target = report.targets[expected.kind];
    if (
      !candidate
      || !target
      || target.signature !== EXPECTED_TEMPLATE_SIGNATURES[expected.kind]
      || candidate.callSites.length !== expected.callSites.length
    ) {
      return false;
    }

    // Function indices may move. The instruction offset and number of semantic
    // callers may not: a changed caller body needs maintainer investigation.
    const expectedOffsets = expected.callSites
      .map((site) => site.bodyOffset)
      .sort((a, b) => a - b);
    const candidateOffsets = candidate.callSites
      .map((site) => site.bodyOffset)
      .sort((a, b) => a - b);
    if (!sameJson(candidateOffsets, expectedOffsets)) return false;

    // The three silent stubs are their complete semantics. Delete contains
    // relocated string addresses, so its decoded assertion above is the proof.
    if (
      expected.kind !== "deleteFile"
      && expected.stubBody
      && !sameJson(candidate.stubBody, expected.stubBody)
    ) {
      return false;
    }
  }
  return true;
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
  const baseline = ENHANCEMENT_BUILDS[0];
  if (!baseline) return null;
  const delta = inferStaticDelta(official);
  if (delta === null) return null;

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
    layout: relocateEnhancementLayout(baseline.layout, delta),
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

  const report = inspectTemplateSaveCandidate(official);
  if (!templateShapeIsEquivalent(report)) {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-shape-changed"],
    };
  }

  let templateOutput: Uint8Array;
  try {
    templateOutput = rewriteTemplateSaveWasm(official, report.entry);
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
    templateSaveBuild: report.entry,
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
    || build.bridges.length !== TEMPLATE_SAVE_BUILDS[0]?.bridges.length
  ) {
    return false;
  }
  const kinds = new Set<BridgeKind>();
  for (const bridge of build.bridges) {
    if (
      !bridge
      || !Object.hasOwn(EXPECTED_TEMPLATE_SIGNATURES, bridge.kind)
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
  return kinds.size === Object.keys(EXPECTED_TEMPLATE_SIGNATURES).length;
}

function isRelocatedEnhancementBuild(
  value: unknown,
  inputSha256: string,
): value is KnownEnhancementBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<KnownEnhancementBuild>;
  const baseline = ENHANCEMENT_BUILDS[0];
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
