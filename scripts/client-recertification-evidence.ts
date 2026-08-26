/**
 * Builds the durable, privacy-safe record for one ArenaNet code generation.
 *
 * Detailed locator output stays on the temporary runner because it can contain
 * build-local indices, offsets, or addresses. This script copies only the
 * facts needed to reproduce and compare a patch-day result: immutable input
 * identities, verifier/source identities, closed verdicts, invariant names,
 * candidate counts, and exact transform-output digests.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  ENHANCEMENT_CAPABILITY_FIELDS,
  enhancementCapabilityProfile,
  isEnhancementCapabilityProfile,
  RELEASE_ENHANCEMENT_CAPABILITIES,
} from "../src/shared/enhancement-contracts.js";
import {
  LOCAL_FEATURE_INVARIANTS,
  LOCAL_VERIFICATION_REASONS,
} from "../src/main/certification/local-client-verification-contract.js";
import { SEMANTIC_VERIFIER_ABI } from
  "../src/main/certification/semantic-proof.js";
import { isDigest } from "../src/shared/digest.js";

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as JsonRecord;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function digest(value: unknown, name: string): string {
  if (!isDigest(value)) throw new Error(`${name} must be a SHA-256 digest`);
  return value;
}

function gitCommit(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error("GITHUB_SHA must be a Git SHA-1");
  }
  return value;
}

function githubRepository(value: unknown): string {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error("GITHUB_REPOSITORY is not canonical");
  }
  return value;
}

function githubRunId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("GITHUB_RUN_ID is not canonical");
  }
  return value;
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value as number;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}

function exactKeys(value: JsonRecord, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${name} must have the canonical keys`);
  }
}

async function jsonFile(filename: string, name: string): Promise<JsonRecord> {
  return record(JSON.parse(await readFile(filename, "utf8")), name);
}

async function collectedEvidence(
  filename: string,
  name: string,
  select: (value: JsonRecord) => JsonRecord,
): Promise<JsonRecord> {
  try {
    return select(await jsonFile(filename, name));
  } catch {
    // A crashed evidence tool must not prevent retaining the immutable client
    // identities. Do not copy an exception message: it can contain a path or
    // raw locator detail from the temporary runner.
    return Object.freeze({
      status: "unavailable",
      reason: "evidence-collection-failed",
    });
  }
}

async function artifact(filename: string): Promise<Readonly<{
  sha256: string;
  byteLength: number;
}>> {
  const [bytes, metadata] = await Promise.all([readFile(filename), stat(filename)]);
  if (!metadata.isFile()) throw new Error("client artifact must be a regular file");
  return Object.freeze({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  });
}

function fileVerdict(value: unknown): JsonRecord | null {
  if (value === null) return null;
  const verdict = record(value, "runtime.fileVerdict");
  const status = string(verdict.status, "runtime.fileVerdict.status");
  const base = {
    status,
    inputSha256: digest(
      verdict.inputSha256,
      "runtime.fileVerdict.inputSha256",
    ),
    verifierAbi: integer(
      verdict.verifierAbi,
      "runtime.fileVerdict.verifierAbi",
    ),
  };
  if (status === "proved") {
    return Object.freeze({
      ...base,
      outputSha256: digest(
        verdict.outputSha256,
        "runtime.fileVerdict.outputSha256",
      ),
    });
  }
  if (status !== "refused") throw new Error("runtime file verdict is not closed");
  const reason = string(verdict.reason, "runtime.fileVerdict.reason");
  if (reason !== "template-shape-changed"
    && reason !== "template-transform-failed") {
    throw new Error("runtime file refusal reason is not closed");
  }
  return Object.freeze({
    ...base,
    reason,
  });
}

function featureVerdicts(value: unknown): JsonRecord | null {
  if (value === null) return null;
  const features = record(value, "runtime.features");
  const names = Object.keys(LOCAL_FEATURE_INVARIANTS);
  exactKeys(features, names, "runtime.features");
  return Object.freeze(Object.fromEntries(names.map((name) => {
    const raw = features[name];
    const feature = record(raw, `runtime.features.${name}`);
    const status = string(feature.status, `runtime.features.${name}.status`);
    if (!["proved", "changed", "ambiguous", "not-requested"].includes(status)) {
      throw new Error(`runtime.features.${name}.status is not closed`);
    }
    const invariant = feature.invariant;
    if ((status === "changed" || status === "ambiguous")
      && (typeof invariant !== "string"
        || !(LOCAL_FEATURE_INVARIANTS[
          name as keyof typeof LOCAL_FEATURE_INVARIANTS
        ] as readonly string[]).includes(invariant))) {
      throw new Error(`runtime.features.${name}.invariant is not closed`);
    }
    if ((status === "proved" || status === "not-requested")
      && (invariant !== undefined || feature.candidates !== undefined)) {
      throw new Error(`runtime.features.${name} has refusal-only fields`);
    }
    if (status === "changed" && feature.candidates !== undefined) {
      throw new Error(`runtime.features.${name} changed verdict has candidates`);
    }
    const candidates = status === "ambiguous"
      ? integer(feature.candidates, `${name}.candidates`)
      : undefined;
    if (status === "ambiguous" && (candidates ?? 0) < 2) {
      throw new Error(`runtime.features.${name} ambiguity needs two candidates`);
    }
    return [name, Object.freeze({
      status,
      ...(status === "changed" || status === "ambiguous"
        ? { invariant }
        : {}),
      ...(candidates === undefined ? {} : { candidates }),
    })];
  })));
}

function booleanMap(value: unknown, name: string): JsonRecord | null {
  if (value === null) return null;
  const source = record(value, name);
  exactKeys(source, ENHANCEMENT_CAPABILITY_FIELDS, name);
  return Object.freeze(Object.fromEntries(ENHANCEMENT_CAPABILITY_FIELDS.map((key) => {
    const item = source[key];
    if (typeof item !== "boolean") throw new Error(`${name}.${key} must be boolean`);
    return [key, item];
  })));
}

function runtimeEvidence(value: JsonRecord): JsonRecord {
  const reasons = value.reasons;
  if (!Array.isArray(reasons)
    || reasons.some((reason) => !LOCAL_VERIFICATION_REASONS.includes(
      reason as (typeof LOCAL_VERIFICATION_REASONS)[number],
    ))) {
    throw new Error("runtime.reasons must use the closed vocabulary");
  }
  if (typeof value.templateSaving !== "boolean") {
    throw new Error("runtime.templateSaving must be boolean");
  }
  const officialSha256 = digest(value.officialSha256, "runtime.officialSha256");
  const verifierAbi = integer(value.verifierAbi, "runtime.verifierAbi");
  if (verifierAbi !== SEMANTIC_VERIFIER_ABI) {
    throw new Error("runtime verifier ABI does not match this source");
  }
  const safeFileVerdict = fileVerdict(value.fileVerdict);
  if (safeFileVerdict !== null
    && (safeFileVerdict.inputSha256 !== officialSha256
      || safeFileVerdict.verifierAbi !== verifierAbi)) {
    throw new Error("runtime file verdict is not bound to the runtime input");
  }
  if (value.templateSaving !== (safeFileVerdict?.status === "proved")) {
    throw new Error("runtime template status contradicts its file verdict");
  }
  return Object.freeze({
    officialSha256,
    verifierAbi,
    fileVerdict: safeFileVerdict,
    templateSaving: value.templateSaving,
    features: featureVerdicts(value.features),
    capabilities: booleanMap(value.capabilities, "runtime.capabilities"),
    reasons: Object.freeze([...reasons]),
  });
}

function qualificationEvidence(value: JsonRecord): JsonRecord {
  const status = string(value.status, "qualification.status");
  if (status !== "proved" && status !== "refused") {
    throw new Error("qualification.status is not closed");
  }
  const exitCode = integer(value.exitCode, "qualification.exitCode");
  if ((status === "proved") !== (exitCode === 0)) {
    throw new Error("qualification status contradicts its exit code");
  }
  return Object.freeze({
    status,
    exitCode,
  });
}

function doubleClickEvidence(value: JsonRecord): JsonRecord {
  const status = string(value.status, "doubleClick.status");
  const exitCode = integer(value.exitCode, "doubleClick.exitCode");
  if (value.status === "refused") {
    if (exitCode === 0) throw new Error("double-click refusal must fail");
    return Object.freeze({
      status: "refused",
      exitCode,
    });
  }
  if (status !== "proved" || exitCode !== 0) {
    throw new Error("double-click status is not closed");
  }
  const rawChains = value.chains;
  if (!Array.isArray(rawChains) || rawChains.length === 0) {
    throw new Error("doubleClick.chains must be non-empty");
  }
  const chains = rawChains.map((raw, index) => {
    const chain = record(raw, `doubleClick.chains[${index}]`);
    const profile = string(chain.profile, `doubleClick.chains[${index}].profile`);
    if (profile !== "official" && profile !== "file-compatible"
      && !isEnhancementCapabilityProfile(profile)) {
      throw new Error("doubleClick chain profile is not closed");
    }
    return Object.freeze({
      profile,
      inputSha256: digest(chain.inputSha256, "doubleClick chain input"),
      outputSha256: digest(chain.outputSha256, "doubleClick chain output"),
    });
  });
  if (new Set(chains.map(({ profile }) => profile)).size !== chains.length
    || new Set(chains.map(({ inputSha256 }) => inputSha256)).size !== chains.length) {
    throw new Error("doubleClick chains must have unique profiles and inputs");
  }
  if (value.completeRouteProved !== true) {
    throw new Error("double-click proved status requires the complete route");
  }
  return Object.freeze({
    status: "proved",
    exitCode,
    officialSha256: digest(value.officialSha256, "doubleClick.officialSha256"),
    chains: Object.freeze(chains),
    completeRouteProved: value.completeRouteProved,
  });
}

function extendedMemoryEvidence(value: JsonRecord): JsonRecord {
  const status = string(value.status, "extendedMemory.status");
  const exitCode = integer(value.exitCode, "extendedMemory.exitCode");
  if (value.status === "refused") {
    if (exitCode === 0) throw new Error("extended-memory refusal must fail");
    return Object.freeze({
      status: "refused",
      exitCode,
    });
  }
  if (status !== "proved" || exitCode !== 0) {
    throw new Error("extended-memory status is not closed");
  }
  const variants = value.variants;
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("extendedMemory.variants must be non-empty");
  }
  const profiles = variants.map((raw, index) => string(
    record(raw, `extendedMemory.variants[${index}]`).profile,
    `extendedMemory.variants[${index}].profile`,
  ));
  if (profiles.some((profile) => profile !== "off"
      && !isEnhancementCapabilityProfile(profile))
    || new Set(profiles).size !== profiles.length) {
    throw new Error("extendedMemory profiles must use unique closed labels");
  }
  if (value.crossed3GiB !== true || value.freedBlockReusedWithoutGrowth !== true) {
    throw new Error("extended-memory proved status requires allocator invariants");
  }
  return Object.freeze({
    status: "proved",
    exitCode,
    jsInputSha256: digest(value.jsInputSha256, "extendedMemory.jsInputSha256"),
    jsOutputSha256: digest(value.jsOutputSha256, "extendedMemory.jsOutputSha256"),
    normalizedJsSha256: digest(
      value.normalizedJsSha256,
      "extendedMemory.normalizedJsSha256",
    ),
    variants: Object.freeze(variants.map((raw, index) => {
      const variant = record(raw, `extendedMemory.variants[${index}]`);
      return Object.freeze({
        profile: string(variant.profile, `extendedMemory.variants[${index}].profile`),
        inputSha256: digest(variant.inputSha256, "extendedMemory variant input"),
        outputSha256: digest(variant.outputSha256, "extendedMemory variant output"),
      });
    })),
    heapBytes: integer(value.heapBytes, "extendedMemory.heapBytes"),
    crossed3GiB: boolean(value.crossed3GiB, "extendedMemory.crossed3GiB"),
    freedBlockReusedWithoutGrowth: boolean(
      value.freedBlockReusedWithoutGrowth,
      "extendedMemory.freedBlockReusedWithoutGrowth",
    ),
  });
}

function unavailable(value: JsonRecord): boolean {
  return value.status === "unavailable";
}

function generationOutcome(
  runtime: JsonRecord,
  qualification: JsonRecord,
  doubleClick: JsonRecord,
  extendedMemory: JsonRecord,
): JsonRecord {
  if ([runtime, qualification, doubleClick, extendedMemory].some(unavailable)) {
    return Object.freeze({ status: "investigation", reason: "evidence-collection-failed" });
  }
  const features = runtime.features;
  const capabilities = runtime.capabilities;
  const runtimeReady = runtime.fileVerdict !== null
    && record(runtime.fileVerdict, "runtime.fileVerdict").status === "proved"
    && runtime.templateSaving === true
    && features !== null
    && capabilities !== null
    && Array.isArray(runtime.reasons)
    && runtime.reasons.length === 0
    && Object.values(record(features, "runtime.features"))
      .every((value) => record(value, "feature").status === "proved")
    && Object.values(record(capabilities, "runtime.capabilities"))
      .every((value) => value === true);
  if (!runtimeReady) {
    return Object.freeze({ status: "investigation", reason: "runtime-proof-refused" });
  }
  if (qualification.status !== "proved") {
    return Object.freeze({ status: "investigation", reason: "client-artifact-refused" });
  }
  if (doubleClick.status !== "proved") {
    return Object.freeze({ status: "investigation", reason: "native-double-click-refused" });
  }
  if (extendedMemory.status !== "proved") {
    return Object.freeze({ status: "investigation", reason: "extended-memory-refused" });
  }
  const doubleClickChains = doubleClick.chains as readonly JsonRecord[];
  const memoryVariants = extendedMemory.variants as readonly JsonRecord[];
  const baseChains = doubleClickChains.filter((chain) =>
    chain.profile === "file-compatible");
  const offVariants = memoryVariants.filter((variant) => variant.profile === "off");
  if (baseChains.length !== 1 || offVariants.length !== 1) {
    return Object.freeze({ status: "investigation", reason: "base-profile-missing" });
  }
  const fileVerdict = record(runtime.fileVerdict, "runtime.fileVerdict");
  const baseInput = baseChains[0]!.inputSha256;
  if (baseInput !== fileVerdict.outputSha256) {
    return Object.freeze({ status: "investigation", reason: "selected-input-mismatch" });
  }
  const doubleClickProfiles = doubleClickChains
    .map((chain) => chain.profile)
    .filter(isEnhancementCapabilityProfile)
    .sort();
  const memoryProfiles = memoryVariants
    .map((variant) => variant.profile)
    .filter(isEnhancementCapabilityProfile)
    .sort();
  const expectedProfiles = Object.values(RELEASE_ENHANCEMENT_CAPABILITIES)
    .map(enhancementCapabilityProfile)
    .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
    .sort();
  const matchesExpectedProfiles = expectedProfiles.length === doubleClickProfiles.length
    && expectedProfiles.every(
      (profile, index) => profile === doubleClickProfiles[index],
    );
  if (doubleClickProfiles.length !== memoryProfiles.length
    || doubleClickProfiles.some((profile, index) => profile !== memoryProfiles[index])
    || !matchesExpectedProfiles) {
    return Object.freeze({ status: "investigation", reason: "profile-set-mismatch" });
  }
  const memoryByProfile = new Map(memoryVariants.map((variant) => [
    variant.profile,
    variant.inputSha256,
  ]));
  if (doubleClickChains.some((chain) => {
    const memoryProfile = chain.profile === "official"
      || chain.profile === "file-compatible" ? "off" : chain.profile;
    return memoryByProfile.get(memoryProfile) !== chain.outputSha256;
  })) {
    return Object.freeze({ status: "investigation", reason: "transform-chain-mismatch" });
  }
  return Object.freeze({ status: "ready", reason: "all-required-evidence-proved" });
}

export async function createClientRecertificationEvidence(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<JsonRecord> {
  const [generation, wasmPath, jsPath, runtimePath, qualificationPath,
    doubleClickPath, extendedMemoryPath] = argv;
  if (!generation || !wasmPath || !jsPath || !runtimePath || !qualificationPath
    || !doubleClickPath || !extendedMemoryPath || argv.length !== 7) {
    throw new Error("usage: client-recertification-evidence GENERATION WASM JS RUNTIME QUALIFICATION DOUBLE_CLICK EXTENDED_MEMORY");
  }
  const [wasm, js, safeRuntime, safeQualification, safeDoubleClick,
    safeExtendedMemory] =
    await Promise.all([
      artifact(wasmPath),
      artifact(jsPath),
      collectedEvidence(runtimePath, "runtime", runtimeEvidence),
      collectedEvidence(
        qualificationPath,
        "qualification",
        qualificationEvidence,
      ),
      collectedEvidence(doubleClickPath, "doubleClick", doubleClickEvidence),
      collectedEvidence(
        extendedMemoryPath,
        "extendedMemory",
        extendedMemoryEvidence,
      ),
    ]);
  if ((safeRuntime.status !== "unavailable"
      && safeRuntime.officialSha256 !== wasm.sha256)
    || (safeDoubleClick.status === "proved"
      && safeDoubleClick.officialSha256 !== wasm.sha256)
    || (safeExtendedMemory.status === "proved"
      && safeExtendedMemory.jsInputSha256 !== js.sha256)) {
    throw new Error("evidence files do not describe the supplied official artifacts");
  }
  const repository = githubRepository(environment.GITHUB_REPOSITORY);
  const runId = githubRunId(environment.GITHUB_RUN_ID);
  return Object.freeze({
    formatVersion: 1,
    codeGeneration: digest(generation, "code generation"),
    recordedAt: new Date().toISOString(),
    source: Object.freeze({
      repository,
      commit: gitCommit(environment.GITHUB_SHA),
      runId,
      runAttempt: integer(Number(environment.GITHUB_RUN_ATTEMPT), "GITHUB_RUN_ATTEMPT"),
      workflowUrl: `https://github.com/${repository}/actions/runs/${runId}`,
      node: process.version,
    }),
    artifacts: Object.freeze({ wasm, js }),
    outcome: generationOutcome(
      safeRuntime,
      safeQualification,
      safeDoubleClick,
      safeExtendedMemory,
    ),
    runtime: safeRuntime,
    qualification: safeQualification,
    nativeDoubleClick: safeDoubleClick,
    extendedMemory: safeExtendedMemory,
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(
    await createClientRecertificationEvidence(process.argv.slice(2)),
    null,
    2,
  )}\n`);
}
