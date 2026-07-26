// Re-derive a `KnownTemplateSaveBuild` entry from a client WASM, by shape
// rather than by remembered index.
//
// Developer tooling: `pnpm template:recertify` is its only caller and no
// runtime path reaches it, so it lives here rather than in src/main/core/.
// Forge packages build/main, build/shared, build/renderer and build/preload —
// build/tools is outside the .app by construction (P4.3, P4.4).
//
// Every number in the certified table belongs to one exact build, and ArenaNet
// updates the client automatically. Recovering them by hand takes hours; this
// recovers them in seconds and hands the result to the production transform for
// validation. It removes the index-recovery work, not the semantic work — see
// internal/upstream/recertify.md, which still owns re-measuring what the path
// helpers actually do.
//
// Two measured facts make this cheap. Byte-scanning for the six-byte padded
// `call` needle locates every call site with no false positives, so no
// whole-module instruction decoder is needed. And caller-set intersection
// identifies every target, so source-file attribution is not needed either —
// which is just as well, because the most important call site here references
// no source string at all.
import { createHash } from "node:crypto";
import {
  countFunctionImports,
  functionImportIndex,
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
} from "../main/core/wasm-binary.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type CallSite,
  type KnownTemplateSaveBuild,
  type StubBridge,
} from "../main/core/template-save-compat.js";

const CARRIER_IMPORT_NAME = "__syscall_newfstatat";
const ASSERT_HOOK_IMPORT_NAME = "emscripten_asm_const_int";

/** Shipped bodies of the four unimplemented routines. */
const CREATE_DIRECTORY_BODY = [0x00, 0x41, 0x02, 0x0b];
const FIND_FILES_BODY = [0x00, 0x0b];
const FILE_BASE_NAME_BODY = [0x00, 0x41, 0x00, 0x0b];

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

export interface TemplateSaveCandidateReport {
  readonly sha256: string;
  readonly validWasm: boolean;
  readonly status: "certified" | "derived" | "not-applicable" | "failed";
  readonly certified: boolean;
  readonly matchesCertifiedEntry: boolean | null;
  readonly importCount: number | null;
  readonly carrierImport: number | null;
  readonly targets: Partial<Record<TargetName, LocatedFunction>>;
  readonly callSites: Partial<Record<BridgeKind, readonly CallSite[]>>;
  readonly deleteAssertion: { message: string; file: string; line: number } | null;
  readonly encodings: { padded: number; canonical: number };
  readonly entry: KnownTemplateSaveBuild | null;
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

function sameBytes(body: Uint8Array, expected: readonly number[]): boolean {
  return (
    body.byteLength === expected.length
    && expected.every((byte, index) => body[index] === byte)
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

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  outer: for (let at = from; at + needle.byteLength <= haystack.byteLength; at += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[at + index] !== needle[index]) continue outer;
    }
    return at;
  }
  return -1;
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

/** Field-by-field difference against the checked-in entry; [] means identical. */
export function compareToCertified(
  entry: KnownTemplateSaveBuild,
): string[] {
  const certified = TEMPLATE_SAVE_BUILDS.find(
    (build) => build.sha256 === entry.sha256,
  );
  if (!certified) return [`no certified entry for ${entry.sha256}`];
  const differences: string[] = [];
  const compare = (what: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      differences.push(`${what}: derived ${JSON.stringify(a)} vs certified ${JSON.stringify(b)}`);
    }
  };
  compare("outputSha256", entry.outputSha256, certified.outputSha256);
  compare("importCount", entry.importCount, certified.importCount);
  compare("carrierImport", entry.carrierImport, certified.carrierImport);
  compare(
    "bridge kinds",
    entry.bridges.map((bridge) => bridge.kind),
    certified.bridges.map((bridge) => bridge.kind),
  );
  for (const bridge of entry.bridges) {
    const other = certified.bridges.find((value) => value.kind === bridge.kind);
    if (!other) continue;
    compare(`${bridge.kind}.stubFunction`, bridge.stubFunction, other.stubFunction);
    compare(`${bridge.kind}.stubBody`, bridge.stubBody ?? null, other.stubBody ?? null);
    compare(
      `${bridge.kind}.callSites`,
      sortSites(bridge.callSites),
      sortSites(other.callSites),
    );
  }
  return differences;
}

export function inspectTemplateSaveCandidate(
  input: Uint8Array,
): TemplateSaveCandidateReport {
  const hash = sha256(input);
  const certified = findTemplateSaveBuild(hash) !== null;
  const empty: TemplateSaveCandidateReport = {
    sha256: hash,
    validWasm: false,
    status: "failed",
    certified,
    matchesCertifiedEntry: null,
    importCount: null,
    carrierImport: null,
    targets: {},
    callSites: {},
    deleteAssertion: null,
    encodings: { padded: 0, canonical: 0 },
    entry: null,
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
    const differences = certified ? compareToCertified(entry) : [];
    return {
      sha256: hash,
      validWasm: true,
      status: "derived",
      certified,
      matchesCertifiedEntry: certified ? differences.length === 0 : null,
      importCount: view.importCount,
      carrierImport: found.carrierImport,
      targets: found.targets,
      callSites,
      deleteAssertion: found.deleteAssertion,
      encodings: { padded, canonical },
      entry,
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
        ...differences.map((value) => `differs from certified entry — ${value}`),
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

/** Paste-ready TypeScript for the entry, emitted to stderr by the CLI. */
export function formatBuildEntry(entry: KnownTemplateSaveBuild): string {
  const site = (value: CallSite) =>
    `            Object.freeze({ localFunction: ${value.localFunction},`
      + ` bodyOffset: ${value.bodyOffset} }),`;
  const body = (values: readonly number[]) =>
    values.map((value) => `0x${value.toString(16).padStart(2, "0")}`).join(", ");
  const bridges = entry.bridges.map((bridge) => {
    const stub = bridge.stubBody
      ? `          stubBody: Object.freeze([${body(bridge.stubBody)}]),\n`
      : "";
    return (
      `        Object.freeze({\n`
      + `          kind: "${bridge.kind}" as const,\n`
      + `          stubFunction: ${bridge.stubFunction},\n`
      + stub
      + `          callSites: Object.freeze([\n`
      + `${sortSites(bridge.callSites).map(site).join("\n")}\n`
      + `          ]),\n`
      + `        }),`
    );
  });
  return (
    `    Object.freeze({\n`
    + `      sha256:\n        "${entry.sha256}",\n`
    + `      outputSha256:\n        "${entry.outputSha256}",\n`
    + `      importCount: ${entry.importCount},\n`
    + `      carrierImport: ${entry.carrierImport},\n`
    + `      bridges: Object.freeze([\n${bridges.join("\n")}\n      ]),\n`
    + `    }),`
  );
}
