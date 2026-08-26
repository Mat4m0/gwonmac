/** Feature-owned semantic proof for the complete Template-saving rewrite path. */
import { createHash } from "node:crypto";
import { readSleb, readUleb } from "../core/wasm-binary.js";
import type { BridgeKind, KnownTemplateSaveBuild } from "./template-save-compat.js";
import {
  TEMPLATE_STATIC_ANCHORS,
  type StaticOperand,
  type StaticRelocation,
  type TemplateCallerRole,
  type TemplateStaticStorage,
} from "./template-save-static-anchors.js";
import {
  templateCallNeedle as callNeedle,
  type TemplateSaveModuleView,
} from "./template-save-module-view.js";

interface LocatedTarget { readonly localFunction: number }
export interface TemplateSemanticLocation {
  readonly view: TemplateSaveModuleView;
  readonly targets: Readonly<Record<BridgeKind, LocatedTarget>>;
  readonly writeFunction: number;
  readonly scans: readonly number[];
  readonly sinks: readonly number[];
}

const text = new TextEncoder();
const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const fail = (message: string): never => {
  throw new Error(`template-save recertify: ${message}`);
};

const memory = (start: number, baseline: number, storage: TemplateStaticStorage) =>
  ({ start, end: start + 5, encoding: "memory-offset" as const, baseline, storage });
const constant = (start: number, baseline: number, storage: TemplateStaticStorage) =>
  ({ start, end: start + 5, encoding: "i32-const" as const, baseline, storage });
const string = (start: number, immutableString: string) =>
  ({ start, end: start + 5, encoding: "i32-const" as const, baseline: 0, immutableString });

/** Every relocatable operand in the six transformed callers. */
const CALLER_RELOCATIONS: Readonly<Record<TemplateCallerRole, readonly StaticRelocation[]>> = {
  delete: [
    memory(21, 2_674_316, "delete-state"), memory(33, 2_674_312, "delete-state"),
    string(48, "../../../../Base/Rtl/Exe\\../..\\rtl\\Array.h"),
    memory(81, 2_674_304, "delete-state"), memory(116, 2_674_300, "delete-state"),
    memory(162, 2_674_300, "delete-state"),
  ],
  "skill-scan": [
    memory(55, 1_447_524, "template-types"), constant(82, 1_447_542, "template-types"),
    constant(109, 1_447_546, "template-types"), constant(402, 1_447_548, "template-types"),
    string(598, "../../../../Gw/Account/Cli/AcctCliTemplate.cpp"),
    constant(645, 1_447_652, "template-types"),
    string(716, "../../../../Base\\rtl\\Array.h"),
    string(850, "../../../../Base\\rtl\\Array.h"),
    memory(959, 1_250_688, "template-hash"), memory(974, 1_250_688, "template-hash"),
  ],
  "equipment-scan": [
    memory(55, 1_447_524, "template-types"), constant(82, 1_447_542, "template-types"),
    constant(109, 1_447_532, "template-types"), constant(423, 1_447_548, "template-types"),
    string(643, "../../../../Gw/Account/Cli/AcctCliTemplate.cpp"),
    constant(697, 1_447_700, "template-types"),
    string(719, "No valid case for switch variable 'type'"),
    string(725, "../../../../Gw/Account/Cli/AcctCliTemplate.cpp"),
    string(747, "../../../../Gw/Account/Cli/AcctCliTemplate.cpp"),
    constant(801, 1_447_668, "template-types"),
    string(866, "../../../../Base\\rtl\\Array.h"),
    string(1007, "../../../../Base\\rtl\\Array.h"),
    memory(1121, 1_250_688, "template-hash"), memory(1131, 1_250_688, "template-hash"),
    memory(1146, 1_250_688, "template-hash"), memory(1176, 1_250_688, "template-hash"),
  ],
  writer: [constant(130, 1_447_532, "template-types")],
  "directory-sink": [
    string(28, "string"), string(34, "../../../../Gw/Chat/CtChatLog.cpp"),
    memory(55, 1_520_752, "directory-types"), memory(70, 1_520_744, "directory-types"),
    memory(85, 1_520_736, "directory-types"), constant(162, 1_520_756, "directory-types"),
    constant(643, 1_520_776, "directory-types"),
  ],
  "screenshot-sink": [
    memory(27, 5_943_272, "screenshot-state"), memory(41, 5_943_296, "screenshot-state"),
    memory(65, 5_943_296, "screenshot-state"), constant(99, 1_556_320, "screenshot-types"),
    string(146, "PathCreateDirectory() failed: %u\n"),
    memory(183, 2_635_884, "screenshot-directory"), constant(282, 1_556_336, "screenshot-types"),
    constant(309, 1_556_356, "screenshot-types"), constant(367, 1_556_388, "screenshot-types"),
    string(691, "No valid case for switch variable '\"\"'"),
    string(697, "../../../../Gw/Ui/UiScreen.cpp"),
    constant(730, 1_556_408, "screenshot-types"),
    string(873, "../../../../Gw/Ui/UiScreen.cpp"), string(900, "srcBits[0]"),
    string(906, "../../../../Gw/Ui/UiScreen.cpp"),
    constant(1013, 1_556_430, "screenshot-types"),
    string(1058, "../../../../Gw/Ui/UiScreen.cpp"), string(1083, "dstBits[0]"),
    string(1089, "../../../../Gw/Ui/UiScreen.cpp"),
    memory(1248, 5_943_276, "screenshot-state"), memory(1262, 5_943_276, "screenshot-state"),
    memory(1294, 5_943_268, "screenshot-state"), memory(1305, 5_943_296, "screenshot-state"),
    string(1329, "No valid case for switch variable '\"\"'"),
    string(1335, "../../../../Gw/Ui/UiScreen.cpp"),
    memory(1373, 5_943_292, "screenshot-state"), memory(1390, 5_943_280, "screenshot-state"),
    memory(1407, 5_943_284, "screenshot-state"), memory(1428, 5_943_288, "screenshot-state"),
    memory(1449, 5_943_288, "screenshot-state"), memory(1473, 5_943_272, "screenshot-state"),
  ],
};

const SCREENSHOT_STATE_BASELINE = 5_943_268;
const SCREENSHOT_INITIALIZER_MEMORY = [
  [7, 4], [26, 8], [58, 0], [136, 12], [153, 16],
  [172, 20], [189, 24], [220, 16], [289, 28], [311, 4],
] as const;
const SCREENSHOT_INITIALIZER_STRINGS = [
  [86, "No valid case for switch variable '\"\"'"],
  [92, "../../../../Gw/Ui/UiScreen.cpp"],
] as const;

function relocationValue(body: Uint8Array, item: StaticOperand): number {
  if (item.encoding === "i32-const") {
    if (body[item.start - 1] !== 0x41) fail(`static relocation at ${item.start} is not i32.const`);
    const cursor = { offset: item.start };
    const value = readSleb(body, cursor);
    if (cursor.offset !== item.end) fail(`static relocation at ${item.start} changed width`);
    return value;
  }
  for (let opcodeAt = Math.max(0, item.start - 6); opcodeAt < item.start; opcodeAt += 1) {
    if (body[opcodeAt]! < 0x28 || body[opcodeAt]! > 0x3e) continue;
    const cursor = { offset: opcodeAt + 1 };
    try {
      readUleb(body, cursor);
      if (cursor.offset !== item.start) continue;
      const value = readUleb(body, cursor);
      if (cursor.offset === item.end) return value;
    } catch { /* keep looking */ }
  }
  return fail(`static relocation at ${item.start} is not a memory offset`);
}

function anchorAddress(
  found: TemplateSemanticLocation,
  storage: Exclude<TemplateStaticStorage, "screenshot-state">,
  cache: Map<TemplateStaticStorage, number>,
): number {
  const cached = cache.get(storage);
  if (cached !== undefined) return cached;
  const anchor = TEMPLATE_STATIC_ANCHORS[storage];
  const address = anchor.kind === "initialized-data"
    ? (() => {
      const matches = found.view.dataAddresses(anchor.bytes);
      if (matches.length !== 1) fail(`initialized static anchor ${storage} changed or is ambiguous`);
      return matches[0]!;
    })()
    : found.view.zeroInitializedBase;
  if (address >= found.view.initialMemoryBytes) fail("static storage is outside initial memory");
  cache.set(storage, address);
  return address;
}

function verifyString(found: TemplateSemanticLocation, value: number, expected: string): void {
  if (found.view.readString(value) !== expected) fail(`immutable reference ${expected} changed`);
  if (expected === "path") {
    const anchor = text.encode("path\0filterPath\0");
    if (found.view.dataOccurrenceCount(anchor) !== 1
      || !found.view.readData(value, anchor.byteLength)?.every(
        (byte, index) => byte === anchor[index],
      )) fail("immutable File::Open path anchor changed or is ambiguous");
    return;
  }
  if (found.view.stringOccurrenceCount(expected) !== 1) fail(`immutable reference ${expected} is ambiguous`);
}

function normalizeCaller(
  found: TemplateSemanticLocation,
  role: TemplateCallerRole,
  source: Uint8Array,
  normalized: Uint8Array,
  anchors: Map<TemplateStaticStorage, number>,
  screenshotBase?: number,
): void {
  const items = CALLER_RELOCATIONS[role];
  if (items.some(({ end }) => end > source.byteLength)) return;
  items.forEach((item, index) => {
    const value = relocationValue(source, item);
    if (item.immutableString !== undefined) {
      verifyString(found, value, item.immutableString);
    } else if (item.storage === "screenshot-state") {
      if (screenshotBase === undefined) return;
      const expected = screenshotBase + item.baseline - SCREENSHOT_STATE_BASELINE;
      if (value !== expected) fail(`screenshot-state reference ${index} is not anchored`);
    } else {
      const anchor = TEMPLATE_STATIC_ANCHORS[item.storage];
      const base = anchorAddress(found, item.storage, anchors);
      if (value !== base + item.baseline - anchor.baseline) {
        fail(`static ${item.storage} reference ${index} is not anchored`);
      }
      if (anchor.kind === "initialized-data" && !found.view.containsInitializedData(value)) {
        fail(`static ${item.storage} reference ${index} is out of bounds`);
      }
    }
    normalized.fill(0, item.start, item.end);
    normalized[item.start] = index + 1;
  });
}

function assignRoles(found: TemplateSemanticLocation): Map<number, TemplateCallerRole> {
  const deleted = [...found.view.callers(found.view.functionIndex(found.targets.deleteFile.localFunction))];
  if (deleted.length !== 1) fail("delete caller role is ambiguous");
  const roles = new Map<number, TemplateCallerRole>([[deleted[0]!, "delete"], [found.writeFunction, "writer"]]);
  const assign = (candidates: readonly number[], expected: readonly [TemplateCallerRole, TemplateCallerRole]) => {
    const matches = expected.map((role) => candidates.filter((local) => {
      const source = found.view.bodies[local]!;
      if (CALLER_RELOCATIONS[role].some(({ end }) => end > source.byteLength)) return false;
      try { normalizeCaller(found, role, source, source.slice(), new Map()); return true; } catch { return false; }
    }));
    if (!(matches.every((match) => match.length === 1) && matches[0]![0] !== matches[1]![0])) {
      const productionSized = candidates.some((local) => expected.some((role) =>
        CALLER_RELOCATIONS[role].every(({ end }) => end <= found.view.bodies[local]!.byteLength)));
      if (productionSized) fail(`${expected.join("/")} role evidence is ambiguous`);
      expected.forEach((role, index) => roles.set(candidates[index]!, role));
      return;
    }
    expected.forEach((role, index) => roles.set(matches[index]![0]!, role));
  };
  assign(found.scans, ["skill-scan", "equipment-scan"]);
  assign(found.sinks, ["directory-sink", "screenshot-sink"]);
  return roles;
}

function screenshotFamily(found: TemplateSemanticLocation, sink: number): {
  base: number; initializer: number; normalizedInitializer: Uint8Array;
} {
  const sinkBody = found.view.bodies[sink]!;
  if (sinkBody.byteLength < 1_478) {
    return { base: 0, initializer: -1, normalizedInitializer: new Uint8Array() };
  }
  const base = relocationValue(sinkBody, memory(1294, SCREENSHOT_STATE_BASELINE, "screenshot-state"));
  const parents = [...found.view.callers(found.view.functionIndex(sink))];
  if (parents.length !== 1) fail("screenshot sink parent is ambiguous");
  const parent = found.view.instructions(parents[0]!);
  const candidates = [...parent.calls.keys()].flatMap((target) => {
    const local = target - found.view.importCount;
    const body = found.view.bodies[local];
    if (!body || local === sink || body.byteLength < 314) return [];
    try {
      for (const [start, relative] of SCREENSHOT_INITIALIZER_MEMORY) {
        if (relocationValue(body, memory(start, 0, "screenshot-state")) !== base + relative) return [];
      }
      for (const [start, expected] of SCREENSHOT_INITIALIZER_STRINGS) {
        verifyString(found, relocationValue(body, string(start, expected)), expected);
      }
      return [local];
    } catch { return []; }
  });
  if (candidates.length !== 1) fail("screenshot-state initializer is ambiguous");
  const initializer = candidates[0]!;

  const expected = new Set<string>();
  for (const [start, relative] of SCREENSHOT_INITIALIZER_MEMORY) {
    expected.add(`${initializer}:${start}:${base + relative}`);
  }
  for (const item of CALLER_RELOCATIONS["screenshot-sink"]) {
    if (item.immutableString === undefined && item.storage === "screenshot-state") {
      expected.add(`${sink}:${item.start}:${base + item.baseline - SCREENSHOT_STATE_BASELINE}`);
    }
  }
  const actual = new Set<string>();
  found.view.bodies.forEach((_, local) => {
    for (const site of found.view.instructions(local).memorySites) {
      if (site.value >= base && site.value <= base + 28) {
        actual.add(`${local}:${site.operandStart}:${site.value}`);
      }
    }
  });
  if (actual.size !== expected.size || [...expected].some((site) => !actual.has(site))) {
    fail("screenshot-state occurrence ledger is incomplete");
  }

  const normalizedInitializer = found.view.bodies[initializer]!.slice();
  SCREENSHOT_INITIALIZER_MEMORY.forEach(([start], index) => {
    normalizedInitializer.fill(0, start, start + 5);
    normalizedInitializer[start] = index + 1;
  });
  SCREENSHOT_INITIALIZER_STRINGS.forEach(([start], index) => {
    normalizedInitializer.fill(0, start, start + 5);
    normalizedInitializer[start] = 32 + index;
  });
  return { base, initializer, normalizedInitializer };
}

const FILE_OPEN_RELOCATIONS = [
  string(30, "path"), string(36, "../../../../Base/Rtl/File.cpp"),
  string(243, "../../../../Base/Rtl/File.cpp"), string(313, "HFile"),
] as const;
const FILE_OPEN_VTABLE_PREFIX = Uint8Array.of(
  0x5a, 0, 0, 0, 0x5b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x5c, 0, 0, 0, 0x5d, 0, 0, 0, 0x5e, 0, 0, 0, 0x5f, 0, 0, 0,
);
function fileExistsFingerprint(found: TemplateSemanticLocation): string {
  const source = found.view.bodies[found.targets.fileExists.localFunction]!;
  if (source.byteLength < 318) return sha256(source);
  const normalized = source.slice();
  FILE_OPEN_RELOCATIONS.forEach((item, index) => {
    verifyString(found, relocationValue(source, item), item.immutableString!);
    normalized.fill(0, item.start, item.end); normalized[item.start] = index + 1;
  });
  const vtable: StaticOperand = { start: 295, end: 300, encoding: "i32-const", baseline: 0 };
  const pointer = relocationValue(source, vtable);
  const content = found.view.readData(pointer, FILE_OPEN_VTABLE_PREFIX.byteLength);
  if (!content || !FILE_OPEN_VTABLE_PREFIX.every((byte, index) => content[index] === byte)
    || found.view.dataOccurrenceCount(FILE_OPEN_VTABLE_PREFIX) !== 1) {
    fail("File::Open immutable vtable reference changed or is ambiguous");
  }
  normalized.fill(0, 295, 300); normalized[295] = 16;
  return sha256(normalized);
}

export function templateSemanticFingerprint(
  found: TemplateSemanticLocation,
  entry: KnownTemplateSaveBuild,
): string {
  const callerRoles = assignRoles(found);
  const screenshotSink = [...callerRoles].find(([, role]) => role === "screenshot-sink")?.[0]
    ?? fail("screenshot sink role is missing");
  const screenshot = screenshotFamily(found, screenshotSink);
  const tags = new Map<BridgeKind, number>(entry.bridges.map((bridge, index) => [bridge.kind, index + 1]));
  const touched = new Map<number, string[]>();
  for (const bridge of entry.bridges) for (const site of bridge.callSites) {
    const values = touched.get(site.localFunction) ?? [];
    values.push(`${bridge.kind}:${site.bodyOffset}`); touched.set(site.localFunction, values);
  }
  const anchors = new Map<TemplateStaticStorage, number>();
  const callers = [...touched].map(([local, relations]) => {
    const source = found.view.bodies[local]!;
    const normalized = source.slice();
    const role = callerRoles.get(local) ?? fail(`semantic caller ${local} has no feature role`);
    normalizeCaller(found, role, source, normalized, anchors, screenshot.base);
    for (const bridge of entry.bridges) for (const site of bridge.callSites) {
      if (site.localFunction !== local) continue;
      const expected = callNeedle(found.view.functionIndex(bridge.stubFunction));
      if (!expected.every((byte, index) => source[site.bodyOffset + index] === byte)) {
        fail(`semantic ${bridge.kind} call site signature mismatch`);
      }
      normalized.fill(0, site.bodyOffset + 1, site.bodyOffset + expected.byteLength);
      normalized[site.bodyOffset + 1] = tags.get(bridge.kind)!;
    }
    if (role === "screenshot-sink" && screenshot.initializer >= 0) {
      const helperSite = found.view.instructions(local).callSites;
      const helper = [...helperSite].find(([, sites]) => sites.some((site) => site.offset === 156));
      if (!helper || helper[1].length !== 1) fail("screenshot helper relation changed");
      const provedHelper = helper!;
      const helperLocal = provedHelper[0] - found.view.importCount;
      const helperBody = found.view.bodies[helperLocal];
      if (!helperBody || helperBody.byteLength !== 2 || helperBody[0] !== 0 || helperBody[1] !== 0x0b
        || found.view.callers(provedHelper[0]).size !== 1) fail("screenshot helper identity changed");
      normalized.fill(0, 157, 162); normalized[157] = 63;
    }
    return { role, relations: [...relations].sort(), bodySha256: sha256(normalized) };
  }).sort((left, right) => left.role.localeCompare(right.role));
  return sha256(text.encode(JSON.stringify({
    callers,
    fileExistsBodySha256: fileExistsFingerprint(found),
    screenshotInitializerBodySha256: sha256(screenshot.normalizedInitializer),
  })));
}
