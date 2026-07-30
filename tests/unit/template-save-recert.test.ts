import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  compareToCertified,
  deriveTemplateSaveBuild,
  draftTemplateSaveBuild,
  formatBuildEntry,
  inspectTemplateSaveCandidate,
} from "../../src/tools/template-save-recert.js";
import {
  isLocalClientVerification,
  verifyLocalClientBytes,
} from "../../src/main/core/local-client-verifier.js";
import {
  deriveEquivalentTemplateSaveBuild,
} from "../../src/main/core/template-save-verifier.js";
import {
  concat,
  encodeCode,
  encodeSection,
  paddedIndex,
  parseCode,
  sectionById,
  splitSections,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/core/enhancement-builds.js";
import { defaultGuildWarsProfile } from "../../src/tools/enhancement-doctor.js";

function uleb(value: number): number[] {
  const out: number[] = [];
  do {
    const byte = value & 0x7f;
    value >>>= 7;
    out.push(value === 0 ? byte : byte | 0x80);
  } while (value !== 0);
  return out;
}

function sleb(value: number): number[] {
  const out: number[] = [];
  for (;;) {
    const byte = value & 0x7f;
    value >>= 7;
    const sign = (byte & 0x40) !== 0;
    if ((value === 0 && !sign) || (value === -1 && sign)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

const IMPORTS = 2;
const CARRIER = 0;
const ASSERT_HOOK = 1;

/** The padded encoding the transform repoints in place. */
function callIndex(index: number): number[] {
  const bytes = [0x10];
  for (let position = 0; position < 5; position += 1) {
    bytes.push((index & 0x7f) | (position === 4 ? 0 : 0x80));
    index >>>= 7;
  }
  return bytes;
}

function call(local: number): number[] {
  return callIndex(IMPORTS + local);
}

/** The canonical encoding, which a repoint could not overwrite in place. */
function canonicalCall(local: number): number[] {
  return [0x10, ...uleb(IMPORTS + local)];
}

function constant(value: number): number[] {
  return [0x41, ...sleb(value)];
}

const DATA_BASE = 1024;
const MESSAGE = "not implemented";
const FILE = "../../../../Base/Os/Emscripten/Exe/EmscriptenExeFile.cpp";
const MESSAGE_AT = DATA_BASE;
const FILE_AT = DATA_BASE + MESSAGE.length + 1;
const LINE = 840;

// Types, in the order the type section declares them.
const T_CREATE = 0; // (i32,i32)->i32
const T_FIND = 1; // (i32,i32,i32)->()
const T_NAME = 2; // (i32 x6)->i32
const T_DELETE = 3; // (i32)->i32
const T_OPEN = 4; // (i32,i32,i32)->i32
const T_VOID = 5; // ()->()
const T_CARRIER = 6; // (i32,i32,i32,i32)->i32, the shape the forwarders call

const CREATE_BODY = [0x00, 0x41, 0x02, 0x0b];
const FIND_BODY = [0x00, 0x0b];
const NAME_BODY = [0x00, 0x41, 0x00, 0x0b];

interface Local {
  type: number;
  body: number[];
}

interface Options {
  /** A second create-directory stub that is also called several times. */
  ambiguousCreate?: boolean;
  /** A third function calling both find-files and entry-name. */
  thirdScan?: boolean;
  /** Encode the write function's probe call canonically. */
  canonicalProbe?: boolean;
  /** A second function calling File::Open with modes 1 and 2. */
  secondOpenPair?: boolean;
  /** Change the path pointer passed to the existence probe. */
  probePath?: number;
}

/**
 * A module carrying every shape the locators look for, plus a decoy for each,
 * plus the callers that produce the real intersections. Local indices are
 * assigned in declaration order and referenced through `at`.
 */
function build(options: Options = {}): {
  // Backed by a plain ArrayBuffer, not the shared one a bare `Uint8Array`
  // leaves open: `WebAssembly.validate` only accepts the unshared form, and
  // these fixtures are handed to it directly.
  bytes: Uint8Array<ArrayBuffer>;
  at: Record<string, number>;
} {
  const locals: Local[] = [];
  const at: Record<string, number> = {};
  const add = (name: string, type: number, body: number[]) => {
    at[name] = locals.length;
    locals.push({ type, body });
    return at[name]!;
  };

  const createStub = add("createStub", T_CREATE, CREATE_BODY);
  const findStub = add("findStub", T_FIND, FIND_BODY);
  const nameStub = add("nameStub", T_NAME, NAME_BODY);
  const assertHandler = add("assertHandler", T_FIND, [
    0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02,
    ...callIndex(ASSERT_HOOK), 0x1a, 0x0b,
  ]);
  const deleteStub = add("deleteStub", T_DELETE, [
    0x00,
    ...constant(MESSAGE_AT),
    ...constant(FILE_AT),
    ...constant(LINE),
    ...call(assertHandler),
    0x00, 0x0b,
  ]);
  const fileOpen = add("fileOpen", T_OPEN, NAME_BODY.slice(0, 3).concat(0x0b));

  // Decoys: same shape, no callers.
  add("findDecoy", T_FIND, FIND_BODY);
  add("nameDecoy", T_NAME, NAME_BODY);
  add("createDecoy", T_CREATE, CREATE_BODY);
  add("deleteDecoy", T_DELETE, [
    0x00,
    ...constant(MESSAGE_AT),
    ...constant(FILE_AT),
    ...constant(LINE),
    ...call(assertHandler),
    0x00, 0x0b,
  ]);

  const scanBody = [
    0x00,
    ...constant(0), ...constant(0), ...constant(0), ...call(findStub),
    ...Array.from({ length: 6 }, () => constant(0)).flat(),
    ...call(nameStub), 0x1a,
    0x0b,
  ];
  add("scanA", T_VOID, scanBody);
  add("scanB", T_VOID, scanBody);

  const sinkBody = [
    0x00,
    ...constant(0), ...constant(0), ...call(createStub), 0x1a,
    ...constant(0), ...constant(0), ...constant(0), ...call(findStub),
    0x0b,
  ];
  add("sinkA", T_VOID, sinkBody);
  add("sinkB", T_VOID, sinkBody);

  const probeCall = options.canonicalProbe
    ? canonicalCall(fileOpen)
    : call(fileOpen);
  add("writeFn", T_VOID, [
    0x00,
    ...constant(0), ...constant(0), ...call(createStub), 0x1a,
    ...constant(options.probePath ?? 0),
    ...constant(1), ...constant(0), ...probeCall, 0x1a,
    ...constant(0), ...constant(2), ...constant(0), ...call(fileOpen), 0x1a,
    0x0b,
  ]);

  // Callers the locators must exclude: they touch one stub only.
  add("loginAlike", T_VOID, [
    0x00, ...constant(0), ...constant(0), ...call(createStub), 0x1a, 0x0b,
  ]);
  add("frameAlike", T_VOID, [
    0x00, ...constant(0), ...constant(0), ...constant(0), ...call(findStub), 0x0b,
  ]);
  const modelBody = [
    0x00,
    ...Array.from({ length: 6 }, () => constant(0)).flat(),
    ...call(nameStub), 0x1a, 0x0b,
  ];
  add("modelA", T_VOID, modelBody);
  add("modelB", T_VOID, modelBody);

  add("deleteCaller", T_VOID, [
    0x00, ...constant(0), ...call(deleteStub), 0x1a, 0x0b,
  ]);

  // Assert-handler lookalikes: same shape and hook, one caller each.
  const lookalikeA = add("lookalikeA", T_FIND, [
    0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02,
    ...callIndex(ASSERT_HOOK), 0x1a, 0x0b,
  ]);
  const lookalikeB = add("lookalikeB", T_FIND, [
    0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02,
    ...callIndex(ASSERT_HOOK), 0x1a, 0x0b,
  ]);
  const callThree = (target: number) => [
    0x00, ...constant(0), ...constant(0), ...constant(0), ...call(target), 0x0b,
  ];
  add("lookalikeCallerA", T_VOID, callThree(lookalikeA));
  add("lookalikeCallerB", T_VOID, callThree(lookalikeB));

  if (options.ambiguousCreate) {
    const rival = add("createRival", T_CREATE, CREATE_BODY);
    for (let index = 0; index < 3; index += 1) {
      add(`createRivalCaller${index}`, T_VOID, [
        0x00, ...constant(0), ...constant(0), ...call(rival), 0x1a, 0x0b,
      ]);
    }
  }
  if (options.thirdScan) add("scanC", T_VOID, scanBody);
  if (options.secondOpenPair) {
    add("secondOpenPair", T_VOID, [
      0x00,
      ...constant(0), ...constant(0), ...call(createStub), 0x1a,
      ...constant(0), ...constant(1), ...constant(0), ...call(fileOpen), 0x1a,
      ...constant(0), ...constant(2), ...constant(0), ...call(fileOpen), 0x1a,
      0x0b,
    ]);
  }

  // The assert handler must dominate its lookalikes by a wide margin, the way
  // it does in the real client (7274 callers against one).
  for (let index = 0; index < 150; index += 1) {
    add(`assertCaller${index}`, T_VOID, callThree(assertHandler));
  }

  const types = section(1, [
    7,
    0x60, 2, 0x7f, 0x7f, 1, 0x7f,
    0x60, 3, 0x7f, 0x7f, 0x7f, 0,
    0x60, 6, ...Array.from({ length: 6 }, () => 0x7f), 1, 0x7f,
    0x60, 1, 0x7f, 1, 0x7f,
    0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f,
    0x60, 0, 0,
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
  ]);
  const name = (value: string) => [
    value.length, ...[...value].map((character) => character.charCodeAt(0)),
  ];
  const imports = section(2, [
    2,
    ...name("env"), ...name("__syscall_newfstatat"), 0x00, T_CARRIER,
    ...name("env"), ...name("emscripten_asm_const_int"), 0x00, T_OPEN,
  ]);
  const memory = section(5, [1, 0x00, 1]);
  const functions = section(3, [
    ...uleb(locals.length),
    ...locals.flatMap((local) => uleb(local.type)),
  ]);
  const code = section(10, [
    ...uleb(locals.length),
    ...locals.flatMap((local) => [...uleb(local.body.length), ...local.body]),
  ]);
  const payload = [
    ...[...MESSAGE].map((character) => character.charCodeAt(0)), 0,
    ...[...FILE].map((character) => character.charCodeAt(0)), 0,
  ];
  const data = section(11, [
    1, 0x00, 0x41, ...sleb(DATA_BASE), 0x0b, ...uleb(payload.length), ...payload,
  ]);

  return {
    bytes: Uint8Array.from([
      0, 97, 115, 109, 1, 0, 0, 0,
      ...types, ...imports, ...functions, ...memory, ...code, ...data,
    ]),
    at,
  };
}

function rewriteCode(
  input: Uint8Array,
  edit: (bodies: Uint8Array[]) => void,
): Uint8Array {
  const sections = splitSections(input);
  const bodies = parseCode(sectionById(sections, 10));
  edit(bodies);
  return concat(
    WASM_HEADER,
    ...sections.map((sectionValue) =>
      encodeSection(sectionValue.id === 10
        ? { id: 10, body: encodeCode(bodies) }
        : sectionValue)),
  );
}

describe("template-save re-certification", () => {
  it("builds a valid fixture module", () => {
    assert.equal(WebAssembly.validate(build().bytes), true);
  });

  it("derives every target and call site past its decoys", () => {
    const { bytes, at } = build();
    const entry = draftTemplateSaveBuild(bytes);

    assert.equal(entry.importCount, IMPORTS);
    assert.equal(entry.carrierImport, CARRIER);

    const bridge = (kind: string) =>
      entry.bridges.find((value) => value.kind === kind)!;
    assert.equal(bridge("ensureDirectory").stubFunction, at.createStub);
    assert.equal(bridge("findFiles").stubFunction, at.findStub);
    assert.equal(bridge("fileBaseName").stubFunction, at.nameStub);
    assert.equal(bridge("deleteFile").stubFunction, at.deleteStub);
    assert.equal(bridge("fileExists").stubFunction, at.fileOpen);

    // The decoys share the shape and must not be chosen.
    for (const decoy of ["createDecoy", "findDecoy", "nameDecoy", "deleteDecoy"]) {
      assert.ok(
        entry.bridges.every((value) => value.stubFunction !== at[decoy]),
        `${decoy} was selected`,
      );
    }

    const callers = (kind: string) =>
      bridge(kind).callSites.map((site) => site.localFunction).sort((a, b) => a - b);
    assert.deepEqual(
      callers("ensureDirectory"),
      [at.writeFn, at.sinkA, at.sinkB].sort((a, b) => a! - b!),
    );
    assert.deepEqual(
      callers("findFiles"),
      [at.scanA, at.scanB, at.sinkA, at.sinkB].sort((a, b) => a! - b!),
    );
    assert.deepEqual(callers("fileBaseName"), [at.scanA, at.scanB]);
    assert.deepEqual(callers("deleteFile"), [at.deleteCaller]);

    // Only the probe, never the write call that follows it in the same body.
    assert.deepEqual(callers("fileExists"), [at.writeFn]);
    assert.equal(bridge("fileExists").callSites.length, 1);
  });

  it("excludes the callers that must keep the original behaviour", () => {
    const { bytes, at } = build();
    const entry = draftTemplateSaveBuild(bytes);
    const touched = new Set(
      entry.bridges.flatMap((bridge) =>
        bridge.callSites.map((site) => site.localFunction)),
    );
    for (const excluded of ["loginAlike", "frameAlike", "modelA", "modelB"]) {
      assert.ok(!touched.has(at[excluded]!), `${excluded} was repointed`);
    }
  });

  it("reads the delete stub's own assertion rather than guessing", () => {
    const report = inspectTemplateSaveCandidate(build().bytes);
    assert.equal(report.status, "derived");
    assert.deepEqual(report.deleteAssertion, {
      message: MESSAGE,
      file: FILE,
      line: LINE,
    });
    assert.equal(report.targets.assertHandler?.localFunction, build().at.assertHandler);
  });

  it("round-trips the derived entry through the production transform", () => {
    const { bytes } = build();
    const entry = deriveTemplateSaveBuild(bytes);
    assert.match(entry.outputSha256, /^[0-9a-f]{64}$/);
    assert.match(formatBuildEntry(entry), /kind: "ensureDirectory" as const/);
    // No certified entry exists for a synthetic module.
    assert.deepEqual(compareToCertified(entry), [
      `no certified entry for ${entry.sha256}`,
    ]);
  });

  it("fingerprints complete caller semantics, not only call offsets", () => {
    const baseline = inspectTemplateSaveCandidate(build().bytes);
    const changedPath = inspectTemplateSaveCandidate(
      build({ probePath: 1 }).bytes,
    );
    assert.equal(baseline.status, "derived");
    assert.equal(changedPath.status, "derived");
    assert.notEqual(
      changedPath.semanticFingerprint,
      baseline.semanticFingerprint,
    );
    assert.deepEqual(
      changedPath.entry?.bridges.map((bridge) => bridge.callSites),
      baseline.entry?.bridges.map((bridge) => bridge.callSites),
      "the shape locator still sees identical call offsets",
    );
  });

  it("reports a build with no create-directory stub as not applicable", () => {
    // The "ArenaNet fixed it" signal: nothing returns i32.const 2.
    const patched = build().bytes.slice();
    const marker = CREATE_BODY;
    for (let at = 0; at + marker.length <= patched.length; at += 1) {
      if (marker.every((value, offset) => patched[at + offset] === value)) {
        patched[at + 2] = 0x03; // `i32.const 3` — no create-directory shape left
      }
    }
    const report = inspectTemplateSaveCandidate(patched);
    assert.equal(report.status, "not-applicable");
    assert.match(report.diagnostics.join(" "), /no create-directory stub/);
  });

  it("keeps the negative fixtures valid, so the throw is the locator's", () => {
    for (const options of [
      { ambiguousCreate: true },
      { thirdScan: true },
      { secondOpenPair: true },
      { canonicalProbe: true },
    ]) {
      assert.equal(
        WebAssembly.validate(build(options).bytes),
        true,
        `${JSON.stringify(options)} produced an invalid module`,
      );
    }
  });

  it("refuses to guess when a predicate matches more than once", () => {
    assert.throws(
      () => draftTemplateSaveBuild(build({ ambiguousCreate: true }).bytes),
      /expected exactly one create-directory stub, found 2/,
    );
    assert.throws(
      () => draftTemplateSaveBuild(build({ thirdScan: true }).bytes),
      /expected exactly 2 template scans/,
    );
    assert.throws(
      () => draftTemplateSaveBuild(build({ secondOpenPair: true }).bytes),
      /expected exactly one File::Open probe\/write pair/,
    );
  });

  // A canonically encoded call is invisible to the needle scan, so the site is
  // simply not found. The cardinality checks are what turn that into an error
  // instead of a silently incomplete rewrite.
  it("fails loudly when a call site is not padded to the repointable width", () => {
    assert.throws(
      () => draftTemplateSaveBuild(build({ canonicalProbe: true }).bytes),
      /File::Open probe\/write pair/,
    );
  });

  // The real proof. The client artifact is gitignored and absent in CI, so this
  // runs wherever the game is installed and skips cleanly elsewhere.
  it("makes a fail-closed decision for an installed client", async (t) => {
    const artifact = process.env.GW_CLIENT_WASM
      ?? path.join(defaultGuildWarsProfile(), "game", "artifacts", "Gw.jspi.wasm");
    const bytes = await readFile(artifact).catch(() => null);
    if (!bytes) {
      return t.skip(
        `no client WASM at ${artifact}; set GW_CLIENT_WASM to point at one`,
      );
    }
    const derived = deriveTemplateSaveBuild(bytes);
    const report = inspectTemplateSaveCandidate(bytes);
    const local = verifyLocalClientBytes(bytes);
    assert.equal(
      isLocalClientVerification(local, local.officialSha256),
      true,
    );
    // If this is a statically shipped build, the shape locator must still
    // reproduce that record exactly. Unknown builds are intentionally decided
    // by the local verifier instead of making this test demand a release.
    if (report.certified) {
      assert.deepEqual(compareToCertified(derived), []);
    }

    const fileExists = derived.bridges.find(
      (bridge) => bridge.kind === "fileExists",
    )!;
    const site = fileExists.callSites[0]!;
    // The current client computes the path argument immediately before the
    // existence probe. Keep the call at the exact same byte offset while
    // changing that computation by one byte.
    const changedCaller = rewriteCode(bytes, (bodies) => {
      const caller = bodies[site.localFunction]!;
      const pathImmediate = site.bodyOffset - 7;
      caller[pathImmediate] = caller[pathImmediate]! ^ 1;
    });
    assert.equal(WebAssembly.validate(new Uint8Array(changedCaller)), true);
    assert.equal(deriveEquivalentTemplateSaveBuild(changedCaller), null);
    assert.deepEqual(
      verifyLocalClientBytes(changedCaller).reasons,
      ["template-shape-changed"],
    );

    const layout = ENHANCEMENT_BUILDS[ENHANCEMENT_BUILDS.length - 1]!.layout;
    const needle = paddedIndex(layout.agentArray);
    const touched = new Set(
      derived.bridges.flatMap((bridge) =>
        bridge.callSites.map((callSite) => callSite.localFunction)),
    );
    let changedAddress = false;
    const changedAddressReference = rewriteCode(bytes, (bodies) => {
      for (let local = 0; local < bodies.length; local += 1) {
        if (touched.has(local)) continue;
        const body = bodies[local]!;
        const at = body.findIndex((_, offset) =>
          needle.every((byte, index) => body[offset + index] === byte));
        if (at < 0) continue;
        body[at] = body[at]! ^ 1;
        changedAddress = true;
        break;
      }
    });
    assert.equal(changedAddress, true);
    assert.equal(
      WebAssembly.validate(new Uint8Array(changedAddressReference)),
      true,
    );
    const addressDecision = verifyLocalClientBytes(changedAddressReference);
    assert.ok(addressDecision.templateSaveBuild);
    assert.equal(addressDecision.enhancementBuild, null);
    assert.deepEqual(addressDecision.reasons, ["enhancement-layout-changed"]);
  });
});
