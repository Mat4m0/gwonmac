/**
 * Owns the strict evidence parser, deterministic bitset encoding, comparison,
 * and offline merge algebra used by both the app and developer tools.
 */
import { createHash } from "node:crypto";
import {
  CARTOGRAPHY_EVIDENCE_FORMAT,
  CARTOGRAPHY_INSTANCE_TYPES,
  CARTOGRAPHY_KERNEL_STATUSES,
  CARTOGRAPHY_MAX_CONTINENT_CELLS,
  CARTOGRAPHY_MAX_TERRAIN_CELLS,
  CARTOGRAPHY_UNAVAILABLE_REASONS,
  type CartographyCurrentInstanceEvidence,
  type CartographyEncodedBitset,
  type CartographyEvidenceDraft,
  type CartographyEvidenceReport,
  type CartographyKernelDiagnostic,
} from "../../shared/cartography-evidence.js";
import { ValidationError } from "../../shared/errors.js";

const DIGEST = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const VERSION = /^\d{4}\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === expected.length
    && sortedExpected.every((key, index) => key === actual[index]);
}

function uint(value: unknown, maximum = 0xffff_ffff): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function positiveUint(value: unknown, maximum = 0xffff_ffff): value is number {
  return uint(value, maximum) && Number(value) > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function closed<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** RFC-8785-like canonical JSON for this integer/fixed-string contract. */
export function canonicalCartographyJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalCartographyJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalCartographyJson(value[key])}`).join(",")}}`;
  }
  throw new ValidationError("value is not canonical Cartography JSON");
}

function bitsetBytes(words: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    view.setUint32(index * 4, words[index]!, true);
  }
  return bytes;
}

function countBits(words: Uint32Array): number {
  let count = 0;
  for (const value of words) {
    let word = value;
    while (word !== 0) {
      word &= word - 1;
      count += 1;
    }
  }
  return count;
}

export function encodeCartographyBitset(
  width: number,
  height: number,
  words: Uint32Array,
): CartographyEncodedBitset {
  const cells = width * height;
  if (!positiveUint(width, 8_192) || !positiveUint(height, 8_192)
    || !Number.isSafeInteger(cells) || cells > CARTOGRAPHY_MAX_TERRAIN_CELLS
    || words.length !== Math.ceil(cells / 32)) {
    throw new ValidationError("invalid Cartography bitset dimensions");
  }
  const tail = cells & 31;
  if (tail !== 0 && ((words.at(-1) ?? 0) & ~(0xffff_ffff >>> (32 - tail))) !== 0) {
    throw new ValidationError("Cartography bitset has non-zero tail bits");
  }
  const bytes = bitsetBytes(words);
  return Object.freeze({
    encoding: "u32-le-base64",
    width,
    height,
    setBits: countBits(words),
    sha256: sha256(bytes),
    data: Buffer.from(bytes).toString("base64"),
  });
}

export function decodeCartographyBitset(
  value: CartographyEncodedBitset,
  maximumCells = CARTOGRAPHY_MAX_TERRAIN_CELLS,
): Uint32Array {
  const cells = value.width * value.height;
  if (!positiveUint(value.width, 8_192) || !positiveUint(value.height, 8_192)
    || !Number.isSafeInteger(cells) || cells > maximumCells
    || value.encoding !== "u32-le-base64" || !BASE64.test(value.data)) {
    throw new ValidationError("invalid Cartography bitset");
  }
  const bytes = Buffer.from(value.data, "base64");
  const words = Math.ceil(cells / 32);
  if (bytes.byteLength !== words * 4 || sha256(bytes) !== value.sha256) {
    throw new ValidationError("Cartography bitset digest or length differs");
  }
  const result = new Uint32Array(words);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < words; index += 1) {
    result[index] = view.getUint32(index * 4, true);
  }
  const tail = cells & 31;
  if (tail !== 0 && ((result.at(-1) ?? 0) & ~(0xffff_ffff >>> (32 - tail))) !== 0) {
    throw new ValidationError("Cartography bitset has non-zero tail bits");
  }
  if (countBits(result) !== value.setBits) {
    throw new ValidationError("Cartography bitset count differs");
  }
  return result;
}

function validateEncodedBitset(
  value: unknown,
  maximumCells: number,
  path: string,
  errors: string[],
): value is CartographyEncodedBitset {
  if (!isRecord(value) || !exactKeys(value, [
    "encoding", "width", "height", "setBits", "sha256", "data",
  ])) {
    errors.push(`${path} has an invalid field surface`);
    return false;
  }
  if (value.encoding !== "u32-le-base64" || !positiveUint(value.width, 8_192)
    || !positiveUint(value.height, 8_192) || !uint(value.setBits)
    || !digest(value.sha256) || typeof value.data !== "string") {
    errors.push(`${path} has invalid scalar fields`);
    return false;
  }
  try {
    decodeCartographyBitset(value as CartographyEncodedBitset, maximumCells);
  } catch {
    errors.push(`${path} has invalid encoded data`);
    return false;
  }
  return true;
}

function validatePoint(value: unknown, path: string, errors: string[]): boolean {
  if (!isRecord(value) || !exactKeys(value, ["x", "y"])
    || !finite(value.x) || !finite(value.y)) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function validateKernel(
  value: unknown,
  path: string,
  errors: string[],
): value is CartographyKernelDiagnostic {
  const keys = [
    "status", "reason", "planeCount", "totalTrapezoids",
    "reachableTrapezoids", "groundCells", "doorwayCount", "terrainWidth",
    "terrainHeight", "planeLimit", "trapezoidLimit", "doorwayLimit",
    "terrainCellLimit",
  ];
  if (!isRecord(value) || !exactKeys(value, keys)
    || !closed(value.status, CARTOGRAPHY_KERNEL_STATUSES)
    || !(value.reason === null || closed(value.reason, CARTOGRAPHY_UNAVAILABLE_REASONS))
    || !keys.slice(2).every((key) => uint(value[key]))) {
    errors.push(`${path} is invalid`);
    return false;
  }
  const allowedReasons: Readonly<Record<CartographyKernelDiagnostic["status"], readonly string[]>> = {
    ready: [],
    "invalid-input": ["invalid-input", "path-array-invalid"],
    unavailable: [
      "not-observed", "context", "loading", "companion", "map-mismatch",
      "anchor", "exploration", "kernel", "epoch-mismatch", "global-mask",
    ],
    limit: ["plane-limit", "trapezoid-limit", "doorway-limit", "terrain-raster-limit"],
    "no-start": ["no-start"],
    "ambiguous-layout": ["ambiguous-layout"],
  };
  const status = value.status as CartographyKernelDiagnostic["status"];
  const reason = value.reason;
  const terrainCells = Number(value.terrainWidth) * Number(value.terrainHeight);
  const readyCountsFit = Number(value.planeCount) <= Number(value.planeLimit)
    && Number(value.totalTrapezoids) <= Number(value.trapezoidLimit)
    && Number(value.doorwayCount) <= Number(value.doorwayLimit)
    && Number.isSafeInteger(terrainCells)
    && terrainCells <= Number(value.terrainCellLimit);
  if ((status === "ready" ? reason !== null : typeof reason !== "string"
      || !allowedReasons[status].includes(reason))
    || Number(value.reachableTrapezoids) > Number(value.totalTrapezoids)
    || (status === "ready" && !readyCountsFit)) {
    errors.push(`${path} counts or status are inconsistent`);
    return false;
  }
  return true;
}

function sameShape(left: CartographyEncodedBitset, right: CartographyEncodedBitset): boolean {
  return left.width === right.width && left.height === right.height;
}

function combineWords(
  left: Uint32Array,
  right: Uint32Array,
  operation: (left: number, right: number) => number,
): Uint32Array {
  if (left.length !== right.length) throw new ValidationError("bitset lengths differ");
  return Uint32Array.from(left, (value, index) => operation(value, right[index]!) >>> 0);
}

function validateContinent(value: unknown, errors: string[]): value is CartographyEvidenceReport["continent"] {
  if (!isRecord(value) || (value.status !== "ready" && value.status !== "unavailable")) {
    errors.push("continent is invalid");
    return false;
  }
  if (value.status === "unavailable") {
    if (!exactKeys(value, ["status", "reason"])
      || !closed(value.reason, CARTOGRAPHY_UNAVAILABLE_REASONS)) {
      errors.push("unavailable continent is invalid");
      return false;
    }
    return true;
  }
  if (!exactKeys(value, [
    "status", "continentId", "explored", "creditable", "remainingEstimate",
  ]) || !uint(value.continentId, 5)) {
    errors.push("ready continent is invalid");
    return false;
  }
  const explored = validateEncodedBitset(
    value.explored, CARTOGRAPHY_MAX_CONTINENT_CELLS, "continent.explored", errors,
  );
  const creditable = validateEncodedBitset(
    value.creditable, CARTOGRAPHY_MAX_CONTINENT_CELLS, "continent.creditable", errors,
  );
  const remaining = validateEncodedBitset(
    value.remainingEstimate, CARTOGRAPHY_MAX_CONTINENT_CELLS,
    "continent.remainingEstimate", errors,
  );
  if (!explored || !creditable || !remaining) return false;
  if (!sameShape(value.explored as CartographyEncodedBitset, value.creditable as CartographyEncodedBitset)
    || !sameShape(value.explored as CartographyEncodedBitset, value.remainingEstimate as CartographyEncodedBitset)) {
    errors.push("continent bitset dimensions differ");
    return false;
  }
  const exploredWords = decodeCartographyBitset(value.explored as CartographyEncodedBitset);
  const creditableWords = decodeCartographyBitset(value.creditable as CartographyEncodedBitset);
  const expected = encodeCartographyBitset(
    (value.explored as CartographyEncodedBitset).width,
    (value.explored as CartographyEncodedBitset).height,
    combineWords(creditableWords, exploredWords, (allowed, seen) => allowed & ~seen),
  );
  if (expected.sha256 !== (value.remainingEstimate as CartographyEncodedBitset).sha256) {
    errors.push("continent remaining estimate is not creditable minus explored");
    return false;
  }
  return true;
}

function validateCurrent(
  value: unknown,
  continent: CartographyEvidenceReport["continent"] | null,
  source: CartographyEvidenceReport["source"] | null,
  errors: string[],
): value is CartographyCurrentInstanceEvidence | null {
  if (value === null) return true;
  if (!isRecord(value) || (value.status !== "ready" && value.status !== "unavailable")) {
    errors.push("currentInstance is invalid");
    return false;
  }
  if (value.status === "unavailable") {
    if (!exactKeys(value, [
      "status", "reason", "mapId", "areaEpoch", "resourceGeneration", "kernel",
    ]) || !closed(value.reason, CARTOGRAPHY_UNAVAILABLE_REASONS)
      || !(value.mapId === null || positiveUint(value.mapId, 2_000))
      || !(value.areaEpoch === null || positiveUint(value.areaEpoch))
      || !(value.resourceGeneration === null || positiveUint(value.resourceGeneration))
      || !(value.kernel === null || validateKernel(value.kernel, "currentInstance.kernel", errors))) {
      errors.push("unavailable currentInstance is invalid");
      return false;
    }
    return true;
  }
  if (!exactKeys(value, [
    "status", "mapId", "instanceType", "areaEpoch", "resourceGeneration",
    "revealRadius", "worldAnchor", "mapBounds", "reachable", "actionable",
    "terrain", "kernel",
  ]) || !positiveUint(value.mapId, 2_000)
    || !closed(value.instanceType, CARTOGRAPHY_INSTANCE_TYPES)
    || !positiveUint(value.areaEpoch) || !positiveUint(value.resourceGeneration)
    || !(value.revealRadius === 1 || value.revealRadius === 3)
    || !validatePoint(value.worldAnchor, "currentInstance.worldAnchor", errors)
    || !isRecord(value.mapBounds) || !exactKeys(value.mapBounds, ["min", "max"])
    || !validatePoint(value.mapBounds.min, "currentInstance.mapBounds.min", errors)
    || !validatePoint(value.mapBounds.max, "currentInstance.mapBounds.max", errors)
    || !isRecord(value.terrain) || !exactKeys(value.terrain, [
      "mapLeft", "mapTop", "mapUnitsPerPixel", "cells",
    ]) || !finite(value.terrain.mapLeft) || !finite(value.terrain.mapTop)
    || !finite(value.terrain.mapUnitsPerPixel) || Number(value.terrain.mapUnitsPerPixel) <= 0
    || !validateKernel(value.kernel, "currentInstance.kernel", errors)
    || (value.kernel as CartographyKernelDiagnostic).status !== "ready") {
    errors.push("ready currentInstance has invalid metadata");
    return false;
  }
  const reachable = validateEncodedBitset(
    value.reachable, CARTOGRAPHY_MAX_CONTINENT_CELLS, "currentInstance.reachable", errors,
  );
  const actionable = validateEncodedBitset(
    value.actionable, CARTOGRAPHY_MAX_CONTINENT_CELLS, "currentInstance.actionable", errors,
  );
  const terrain = validateEncodedBitset(
    value.terrain.cells, CARTOGRAPHY_MAX_TERRAIN_CELLS, "currentInstance.terrain.cells", errors,
  );
  if (!reachable || !actionable || !terrain || continent?.status !== "ready" || source === null
    || source.clientSha256 === null || source.kernelSha256 === null || source.layoutId === null) {
    errors.push("ready currentInstance requires ready continent and exact source revisions");
    return false;
  }
  const readyContinent = continent;
  if (!sameShape(value.reachable as CartographyEncodedBitset, readyContinent.explored)
    || !sameShape(value.actionable as CartographyEncodedBitset, readyContinent.explored)) {
    errors.push("currentInstance cell dimensions differ from continent");
    return false;
  }
  const reachableWords = decodeCartographyBitset(value.reachable as CartographyEncodedBitset);
  const actionableWords = decodeCartographyBitset(value.actionable as CartographyEncodedBitset);
  const exploredWords = decodeCartographyBitset(readyContinent.explored);
  const creditableWords = decodeCartographyBitset(readyContinent.creditable);
  for (let index = 0; index < actionableWords.length; index += 1) {
    const action = actionableWords[index]!;
    if ((action & ~reachableWords[index]!) !== 0
      || (action & exploredWords[index]!) !== 0
      || (action & ~creditableWords[index]!) !== 0) {
      errors.push("actionable cells violate live evidence semantics");
      return false;
    }
  }
  const bounds = value.mapBounds as { min: { x: number; y: number }; max: { x: number; y: number } };
  if (!(bounds.max.x > bounds.min.x && bounds.max.y > bounds.min.y)
    || (value.kernel as CartographyKernelDiagnostic).terrainWidth
      !== (value.terrain.cells as CartographyEncodedBitset).width
    || (value.kernel as CartographyKernelDiagnostic).terrainHeight
      !== (value.terrain.cells as CartographyEncodedBitset).height) {
    errors.push("currentInstance bounds or terrain diagnostics differ");
    return false;
  }
  return true;
}

function content(report: CartographyEvidenceDraft | CartographyEvidenceReport) {
  return {
    formatVersion: report.formatVersion,
    source: report.source,
    continent: report.continent,
    currentInstance: report.currentInstance,
  };
}

export function cartographyEvidenceContentSha256(
  report: CartographyEvidenceDraft | CartographyEvidenceReport,
): string {
  return sha256(canonicalCartographyJson(content(report)));
}

export function validateCartographyEvidence(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value) || !exactKeys(value, [
    "formatVersion", "reportId", "capturedAt", "contentSha256", "source",
    "continent", "currentInstance",
  ])) return ["report has an invalid field surface"];
  if (value.formatVersion !== CARTOGRAPHY_EVIDENCE_FORMAT
    || typeof value.reportId !== "string" || !UUID.test(value.reportId)
    || typeof value.capturedAt !== "string"
    || Number.isNaN(Date.parse(value.capturedAt))
    || new Date(value.capturedAt).toISOString() !== value.capturedAt
    || !digest(value.contentSha256)) errors.push("report metadata is invalid");
  const source = isRecord(value.source) && exactKeys(value.source, [
    "applicationVersion", "clientSha256", "layoutId", "gridRevision",
    "toolboxSha256", "kernelSha256",
  ]) && typeof value.source.applicationVersion === "string"
    && VERSION.test(value.source.applicationVersion)
    && (value.source.clientSha256 === null || digest(value.source.clientSha256))
    && (value.source.layoutId === null || value.source.layoutId === 1 || value.source.layoutId === 2)
    && positiveUint(value.source.gridRevision)
    && digest(value.source.toolboxSha256)
    && (value.source.kernelSha256 === null || digest(value.source.kernelSha256));
  if (!source) errors.push("report source is invalid");
  const continent = validateContinent(value.continent, errors);
  validateCurrent(
    value.currentInstance,
    continent ? value.continent as CartographyEvidenceReport["continent"] : null,
    source ? value.source as CartographyEvidenceReport["source"] : null,
    errors,
  );
  if (errors.length === 0) {
    const report = value as unknown as CartographyEvidenceReport;
    if (cartographyEvidenceContentSha256(report) !== report.contentSha256) {
      errors.push("report content digest differs");
    }
  }
  return errors;
}

export function parseCartographyEvidence(value: unknown): CartographyEvidenceReport {
  const errors = validateCartographyEvidence(value);
  if (errors.length !== 0) throw new ValidationError(errors.join("; "));
  return value as CartographyEvidenceReport;
}

export function sealCartographyEvidence(draft: CartographyEvidenceDraft): CartographyEvidenceReport {
  return parseCartographyEvidence({
    ...draft,
    contentSha256: cartographyEvidenceContentSha256(draft),
  });
}

export type CartographyBitsetComparison = Readonly<{
  leftSetBits: number;
  rightSetBits: number;
  agreementCells: number;
  union: CartographyEncodedBitset;
  intersection: CartographyEncodedBitset;
  xor: CartographyEncodedBitset;
  onlyLeft: CartographyEncodedBitset;
  onlyRight: CartographyEncodedBitset;
}>;

function compareBitsets(
  left: CartographyEncodedBitset,
  right: CartographyEncodedBitset,
): CartographyBitsetComparison {
  if (!sameShape(left, right)) throw new ValidationError("bitset dimensions differ");
  const a = decodeCartographyBitset(left);
  const b = decodeCartographyBitset(right);
  const make = (operation: (left: number, right: number) => number) =>
    encodeCartographyBitset(left.width, left.height, combineWords(a, b, operation));
  const xor = make((x, y) => x ^ y);
  return Object.freeze({
    leftSetBits: left.setBits,
    rightSetBits: right.setBits,
    agreementCells: left.width * left.height - xor.setBits,
    union: make((x, y) => x | y),
    intersection: make((x, y) => x & y),
    xor,
    onlyLeft: make((x, y) => x & ~y),
    onlyRight: make((x, y) => y & ~x),
  });
}

function readyContinent(report: CartographyEvidenceReport) {
  if (report.continent.status !== "ready") {
    throw new ValidationError("continent exploration is unavailable");
  }
  return report.continent;
}

function assertContinentCompatible(
  left: CartographyEvidenceReport,
  right: CartographyEvidenceReport,
): void {
  const a = readyContinent(left);
  const b = readyContinent(right);
  if (a.continentId !== b.continentId
    || left.source.gridRevision !== right.source.gridRevision
    || left.source.toolboxSha256 !== right.source.toolboxSha256
    || !sameShape(a.explored, b.explored)
    || a.creditable.sha256 !== b.creditable.sha256) {
    throw new ValidationError("continent evidence is incompatible");
  }
}

function currentReady(report: CartographyEvidenceReport) {
  return report.currentInstance?.status === "ready" ? report.currentInstance : null;
}

export function compareCartographyEvidence(
  left: CartographyEvidenceReport,
  right: CartographyEvidenceReport,
) {
  assertContinentCompatible(left, right);
  const a = readyContinent(left);
  const b = readyContinent(right);
  const leftCurrent = currentReady(left);
  const rightCurrent = currentReady(right);
  let currentInstance = null;
  if (leftCurrent !== null && rightCurrent !== null) {
    if (leftCurrent.mapId !== rightCurrent.mapId
      || leftCurrent.instanceType !== rightCurrent.instanceType
      || leftCurrent.revealRadius !== rightCurrent.revealRadius
      || left.source.clientSha256 !== right.source.clientSha256
      || left.source.layoutId !== right.source.layoutId
      || left.source.kernelSha256 !== right.source.kernelSha256) {
      throw new ValidationError("current-instance evidence is incompatible");
    }
    currentInstance = Object.freeze({
      mapId: leftCurrent.mapId,
      reachable: compareBitsets(leftCurrent.reachable, rightCurrent.reachable),
      actionable: compareBitsets(leftCurrent.actionable, rightCurrent.actionable),
    });
  }
  return Object.freeze({
    formatVersion: 1,
    compatibility: Object.freeze({
      continentId: a.continentId,
      width: a.explored.width,
      height: a.explored.height,
      gridRevision: left.source.gridRevision,
      toolboxSha256: left.source.toolboxSha256,
    }),
    explored: compareBitsets(a.explored, b.explored),
    currentInstance,
  });
}

export function mergeCartographyEvidence(reports: readonly CartographyEvidenceReport[]) {
  if (reports.length === 0 || reports.length > 1_024) {
    throw new ValidationError("expected between 1 and 1024 Cartography reports");
  }
  for (const report of reports.slice(1)) assertContinentCompatible(reports[0]!, report);
  const first = readyContinent(reports[0]!);
  const unique = new Map<string, CartographyEvidenceReport>();
  for (const report of reports) {
    const continent = readyContinent(report);
    if (!unique.has(continent.explored.sha256)) unique.set(continent.explored.sha256, report);
  }
  const snapshots = [...unique.values()].sort((left, right) =>
    readyContinent(left).explored.sha256.localeCompare(readyContinent(right).explored.sha256));
  const decoded = snapshots.map((report) => decodeCartographyBitset(readyContinent(report).explored));
  const words = decoded[0]!.length;
  const union = new Uint32Array(words);
  const intersection = new Uint32Array(decoded[0]!);
  const xor = new Uint32Array(words);
  const support = new Uint16Array(first.explored.width * first.explored.height);
  for (const bitmap of decoded) {
    for (let word = 0; word < words; word += 1) {
      union[word] = (union[word]! | bitmap[word]!) >>> 0;
      intersection[word] = (intersection[word]! & bitmap[word]!) >>> 0;
      xor[word] = (xor[word]! ^ bitmap[word]!) >>> 0;
      let value = bitmap[word]!;
      while (value !== 0) {
        const bit = 31 - Math.clz32(value & -value);
        const index = word * 32 + bit;
        if (index < support.length) support[index] = support[index]! + 1;
        value &= value - 1;
      }
    }
  }
  const creditable = decodeCartographyBitset(first.creditable);
  const encode = (value: Uint32Array) =>
    encodeCartographyBitset(first.explored.width, first.explored.height, value);
  const supportBytes = new Uint8Array(support.length * 2);
  const supportView = new DataView(supportBytes.buffer);
  support.forEach((value, index) => supportView.setUint16(index * 2, value, true));
  const disagreement = combineWords(union, intersection, (either, both) => either & ~both);
  return Object.freeze({
    formatVersion: 1,
    compatibility: Object.freeze({
      continentId: first.continentId,
      width: first.explored.width,
      height: first.explored.height,
      gridRevision: reports[0]!.source.gridRevision,
      toolboxSha256: reports[0]!.source.toolboxSha256,
    }),
    inputReports: reports.length,
    uniqueExplorationSnapshots: snapshots.length,
    duplicateSnapshots: reports.length - snapshots.length,
    union: encode(union),
    intersection: encode(intersection),
    xor: encode(xor),
    disagreement: encode(disagreement),
    observedOutsideCreditable: encode(
      combineWords(union, creditable, (observed, allowed) => observed & ~allowed),
    ),
    creditableNotObserved: encode(
      combineWords(creditable, union, (allowed, observed) => allowed & ~observed),
    ),
    supportCounts: Object.freeze({
      encoding: "u16-le-base64" as const,
      width: first.explored.width,
      height: first.explored.height,
      maximum: snapshots.length,
      sha256: sha256(supportBytes),
      data: Buffer.from(supportBytes).toString("base64"),
    }),
  });
}
