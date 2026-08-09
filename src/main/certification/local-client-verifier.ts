/**
 * The structural proof that decides whether an unrecognised official client may
 * still be transformed, and what it may be transformed for.
 *
 * Pure: it reads the bytes it is handed and nothing else — no profile state, no
 * filesystem, no caching, and no Electron, which a utility process could not
 * resolve anyway. The host owns all of that, which is what allows this to run
 * inside a bounded isolated process.
 *
 * The two answers are not symmetric and must not be merged. Template save is
 * shape-verifiable, so a client whose affected call sites still match is
 * accepted by proof. Enhancement execution is exact-build only, because a
 * matching address delta is not evidence about hook semantics or layout; an
 * unrecognised client reports `enhancement-layout-changed` rather than being
 * given the benefit of the doubt.
 *
 * `isLocalClientVerification` re-validates every field of a result that crossed
 * a process boundary or came back off disk. A verifier ABI or baseline change
 * makes every older result unreadable, so an app update can never inherit a
 * decision made by verifier code it no longer contains.
 */
import { createHash } from "node:crypto";
import { ENHANCEMENT_CAPABILITY_PROFILES } from "../../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_BUILDS,
  findEnhancementBuild,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  inspectEnhancementCandidate,
  transformEnhancementWasm,
} from "./enhancement-transform.js";
import {
  BRIDGE_KINDS,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type KnownTemplateSaveBuild,
} from "./template-save-compat.js";
import {
  preparePostTemplateSaveModule,
  TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT,
  type PostTemplateSaveModule,
} from "./template-save-verifier.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

/**
 * Bump when the local proof accepts a different class of client change. The
 * value is stored beside a derived result so an app update never inherits a
 * decision made by older verifier code.
 */
export const LOCAL_CLIENT_VERIFIER_ABI = 3;

/**
 * Declared as a list rather than a union so the boundary check below and the
 * diagnostics schema can both execute it. A union nobody can enumerate gets
 * restated wherever it has to be checked, and the restatements drift.
 */
export const LOCAL_VERIFICATION_REASONS = [
  "invalid-wasm",
  "template-shape-changed",
  "template-transform-failed",
  "enhancement-layout-changed",
  "enhancement-transform-failed",
] as const;

export type LocalVerificationReason = (typeof LOCAL_VERIFICATION_REASONS)[number];

export interface LocalClientVerification {
  readonly verifierAbi: number;
  readonly baselineFingerprint: string;
  readonly officialSha256: string;
  readonly templateSaveBuild: KnownTemplateSaveBuild | null;
  readonly enhancementBuild: KnownEnhancementBuild | null;
  readonly reasons: readonly LocalVerificationReason[];
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function baselineFingerprint(): string {
  return sha256(JSON.stringify({
    verifierAbi: LOCAL_CLIENT_VERIFIER_ABI,
    template: TEMPLATE_SAVE_BUILDS[TEMPLATE_SAVE_BUILDS.length - 1],
    templateSemantics: TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT,
    enhancement: ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1],
  }));
}

export const LOCAL_CLIENT_BASELINE_FINGERPRINT = baselineFingerprint();

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deriveEnhancementBuild(
  _official: Uint8Array,
  templateOutput: Uint8Array,
): KnownEnhancementBuild | null {
  const report = inspectEnhancementCandidate(templateOutput);
  if (!report.validWasm) return null;
  // A common address delta is not proof of all three hook semantics or every
  // layout field. Until those can be re-derived by their own anchors,
  // enhancement execution is exact-build only. Template save remains
  // independently shape-verifiable.
  const build = findEnhancementBuild(report.sha256);
  if (!build) return null;
  transformEnhancementWasm(
    templateOutput,
    build,
    ENHANCEMENT_CAPABILITY_PROFILES.cursorToolbox,
  );
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

  let postTemplate: PostTemplateSaveModule | null;
  try {
    postTemplate = preparePostTemplateSaveModule(official);
  } catch {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-transform-failed"],
    };
  }
  if (!postTemplate) {
    return {
      ...base,
      templateSaveBuild: null,
      enhancementBuild: null,
      reasons: ["template-shape-changed"],
    };
  }

  const templateSaveBuild = postTemplate.build;
  const templateOutput = postTemplate.bytes;

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
      || !BRIDGE_KINDS.includes(bridge.kind)
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
  return kinds.size === BRIDGE_KINDS.length;
}

function isExactEnhancementBuild(
  value: unknown,
  inputSha256: string,
): value is KnownEnhancementBuild {
  const exact = findEnhancementBuild(inputSha256);
  return exact !== null && sameJson(value, exact);
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
    || !result.reasons.every((reason): reason is LocalVerificationReason =>
      typeof reason === "string"
      && (LOCAL_VERIFICATION_REASONS as readonly string[]).includes(reason)
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
    && isExactEnhancementBuild(
      result.enhancementBuild,
      result.templateSaveBuild.outputSha256,
    );
}
