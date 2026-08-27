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
 * One bounded shared decoder locates direct calls and preserves each encoded
 * call width, so only six-byte padded sites can be repointed. Caller-set
 * intersection identifies every target, so source-file attribution is not needed either —
 * which is just as well, because the most important call site here references
 * no source string at all.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  functionImportIndex,
  indexOfBytes,
  readSleb,
} from "../core/wasm-binary.js";
import {
  certifyTemplateSaveRewrite,
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_BUILDS,
  type BridgeKind,
  type CallSite,
  type KnownTemplateSaveBuild,
  type StubBridge,
} from "./template-save-compat.js";
import {
  canonicalTemplateCallCount as canonicalCallCount,
  intersectFunctionSets as intersect,
  onlyFunction as only,
  templateCallNeedle as callNeedle,
  TemplateSaveModuleView as ModuleView,
} from "./template-save-module-view.js";
import { templateSemanticFingerprint } from "./template-save-semantic-proof.js";

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

function sameBytes(body: Uint8Array, expected: ArrayLike<number>): boolean {
  return (
    body.byteLength === expected.length
    && Array.from(expected).every((byte, index) => body[index] === byte)
  );
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

/** Bind a proved draft to the exact validated production-transform bytes. */
function certify(
  input: Uint8Array,
  entry: KnownTemplateSaveBuild,
): KnownTemplateSaveBuild {
  return certifyTemplateSaveRewrite(input, entry).build;
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

function analyzeTemplateSaveCandidateInternal(
  input: Uint8Array,
  certifyOutput: boolean,
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
    const entryDraft = draft(found);
    const entry = certifyOutput ? certify(input, entryDraft) : entryDraft;
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
      semanticFingerprint: templateSemanticFingerprint(found, entry),
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

export function analyzeTemplateSaveCandidate(
  input: Uint8Array,
): TemplateSaveAnalysis {
  return analyzeTemplateSaveCandidateInternal(input, true);
}

/**
 * The current measured build is the source of truth for local semantic
 * inheritance. This value is generated from its normalized touched callers,
 * not from the whole client, so an unrelated ArenaNet rebuild can still pass.
 */
export const TEMPLATE_SAVE_SEMANTIC_BASELINE_FINGERPRINT =
  "c465fb8bf0bc00d2d599ef59d42d03f63123801607d254330635ced0e7f458c4";

/**
 * Return a transform record only when the locator and the complete relevant
 * caller bodies prove the same behavior as the current shipped baseline.
 */
function equivalentTemplateSaveBuild(
  analysis: TemplateSaveAnalysis,
): KnownTemplateSaveBuild | null {
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
    || !isDeepStrictEqual(analysis.deleteAssertion, EXPECTED_DELETE_ASSERTION)
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
    ) {
      return null;
    }
  }
  return entry;
}

export function deriveEquivalentTemplateSaveBuild(
  input: Uint8Array,
): KnownTemplateSaveBuild | null {
  return equivalentTemplateSaveBuild(analyzeTemplateSaveCandidate(input));
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

function deriveEquivalentPostTemplateSaveModule(
  input: Uint8Array,
): PostTemplateSaveModule | null {
  const analysis = analyzeTemplateSaveCandidateInternal(input, false);
  const draftBuild = equivalentTemplateSaveBuild(analysis);
  if (!draftBuild) return null;
  const certified = certifyTemplateSaveRewrite(input, draftBuild);
  return {
    resolution: "structurally-derived",
    build: certified.build,
    bytes: certified.bytes,
  };
}

/** Produce the exact module on which every later transform is layered.
 * Production always derives and certifies one semantic rewrite transaction.
 * Injectable resolvers exist only to keep legacy-table fixture branches
 * executable without granting those tables runtime authority. */
export function preparePostTemplateSaveModule(
  input: Uint8Array,
  resolvers?: TemplateSaveResolvers,
): PostTemplateSaveModule | null {
  if (!resolvers) return deriveEquivalentPostTemplateSaveModule(input);
  const certified = resolvers.certified(sha256(input));
  const build = certified ?? resolvers.structurallyDerived(input);
  if (!build) return null;
  return {
    resolution: certified ? "certified" : "structurally-derived",
    build,
    bytes: rewriteTemplateSaveWasm(input, build),
  };
}
