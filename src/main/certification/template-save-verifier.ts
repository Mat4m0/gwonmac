/**
 * Re-derive a `KnownTemplateSaveBuild` entry from a client WASM, by shape
 * rather than by remembered index.
 *
 * The launcher runs this logic in a disposable utility process when ArenaNet
 * publishes an unknown client hash. Developer tooling imports the same
 * implementation, so a manual report and the production decision cannot drift.
 *
 * Every number in the certified table belongs to one exact build, and ArenaNet
 * updates the client automatically. Recovering them by hand takes hours; this
 * recovers them in seconds and hands the result to the production transform for
 * validation. It removes the index-recovery work, not the semantic work — see
 * internal/upstream/recertify.md, which still owns re-measuring what the path
 * helpers actually do.
 *
 * Two measured facts make this cheap. Byte-scanning for the six-byte padded
 * `call` needle locates every call site with no false positives, so no
 * whole-module instruction decoder is needed. And caller-set intersection
 * identifies every target, so source-file attribution is not needed either —
 * which is just as well, because the most important call site here references
 * no source string at all.
 */
import { createHash } from "node:crypto";
import {
  countFunctionImports,
  functionImportIndex,
  indexOfBytes,
  paddedIndex,
  parseCode,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  sectionById,
  splitSections,
  uleb,
  valueTypeName,
  type FunctionType,
} from "../core/wasm-binary.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type CallSite,
  type KnownTemplateSaveBuild,
  type StubBridge,
} from "./template-save-compat.js";

const CARRIER_IMPORT_NAME = "__syscall_newfstatat";
const ASSERT_HOOK_IMPORT_NAME = "emscripten_asm_const_int";

/** Shipped bodies of the four unimplemented routines. */
const CREATE_DIRECTORY_BODY = [0x00, 0x41, 0x02, 0x0b];
const FIND_FILES_BODY = [0x00, 0x0b];
const FILE_BASE_NAME_BODY = [0x00, 0x41, 0x00, 0x0b];
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

export type TargetName = BridgeKind | "assertHandler";

export interface LocatedFunction {
  /** Index into the code section, i.e. function index minus the import count. */
  readonly localFunction: number;
  readonly functionIndex: number;
  readonly signature: string;
  readonly bodyBytes: readonly number[];
  readonly callers: readonly number[];
  readonly rejected: readonly number[];
}

export interface TemplateSaveAnalysis {
  readonly sha256: string;
  readonly validWasm: boolean;
  readonly status: "derived" | "not-applicable" | "failed";
  readonly importCount: number | null;
  readonly carrierImport: number | null;
  readonly targets: Partial<Record<TargetName, LocatedFunction>>;
  readonly callSites: Partial<Record<BridgeKind, readonly CallSite[]>>;
  readonly deleteAssertion: { message: string; file: string; line: number } | null;
  readonly encodings: { padded: number; canonical: number };
  readonly entry: KnownTemplateSaveBuild | null;
  readonly semanticFingerprint: string | null;
  readonly diagnostics: readonly string[];
}

class RecertError extends Error {
  constructor(message: string) {
    super(`template-save recertify: ${message}`);
  }
}

function fail(message: string): never {
  throw new RecertError(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function signatureText(type: FunctionType): string {
  const side = (values: number[]) => values.map(valueTypeName).join(",");
  return `(${side(type.params)})->(${side(type.results)})`;
}

function sameBytes(body: Uint8Array, expected: ArrayLike<number>): boolean {
  return (
    body.byteLength === expected.length
    && Array.from(expected).every((byte, index) => body[index] === byte)
  );
}

/**
 * Everything the locators need, read once. Function bodies are indexed by local
 * index; callers are computed by scanning for the padded `call` needle.
 */
class ModuleView {
  readonly input: Uint8Array;
  readonly importSection: Uint8Array;
  readonly importCount: number;
  readonly bodies: Uint8Array[];
  readonly signatures: string[];
  readonly dataSegments: { base: number; bytes: Uint8Array }[];
  private readonly callerCache = new Map<number, Set<number>>();

  constructor(input: Uint8Array) {
    this.input = input;
    const sections = splitSections(input);
    this.importSection = sectionById(sections, 2);
    this.importCount = countFunctionImports(this.importSection);
    const types = parseTypes(sectionById(sections, 1));
    this.signatures = parseIndexVector(sectionById(sections, 3)).map(
      (index) => signatureText(types[index] ?? fail(`unknown type ${index}`)),
    );
    this.bodies = parseCode(sectionById(sections, 10));
    if (this.signatures.length !== this.bodies.length) {
      fail("function and code sections disagree");
    }
    this.dataSegments = parseDataSegments(sections);
  }

  functionIndex(local: number): number {
    return this.importCount + local;
  }

  /** Local indices of every function containing a padded call to `target`. */
  callers(functionIndex: number): Set<number> {
    const cached = this.callerCache.get(functionIndex);
    if (cached) return cached;
    const needle = callNeedle(functionIndex);
    const found = new Set<number>();
    this.bodies.forEach((body, local) => {
      if (indexOfBytes(body, needle, 0) >= 0) found.add(local);
    });
    this.callerCache.set(functionIndex, found);
    return found;
  }

  callSites(caller: number, functionIndex: number): number[] {
    const body = this.bodies[caller] ?? fail(`function ${caller} is out of range`);
    const needle = callNeedle(functionIndex);
    const offsets: number[] = [];
    for (let at = indexOfBytes(body, needle, 0); at >= 0;) {
      offsets.push(at);
      at = indexOfBytes(body, needle, at + 1);
    }
    return offsets;
  }

  /** NUL-terminated ASCII at a linear-memory address, or null. */
  readString(address: number): string | null {
    for (const segment of this.dataSegments) {
      const offset = address - segment.base;
      if (offset < 0 || offset >= segment.bytes.byteLength) continue;
      let end = offset;
      while (end < segment.bytes.byteLength && segment.bytes[end] !== 0) end += 1;
      if (end === segment.bytes.byteLength) return null;
      return new TextDecoder().decode(segment.bytes.slice(offset, end));
    }
    return null;
  }

  readData(address: number, length: number): Uint8Array | null {
    for (const segment of this.dataSegments) {
      const offset = address - segment.base;
      if (offset < 0 || offset + length > segment.bytes.byteLength) continue;
      return segment.bytes.slice(offset, offset + length);
    }
    return null;
  }

  dataOccurrenceCount(needle: Uint8Array): number {
    let count = 0;
    for (const segment of this.dataSegments) {
      for (let at = indexOfBytes(segment.bytes, needle, 0); at >= 0;) {
        count += 1;
        at = indexOfBytes(segment.bytes, needle, at + 1);
      }
    }
    return count;
  }

  stringOccurrenceCount(value: string): number {
    const needle = new TextEncoder().encode(`${value}\0`);
    let count = 0;
    for (const segment of this.dataSegments) {
      for (let at = indexOfBytes(segment.bytes, needle, 0); at >= 0;) {
        count += 1;
        at = indexOfBytes(segment.bytes, needle, at + 1);
      }
    }
    return count;
  }
}

function parseDataSegments(
  sections: readonly { id: number; body: Uint8Array }[],
): { base: number; bytes: Uint8Array }[] {
  const section = sections.find((entry) => entry.id === 11);
  if (!section) return [];
  const bytes = section.body;
  const cursor = { offset: 0 };
  const count = readUleb(bytes, cursor);
  const segments: { base: number; bytes: Uint8Array }[] = [];
  for (let index = 0; index < count; index += 1) {
    const flags = readUleb(bytes, cursor);
    if (flags !== 0) return segments;
    if (bytes[cursor.offset++] !== 0x41) return segments;
    const base = readSleb(bytes, cursor);
    if (bytes[cursor.offset++] !== 0x0b) return segments;
    const size = readUleb(bytes, cursor);
    segments.push({ base, bytes: bytes.slice(cursor.offset, cursor.offset + size) });
    cursor.offset += size;
  }
  return segments;
}

/**
 * A call encoded canonically rather than padded would be invisible to the
 * needle scan, so we would locate fewer callers. The exact-cardinality checks
 * on the scans and sinks catch that, and this heuristic count reports it
 * directly. Three bytes can collide with an immediate, so it warns rather than
 * gates.
 */
function canonicalCallCount(view: ModuleView, functionIndex: number): number {
  const canonical = uleb(functionIndex);
  const needle = new Uint8Array(canonical.byteLength + 1);
  needle[0] = 0x10;
  needle.set(canonical, 1);
  let total = 0;
  for (const body of view.bodies) {
    for (let at = indexOfBytes(body, needle, 0); at >= 0;) {
      total += 1;
      at = indexOfBytes(body, needle, at + 1);
    }
  }
  return total;
}

function callNeedle(functionIndex: number): Uint8Array {
  const padded = paddedIndex(functionIndex);
  const needle = new Uint8Array(padded.byteLength + 1);
  needle[0] = 0x10;
  needle.set(padded, 1);
  return needle;
}

function intersect(left: Set<number>, right: Set<number>): number[] {
  return [...left].filter((value) => right.has(value)).sort((a, b) => a - b);
}

function located(
  view: ModuleView,
  local: number,
  rejected: readonly number[],
): LocatedFunction {
  return {
    localFunction: local,
    functionIndex: view.functionIndex(local),
    signature: view.signatures[local]!,
    bodyBytes: Array.from(view.bodies[local]!),
    callers: [...view.callers(view.functionIndex(local))].sort((a, b) => a - b),
    rejected,
  };
}

function only(
  candidates: readonly number[],
  what: string,
  extra = "",
): number {
  if (candidates.length === 1) return candidates[0]!;
  fail(
    `expected exactly one ${what}, found ${candidates.length}`
      + ` [${candidates.join(", ")}]${extra ? `. ${extra}` : ""}`,
  );
}

interface Located {
  readonly view: ModuleView;
  readonly carrierImport: number;
  readonly targets: Record<TargetName, LocatedFunction>;
  readonly writeFunction: number;
  readonly probeOffset: number;
  readonly writeOffset: number;
  readonly scans: number[];
  readonly sinks: number[];
  readonly deleteAssertion: { message: string; file: string; line: number };
  readonly diagnostics: string[];
}

type TemplateCallerRole =
  | "delete"
  | "skill-scan"
  | "equipment-scan"
  | "writer"
  | "directory-sink"
  | "screenshot-sink";

type StaticRelocation = Readonly<{
  start: number;
  end: number;
  encoding: "i32-const" | "memory-offset";
  baseline: number;
  group?: string;
  immutableString?: string;
}>;

/** Exhaustive relocation operands in the six template callers. */
const TEMPLATE_STATIC_RELOCATIONS: Readonly<
  Record<TemplateCallerRole, readonly StaticRelocation[]>
> = Object.freeze({
  delete: [
    { start: 21, end: 26, encoding: "memory-offset", baseline: 2674316, group: "delete-state" },
    { start: 33, end: 38, encoding: "memory-offset", baseline: 2674312, group: "delete-state" },
    { start: 81, end: 86, encoding: "memory-offset", baseline: 2674304, group: "delete-state" },
    { start: 116, end: 121, encoding: "memory-offset", baseline: 2674300, group: "delete-state" },
    { start: 162, end: 167, encoding: "memory-offset", baseline: 2674300, group: "delete-state" },
  ],
  "skill-scan": [
    { start: 55, end: 60, encoding: "memory-offset", baseline: 1447524, group: "template-types" },
    { start: 82, end: 87, encoding: "i32-const", baseline: 1447542, group: "template-types" },
    { start: 109, end: 114, encoding: "i32-const", baseline: 1447546, group: "template-types" },
    { start: 402, end: 407, encoding: "i32-const", baseline: 1447548, group: "template-types" },
    { start: 645, end: 650, encoding: "i32-const", baseline: 1447652, group: "template-types" },
    { start: 959, end: 964, encoding: "memory-offset", baseline: 1250688, group: "template-hash" },
    { start: 974, end: 979, encoding: "memory-offset", baseline: 1250688, group: "template-hash" },
  ],
  "equipment-scan": [
    { start: 55, end: 60, encoding: "memory-offset", baseline: 1447524, group: "template-types" },
    { start: 82, end: 87, encoding: "i32-const", baseline: 1447542, group: "template-types" },
    { start: 109, end: 114, encoding: "i32-const", baseline: 1447532, group: "template-types" },
    { start: 423, end: 428, encoding: "i32-const", baseline: 1447548, group: "template-types" },
    { start: 697, end: 702, encoding: "i32-const", baseline: 1447700, group: "template-types" },
    { start: 719, end: 724, encoding: "i32-const", baseline: 1238018, immutableString: "No valid case for switch variable 'type'" },
    { start: 801, end: 806, encoding: "i32-const", baseline: 1447668, group: "template-types" },
    { start: 1121, end: 1126, encoding: "memory-offset", baseline: 1250688, group: "template-hash" },
    { start: 1131, end: 1136, encoding: "memory-offset", baseline: 1250688, group: "template-hash" },
    { start: 1146, end: 1151, encoding: "memory-offset", baseline: 1250688, group: "template-hash" },
    { start: 1176, end: 1181, encoding: "memory-offset", baseline: 1250688, group: "template-hash" },
  ],
  writer: [
    { start: 130, end: 135, encoding: "i32-const", baseline: 1447532, group: "template-types" },
  ],
  "directory-sink": [
    { start: 55, end: 60, encoding: "memory-offset", baseline: 1520752, group: "directory-types" },
    { start: 70, end: 75, encoding: "memory-offset", baseline: 1520744, group: "directory-types" },
    { start: 85, end: 90, encoding: "memory-offset", baseline: 1520736, group: "directory-types" },
    { start: 162, end: 167, encoding: "i32-const", baseline: 1520756, group: "directory-types" },
    { start: 643, end: 648, encoding: "i32-const", baseline: 1520776, group: "directory-types" },
  ],
  "screenshot-sink": [
    { start: 27, end: 32, encoding: "memory-offset", baseline: 5943272, group: "screenshot-state" },
    { start: 41, end: 46, encoding: "memory-offset", baseline: 5943296, group: "screenshot-state" },
    { start: 65, end: 70, encoding: "memory-offset", baseline: 5943296, group: "screenshot-state" },
    { start: 99, end: 104, encoding: "i32-const", baseline: 1556320, group: "screenshot-types" },
    { start: 146, end: 151, encoding: "i32-const", baseline: 1244317, immutableString: "PathCreateDirectory() failed: %u\n" },
    { start: 183, end: 188, encoding: "memory-offset", baseline: 2635884, group: "screenshot-directory" },
    { start: 282, end: 287, encoding: "i32-const", baseline: 1556336, group: "screenshot-types" },
    { start: 309, end: 314, encoding: "i32-const", baseline: 1556356, group: "screenshot-types" },
    { start: 367, end: 372, encoding: "i32-const", baseline: 1556388, group: "screenshot-types" },
    { start: 691, end: 696, encoding: "i32-const", baseline: 1241365, immutableString: "No valid case for switch variable '\"\"'" },
    { start: 730, end: 735, encoding: "i32-const", baseline: 1556408, group: "screenshot-types" },
    { start: 1013, end: 1018, encoding: "i32-const", baseline: 1556430, group: "screenshot-types" },
    { start: 1248, end: 1253, encoding: "memory-offset", baseline: 5943276, group: "screenshot-state" },
    { start: 1262, end: 1267, encoding: "memory-offset", baseline: 5943276, group: "screenshot-state" },
    { start: 1294, end: 1299, encoding: "memory-offset", baseline: 5943268, group: "screenshot-state" },
    { start: 1305, end: 1310, encoding: "memory-offset", baseline: 5943296, group: "screenshot-state" },
    { start: 1329, end: 1334, encoding: "i32-const", baseline: 1241365, immutableString: "No valid case for switch variable '\"\"'" },
    { start: 1373, end: 1378, encoding: "memory-offset", baseline: 5943292, group: "screenshot-state" },
    { start: 1390, end: 1395, encoding: "memory-offset", baseline: 5943280, group: "screenshot-state" },
    { start: 1407, end: 1412, encoding: "memory-offset", baseline: 5943284, group: "screenshot-state" },
    { start: 1428, end: 1433, encoding: "memory-offset", baseline: 5943288, group: "screenshot-state" },
    { start: 1449, end: 1454, encoding: "memory-offset", baseline: 5943288, group: "screenshot-state" },
    { start: 1473, end: 1478, encoding: "memory-offset", baseline: 5943272, group: "screenshot-state" },
  ],
});

/**
 * The `not-applicable` signal: no function returns `i32.const 2` from a
 * `(i32,i32)->i32`, so this build has no create-directory stub to bridge.
 */
class NotApplicableError extends Error {}

function locate(view: ModuleView): Located {
  const diagnostics: string[] = [];
  const bySignature = (signature: string) =>
    view.signatures.flatMap((value, local) => (value === signature ? [local] : []));

  // L1 create directory — unique on body alone in the certified build.
  const createCandidates = bySignature("(i32,i32)->(i32)").filter((local) =>
    sameBytes(view.bodies[local]!, CREATE_DIRECTORY_BODY),
  );
  if (createCandidates.length === 0) {
    throw new NotApplicableError(
      "no (i32,i32)->i32 function returns i32.const 2; this build has no"
        + " create-directory stub, so the bridge may no longer be needed",
    );
  }
  // A vtable slot or an unrelated `return 2` can share the body, so narrow to
  // the one that several places actually call before creating a file.
  const createLive = createCandidates.filter(
    (local) => view.callers(view.functionIndex(local)).size >= 3,
  );
  const createLocal = only(
    createLive.length > 0 ? createLive : createCandidates,
    "create-directory stub",
    `${createCandidates.length} shared the body shape`,
  );
  const createCallers = view.callers(view.functionIndex(createLocal));

  // L2 assert handler — the (i32,i32,i32)->() that reaches the asm_const abort.
  const assertHook = functionImportIndex(view.importSection, ASSERT_HOOK_IMPORT_NAME);
  if (assertHook === null) fail(`no ${ASSERT_HOOK_IMPORT_NAME} import`);
  const assertHookNeedle = callNeedle(assertHook);
  const assertCandidates = bySignature("(i32,i32,i32)->()").filter(
    (local) => indexOfBytes(view.bodies[local]!, assertHookNeedle, 0) >= 0,
  );
  const ranked = assertCandidates
    .map((local) => ({ local, callers: view.callers(view.functionIndex(local)).size }))
    .sort((a, b) => b.callers - a.callers);
  const top = ranked[0] ?? fail("no assert handler candidate");
  const runnerUp = ranked[1]?.callers ?? 0;
  if (top.callers < 100 * Math.max(runnerUp, 1)) {
    fail(
      `assert handler is ambiguous: ${top.local} has ${top.callers} callers,`
        + ` runner-up has ${runnerUp}`,
    );
  }
  const assertLocal = top.local;
  diagnostics.push(
    `assert handler ${assertLocal} chosen with ${top.callers} callers (runner-up ${runnerUp})`,
  );

  // L3 find files — empty body, sharing callers with create-directory.
  const findAll = bySignature("(i32,i32,i32)->()").filter((local) =>
    sameBytes(view.bodies[local]!, FIND_FILES_BODY),
  );
  const findCandidates = findAll.filter(
    (local) => intersect(view.callers(view.functionIndex(local)), createCallers).length >= 2,
  );
  const findLocal = only(
    findCandidates,
    "find-files stub",
    `${findAll.length} shared the body shape`,
  );
  const findCallers = view.callers(view.functionIndex(findLocal));

  // L4 entry name — constant-zero body, sharing callers with find-files.
  const nameAll = bySignature("(i32,i32,i32,i32,i32,i32)->(i32)").filter((local) =>
    sameBytes(view.bodies[local]!, FILE_BASE_NAME_BODY),
  );
  const nameCandidates = nameAll.filter(
    (local) => intersect(view.callers(view.functionIndex(local)), findCallers).length >= 2,
  );
  const nameLocal = only(
    nameCandidates,
    "entry-name stub",
    `${nameAll.length} shared the body shape`,
  );
  const nameCallers = view.callers(view.functionIndex(nameLocal));

  // L5/L6 — the two template scans, and the chat-log/screenshot pair.
  const scans = intersect(findCallers, nameCallers);
  if (scans.length !== 2) {
    fail(
      `expected exactly 2 template scans (callers of both find-files and`
        + ` entry-name), found ${scans.length} [${scans.join(", ")}]`,
    );
  }
  const sinks = intersect(createCallers, findCallers).filter(
    (local) => !scans.includes(local),
  );
  if (sinks.length !== 2) {
    fail(
      `expected exactly 2 directory sinks (chat log and screenshot), found`
        + ` ${sinks.length} [${sinks.join(", ")}]. A third caller that creates a`
        + ` directory then enumerates it needs a human decision about whether to`
        + ` repoint it`,
    );
  }

  // L7 delete file — assert-and-abort body, one caller, and it says so.
  const assertTail = callNeedle(view.functionIndex(assertLocal));
  const deleteCandidates = bySignature("(i32)->(i32)").filter((local) => {
    const body = view.bodies[local]!;
    const at = indexOfBytes(body, assertTail, 0);
    return (
      at >= 0
      && at + assertTail.byteLength + 2 === body.byteLength
      && body[at + assertTail.byteLength] === 0x00
      && body[body.byteLength - 1] === 0x0b
      && view.callers(view.functionIndex(local)).size === 1
    );
  });
  const deleteLocal = only(deleteCandidates, "delete-file stub");
  const deleteAssertion = readAssertion(view, deleteLocal);
  if (deleteAssertion.message !== "not implemented") {
    fail(`delete-file stub asserts ${JSON.stringify(deleteAssertion.message)}`);
  }
  if (!deleteAssertion.file.endsWith("EmscriptenExeFile.cpp")) {
    fail(`delete-file stub is attributed to ${deleteAssertion.file}`);
  }

  // L8 write function, File::Open, and which of its two calls is the probe.
  const openMatches: {
    caller: number;
    target: number;
    probe: number;
    write: number;
  }[] = [];
  for (const caller of createCallers) {
    const body = view.bodies[caller]!;
    for (let local = 0; local < view.signatures.length; local += 1) {
      if (view.signatures[local] !== "(i32,i32,i32)->(i32)") continue;
      const offsets = view.callSites(caller, view.functionIndex(local));
      if (offsets.length !== 2) continue;
      const modes = offsets.map((offset) => precedingModes(body, offset));
      if (modes[0]?.mode === 1 && modes[0].err === 0
        && modes[1]?.mode === 2 && modes[1].err === 0) {
        openMatches.push({
          caller,
          target: local,
          probe: offsets[0]!,
          write: offsets[1]!,
        });
      }
    }
  }
  if (openMatches.length !== 1) {
    fail(
      `expected exactly one File::Open probe/write pair, found`
        + ` ${openMatches.length}`
        + ` [${openMatches.map((m) => `${m.target} in ${m.caller}`).join(", ")}]`,
    );
  }
  const open = openMatches[0]!;
  if (scans.includes(open.caller) || sinks.includes(open.caller)) {
    fail(`write function ${open.caller} is also a scan or directory sink`);
  }

  return {
    view,
    carrierImport:
      functionImportIndex(view.importSection, CARRIER_IMPORT_NAME)
      ?? fail(`no ${CARRIER_IMPORT_NAME} import to carry the bridge`),
    targets: {
      ensureDirectory: located(view, createLocal, createCandidates.filter((l) => l !== createLocal)),
      findFiles: located(view, findLocal, findAll.filter((l) => l !== findLocal)),
      fileBaseName: located(view, nameLocal, nameAll.filter((l) => l !== nameLocal)),
      deleteFile: located(view, deleteLocal, deleteCandidates.filter((l) => l !== deleteLocal)),
      // The one target that is not a stub: a working `File::Open` whose mode-1
      // probe is repointed. There is nothing to reject, only the pair to pick.
      fileExists: located(view, open.target, []),
      assertHandler: located(view, assertLocal, ranked.slice(1).map((entry) => entry.local)),
    },
    writeFunction: open.caller,
    probeOffset: open.probe,
    writeOffset: open.write,
    scans,
    sinks,
    deleteAssertion,
    diagnostics,
  };
}

/** `i32.const <mode>; i32.const <err>` immediately before a call. */
function precedingModes(
  body: Uint8Array,
  callOffset: number,
): { mode: number; err: number } | null {
  const err = constantEndingAt(body, callOffset);
  if (err === null) return null;
  const mode = constantEndingAt(body, err.start);
  return mode === null ? null : { mode: mode.value, err: err.value };
}

function constantEndingAt(
  body: Uint8Array,
  end: number,
): { value: number; start: number } | null {
  // i32.const immediates are 1..5 bytes; LLVM pads the relocatable ones.
  for (let width = 1; width <= 5; width += 1) {
    const start = end - width - 1;
    if (start < 0 || body[start] !== 0x41) continue;
    const cursor = { offset: start + 1 };
    let value: number;
    try {
      value = readSleb(body, cursor);
    } catch {
      continue;
    }
    if (cursor.offset === end) return { value, start };
  }
  return null;
}

function readAssertion(
  view: ModuleView,
  local: number,
): { message: string; file: string; line: number } {
  const body = view.bodies[local]!;
  const constants: number[] = [];
  const cursor = { offset: 1 };
  while (cursor.offset < body.byteLength && constants.length < 3) {
    if (body[cursor.offset] !== 0x41) break;
    cursor.offset += 1;
    constants.push(readSleb(body, cursor));
  }
  if (constants.length !== 3) fail(`delete-file stub is not an assert body`);
  return {
    message: view.readString(constants[0]!) ?? "",
    file: view.readString(constants[1]!) ?? "",
    line: constants[2]!,
  };
}

function bridgeFor(
  kind: BridgeKind,
  stubFunction: number,
  callSites: readonly CallSite[],
  stubBody?: readonly number[],
): StubBridge {
  return stubBody
    ? { kind, stubFunction, stubBody, callSites }
    : { kind, stubFunction, callSites };
}

function sortSites(sites: readonly CallSite[]): CallSite[] {
  return [...sites].sort(
    (a, b) => a.localFunction - b.localFunction || a.bodyOffset - b.bodyOffset,
  );
}

function sites(
  view: ModuleView,
  target: number,
  callers: readonly number[],
): CallSite[] {
  return sortSites(
    callers.flatMap((localFunction) =>
      view
        .callSites(localFunction, view.functionIndex(target))
        .map((bodyOffset) => ({ localFunction, bodyOffset })),
    ),
  );
}

/** Build entry for an already-located module, with `outputSha256` still empty. */
function draft(found: Located): KnownTemplateSaveBuild {
  const { view, targets, scans, sinks, writeFunction } = found;

  return {
    sha256: sha256(view.input),
    outputSha256: "",
    importCount: view.importCount,
    carrierImport: found.carrierImport,
    bridges: [
      bridgeFor(
        "ensureDirectory",
        targets.ensureDirectory.localFunction,
        sites(view, targets.ensureDirectory.localFunction, [writeFunction, ...sinks]),
        CREATE_DIRECTORY_BODY,
      ),
      bridgeFor(
        "findFiles",
        targets.findFiles.localFunction,
        sites(view, targets.findFiles.localFunction, [...scans, ...sinks]),
        FIND_FILES_BODY,
      ),
      bridgeFor(
        "fileBaseName",
        targets.fileBaseName.localFunction,
        sites(view, targets.fileBaseName.localFunction, scans),
        FILE_BASE_NAME_BODY,
      ),
      bridgeFor(
        "deleteFile",
        targets.deleteFile.localFunction,
        sites(view, targets.deleteFile.localFunction, [
          ...view.callers(view.functionIndex(targets.deleteFile.localFunction)),
        ]),
        Array.from(view.bodies[targets.deleteFile.localFunction]!),
      ),
      // Only the probe, never the write call that follows it.
      bridgeFor("fileExists", targets.fileExists.localFunction, [
        { localFunction: writeFunction, bodyOffset: found.probeOffset },
      ]),
    ],
  };
}

/**
 * Fill in `outputSha256` by running the production transform and reading the
 * hash back out of its own mismatch error, so the entry has round-tripped
 * through the shipping code path rather than a parallel one.
 */
function certify(
  input: Uint8Array,
  entry: KnownTemplateSaveBuild,
): KnownTemplateSaveBuild {
  try {
    rewriteTemplateSaveWasm(input, { ...entry, outputSha256: "0".repeat(64) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const found = /unexpected output ([0-9a-f]{64})/.exec(message);
    if (found) {
      const certified = { ...entry, outputSha256: found[1]! };
      rewriteTemplateSaveWasm(input, certified);
      return certified;
    }
    throw error;
  }
  fail("the transform accepted a placeholder output hash");
}

/** Derive a build entry, with `outputSha256` still to be certified. */
export function draftTemplateSaveBuild(
  input: Uint8Array,
): KnownTemplateSaveBuild {
  return draft(locate(new ModuleView(input)));
}

export function deriveTemplateSaveBuild(
  input: Uint8Array,
): KnownTemplateSaveBuild {
  return certify(input, draftTemplateSaveBuild(input));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function templateCallerRoles(found: Located): Map<number, TemplateCallerRole> {
  const deleted = [...found.view.callers(
    found.view.functionIndex(found.targets.deleteFile.localFunction),
  )];
  if (deleted.length !== 1) fail("delete caller role is ambiguous");
  const roles = new Map<number, TemplateCallerRole>([
    [deleted[0]!, "delete"],
    [found.scans[0]!, "skill-scan"],
    [found.scans[1]!, "equipment-scan"],
    [found.writeFunction, "writer"],
    [found.sinks[0]!, "directory-sink"],
    [found.sinks[1]!, "screenshot-sink"],
  ]);
  if (roles.size !== 6) fail("template caller roles overlap");
  return roles;
}

function relocationValue(
  body: Uint8Array,
  relocation: StaticRelocation,
): number {
  if (relocation.encoding === "i32-const") {
    if (body[relocation.start - 1] !== 0x41) {
      fail(`static relocation at ${relocation.start} is not i32.const`);
    }
    const cursor = { offset: relocation.start };
    const value = readSleb(body, cursor);
    if (cursor.offset !== relocation.end) {
      fail(`static relocation at ${relocation.start} changed width`);
    }
    return value;
  }
  for (
    let opcodeAt = Math.max(0, relocation.start - 6);
    opcodeAt < relocation.start;
    opcodeAt += 1
  ) {
    if (body[opcodeAt]! < 0x28 || body[opcodeAt]! > 0x3e) continue;
    const cursor = { offset: opcodeAt + 1 };
    try {
      readUleb(body, cursor);
      if (cursor.offset !== relocation.start) continue;
      const value = readUleb(body, cursor);
      if (cursor.offset === relocation.end) return value;
    } catch {
      // Another byte happened to look like a memory opcode; keep searching.
    }
  }
  fail(`static relocation at ${relocation.start} is not a memory offset`);
}

function normalizeStaticRelocations(
  found: Located,
  role: TemplateCallerRole,
  source: Uint8Array,
  normalized: Uint8Array,
  deltas: Map<string, number>,
): void {
  const relocations = TEMPLATE_STATIC_RELOCATIONS[role];
  if (relocations.some((relocation) => relocation.end > source.byteLength)) {
    // Small synthetic locator fixtures do not model the production static
    // ledger. Their fingerprint remains useful test evidence but can never
    // equal the shipped production baseline.
    return;
  }
  relocations.forEach((relocation, index) => {
    const value = relocationValue(source, relocation);
    if (relocation.immutableString !== undefined) {
      if (
        found.view.readString(value) !== relocation.immutableString
        || found.view.stringOccurrenceCount(relocation.immutableString) !== 1
      ) {
        fail(`immutable ${role} reference ${index} changed or is ambiguous`);
      }
    } else {
      const group = relocation.group
        ?? fail(`mutable ${role} reference ${index} has no occurrence ledger`);
      const delta = value - relocation.baseline;
      const previous = deltas.get(group);
      if (previous !== undefined && previous !== delta) {
        fail(`mutable static group ${group} moved inconsistently`);
      }
      deltas.set(group, delta);
    }
    normalized.fill(0, relocation.start, relocation.end);
    normalized[relocation.start] = index + 1;
  });
}

const FILE_OPEN_VTABLE_PREFIX = Uint8Array.of(
  0x5a, 0, 0, 0, 0x5b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x5c, 0, 0, 0, 0x5d, 0, 0, 0, 0x5e, 0, 0, 0, 0x5f, 0, 0, 0,
);

function normalizedFileExistsBody(found: Located): string {
  const source = found.view.bodies[found.targets.fileExists.localFunction]
    ?? fail("file-exists body is missing");
  const relocation: StaticRelocation = {
    start: 295,
    end: 300,
    encoding: "i32-const",
    baseline: 1255092,
  };
  if (source.byteLength < relocation.end) return sha256(source);
  const pointer = relocationValue(source, relocation);
  const content = found.view.readData(pointer, FILE_OPEN_VTABLE_PREFIX.byteLength);
  if (
    !content
    || !sameBytes(content, FILE_OPEN_VTABLE_PREFIX)
    || found.view.dataOccurrenceCount(FILE_OPEN_VTABLE_PREFIX) !== 1
  ) {
    fail("File::Open immutable vtable reference changed or is ambiguous");
  }
  const normalized = source.slice();
  normalized.fill(0, relocation.start, relocation.end);
  normalized[relocation.start] = 1;
  return sha256(normalized);
}

/**
 * Identity of the complete bodies whose calls the transform will repoint.
 *
 * Function indices are allowed to move, so the five-byte operands of the
 * selected calls are replaced by stable bridge-kind tags before hashing. Every
 * other instruction and immediate remains exact. This is deliberately stricter
 * than the shape locator: a changed path calculation, flag, branch or unrelated
 * call is a semantic change and must refuse local certification.
 */
function semanticFingerprint(
  found: Located,
  entry: KnownTemplateSaveBuild,
): string {
  const tags = new Map<BridgeKind, number>(
    entry.bridges.map((bridge, index) => [bridge.kind, index + 1]),
  );
  const touched = new Map<number, string[]>();
  for (const bridge of entry.bridges) {
    for (const site of bridge.callSites) {
      const roles = touched.get(site.localFunction) ?? [];
      roles.push(`${bridge.kind}:${site.bodyOffset}`);
      touched.set(site.localFunction, roles);
    }
  }

  const callerRoles = templateCallerRoles(found);
  const deltas = new Map<string, number>();

  const callers = [...touched].map(([local, roles]) => {
    const source = found.view.bodies[local]
      ?? fail(`semantic caller ${local} is out of range`);
    const normalized = source.slice();
    const role = callerRoles.get(local)
      ?? fail(`semantic caller ${local} has no feature role`);
    normalizeStaticRelocations(found, role, source, normalized, deltas);
    for (const bridge of entry.bridges) {
      const expected = callNeedle(
        found.view.functionIndex(bridge.stubFunction),
      );
      for (const site of bridge.callSites) {
        if (site.localFunction !== local) continue;
        const end = site.bodyOffset + expected.byteLength;
        if (
          end > source.byteLength
          || !expected.every(
            (byte, index) => source[site.bodyOffset + index] === byte,
          )
        ) {
          fail(`semantic ${bridge.kind} call site signature mismatch`);
        }
        normalized.fill(0, site.bodyOffset + 1, end);
        normalized[site.bodyOffset + 1] = tags.get(bridge.kind)!;
      }
    }
    return {
      role,
      roles: [...roles].sort(),
      bodySha256: sha256(normalized),
    };
  }).sort((left, right) => left.role.localeCompare(right.role));

  return sha256(new TextEncoder().encode(JSON.stringify({
    callers,
    fileExistsBodySha256: normalizedFileExistsBody(found),
  })));
}

export function analyzeTemplateSaveCandidate(
  input: Uint8Array,
): TemplateSaveAnalysis {
  const hash = sha256(input);
  const empty: TemplateSaveAnalysis = {
    sha256: hash,
    validWasm: false,
    status: "failed",
    importCount: null,
    carrierImport: null,
    targets: {},
    callSites: {},
    deleteAssertion: null,
    encodings: { padded: 0, canonical: 0 },
    entry: null,
    semanticFingerprint: null,
    diagnostics: [],
  };

  let view: ModuleView;
  try {
    view = new ModuleView(input);
  } catch (error) {
    return { ...empty, diagnostics: [String(error)] };
  }

  try {
    const found = locate(view);
    const entry = certify(input, draft(found));
    const callSites: Partial<Record<BridgeKind, readonly CallSite[]>> = {};
    let padded = 0;
    for (const bridge of entry.bridges) {
      callSites[bridge.kind] = bridge.callSites;
      padded += bridge.callSites.length;
    }
    const canonical = entry.bridges.reduce(
      (sum, bridge) =>
        sum + canonicalCallCount(view, view.functionIndex(bridge.stubFunction)),
      0,
    );
    return {
      sha256: hash,
      validWasm: true,
      status: "derived",
      importCount: view.importCount,
      carrierImport: found.carrierImport,
      targets: found.targets,
      callSites,
      deleteAssertion: found.deleteAssertion,
      encodings: { padded, canonical },
      entry,
      semanticFingerprint: semanticFingerprint(found, entry),
      diagnostics: [
        ...found.diagnostics,
        `template scans ${found.scans.join(", ")}`,
        `directory sinks ${found.sinks.join(", ")}`,
        `File::Open probe at +${found.probeOffset}, write at +${found.writeOffset}`,
        ...(canonical > 0
          ? [
            `warning: ${canonical} possible canonically encoded call(s) to a`
            + ` bridged target. A repoint only fits in place over the padded`
            + ` five-byte form — see internal/upstream/recertify.md`,
          ]
          : []),
      ],
    };
  } catch (error) {
    if (error instanceof NotApplicableError) {
      return {
        ...empty,
        validWasm: true,
        status: "not-applicable",
        importCount: view.importCount,
        diagnostics: [error.message],
      };
    }
    return {
      ...empty,
      validWasm: true,
      importCount: view.importCount,
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * The current measured build is the source of truth for local semantic
 * inheritance. This value is generated from its normalized touched callers,
 * not from the whole client, so an unrelated ArenaNet rebuild can still pass.
 */
export const TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT =
  "82664898e240ff2119cb43d454ba567ce20195887ca28d1c6f4b1805304a0b38";

/**
 * Return a transform record only when the locator and the complete relevant
 * caller bodies prove the same behavior as the current shipped baseline.
 */
export function deriveEquivalentTemplateSaveBuild(
  input: Uint8Array,
): KnownTemplateSaveBuild | null {
  const analysis = analyzeTemplateSaveCandidate(input);
  const entry = analysis.entry;
  const baseline = TEMPLATE_SAVE_BUILDS[TEMPLATE_SAVE_BUILDS.length - 1];
  if (
    !baseline
    || !entry
    || analysis.status !== "derived"
    || !analysis.validWasm
    || analysis.encodings.canonical !== 0
    || analysis.semanticFingerprint
      !== TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT
    || !sameJson(analysis.deleteAssertion, EXPECTED_DELETE_ASSERTION)
    || entry.bridges.length !== baseline.bridges.length
  ) {
    return null;
  }

  for (const expected of baseline.bridges) {
    const candidate = entry.bridges.find(
      (bridge) => bridge.kind === expected.kind,
    );
    const target = analysis.targets[expected.kind];
    if (
      !candidate
      || !target
      || target.signature !== EXPECTED_TEMPLATE_SIGNATURES[expected.kind]
      || candidate.callSites.length !== expected.callSites.length
      || (
        expected.stubBody
        && !sameJson(candidate.stubBody, expected.stubBody)
      )
    ) {
      return null;
    }
  }
  return entry;
}

export type TemplateSaveResolution = "certified" | "structurally-derived";

export interface PostTemplateSaveModule {
  readonly resolution: TemplateSaveResolution;
  readonly build: KnownTemplateSaveBuild;
  readonly bytes: Uint8Array;
}

interface TemplateSaveResolvers {
  readonly certified: (sha256: string) => KnownTemplateSaveBuild | null;
  readonly structurallyDerived: (
    input: Uint8Array,
  ) => KnownTemplateSaveBuild | null;
}

const TEMPLATE_SAVE_RESOLVERS: TemplateSaveResolvers = Object.freeze({
  certified: findTemplateSaveBuild,
  structurallyDerived: deriveEquivalentTemplateSaveBuild,
});

/**
 * Produce the exact module on which every later transform is layered.
 *
 * A checked-in build and a locally shape-verified build differ only in how
 * their transform record is selected. Both must pass through the same
 * template-save rewrite; returning `null` is the fail-closed answer when
 * neither proof can select a record. The injectable resolvers make those two
 * otherwise mutually exclusive branches executable with small CI fixtures.
 */
export function preparePostTemplateSaveModule(
  input: Uint8Array,
  resolvers: TemplateSaveResolvers = TEMPLATE_SAVE_RESOLVERS,
): PostTemplateSaveModule | null {
  const certified = resolvers.certified(sha256(input));
  const build = certified ?? resolvers.structurallyDerived(input);
  if (!build) return null;
  return {
    resolution: certified ? "certified" : "structurally-derived",
    build,
    bytes: rewriteTemplateSaveWasm(input, build),
  };
}
