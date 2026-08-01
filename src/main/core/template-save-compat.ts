/**
 * ArenaNet's Emscripten port ships four unimplemented `Base/Os` file routines.
 * Creating a directory always fails with error 2, so a build cannot be saved.
 * Enumerating a directory does nothing and deriving a name from an entry writes
 * nothing, so "Load from Skills Template" stays empty. Deleting a file is
 * `assert("not implemented")` followed by `unreachable`, so removing or renaming
 * a build aborts the client.
 *
 * None of that can be repaired from JavaScript alone: the client never reaches
 * a syscall, and the module imports no `mkdir`, `getdents`, or `unlink`. So one
 * derived module, accepted only for an exact official hash, appends forwarders
 * and repoints the template, chat-log, and screenshot call sites at them. Each
 * forwarder hands the stub's arguments to `__syscall_newfstatat` behind a dirfd
 * that no real call can produce, where the renderer answers it.
 */
import { createHash } from "node:crypto";
// The dirfd markers are canonical in src/shared because the renderer half needs
// the same values and cannot import from here; the generated preload carries
// them across. See WASM_BRIDGE_MARKERS.
import { WASM_BRIDGE_MARKERS } from "../../shared/contracts.js";
import {
  concat,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  paddedIndex,
  parseCode,
  parseIndexVector,
  sectionById,
  sleb,
  splitSections,
  uleb,
  WASM_HEADER,
  type Section,
} from "./wasm-binary.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const TEMPLATE_SAVE_TRANSFORM_ABI = 2;

export type BridgeKind =
  | "ensureDirectory"
  | "findFiles"
  | "fileBaseName"
  | "deleteFile"
  | "fileExists";

export interface CallSite {
  /** Index into the code section, i.e. function index minus import count. */
  readonly localFunction: number;
  /** Byte offset of the `call` opcode inside that function body. */
  readonly bodyOffset: number;
}

export interface StubBridge {
  readonly kind: BridgeKind;
  /**
   * The function the certified call sites currently target. Its type is reused
   * for the forwarder, and `fileExists` also calls it.
   */
  readonly stubFunction: number;
  /**
   * Whole body of the stub, so an unexpected build fails closed. Omitted when
   * the target is a real implementation rather than a stub — there the call
   * site's own target index is the certification.
   */
  readonly stubBody?: readonly number[];
  readonly callSites: readonly CallSite[];
}

export interface KnownTemplateSaveBuild {
  readonly sha256: string;
  readonly outputSha256: string;
  readonly importCount: number;
  /** Import index of `__syscall_newfstatat`, the bridge's carrier. */
  readonly carrierImport: number;
  readonly bridges: readonly StubBridge[];
}

export const TEMPLATE_SAVE_BUILDS: readonly KnownTemplateSaveBuild[] =
  Object.freeze([
    Object.freeze({
      sha256:
        "b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483",
      outputSha256:
        "68c6e09cec0f6992058a44a5617ca9eac7fab4697be1421943bbf664e6d444f6",
      importCount: 219,
      carrierImport: 207,
      bridges: Object.freeze([
        // PathCreateDirectory(path, recursive) -> error. `i32.const 2` is
        // ERROR_FILE_NOT_FOUND, returned unconditionally.
        Object.freeze({
          kind: "ensureDirectory" as const,
          stubFunction: 185,
          stubBody: Object.freeze([0x00, 0x41, 0x02, 0x0b]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9538, bodyOffset: 171 }), // template save
            Object.freeze({ localFunction: 11525, bodyOffset: 142 }), // chat log
            Object.freeze({ localFunction: 12214, bodyOffset: 127 }), // screenshot
          ]),
        }),
        // FindFiles(out, pattern, flags) -> void. An empty body leaves the
        // caller's list zeroed, so every directory reads as empty.
        Object.freeze({
          kind: "findFiles" as const,
          stubFunction: 186,
          stubBody: Object.freeze([0x00, 0x0b]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9527, bodyOffset: 157 }), // skills list
            Object.freeze({ localFunction: 9528, bodyOffset: 157 }), // equipment list
            Object.freeze({ localFunction: 11525, bodyOffset: 210 }), // chat log
            Object.freeze({ localFunction: 12214, bodyOffset: 419 }), // screenshot
          ]),
        }),
        // FileBaseName(dst, _, baseDir, _, path, dstChars) -> written.
        // `i32.const 0` leaves the caller reading uninitialised stack. Only the
        // two template lists are repointed; the model paths that also call it
        // keep the fallback branch they take today.
        Object.freeze({
          kind: "fileBaseName" as const,
          stubFunction: 197,
          stubBody: Object.freeze([0x00, 0x41, 0x00, 0x0b]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9527, bodyOffset: 276 }),
            Object.freeze({ localFunction: 9528, bodyOffset: 278 }),
          ]),
        }),
        // DeleteFile(path) -> deleted. Not a silent stub like the others: the
        // body is `assert("not implemented")` followed by `unreachable`, so
        // deleting a build aborted the client outright.
        Object.freeze({
          kind: "deleteFile" as const,
          stubFunction: 333,
          stubBody: Object.freeze([
            0x00,
            0x41, 0x9e, 0x87, 0xc5, 0x80, 0x00,
            0x41, 0x80, 0xbb, 0xc3, 0x80, 0x00,
            0x41, 0xc8, 0x06,
            0x10, 0xc2, 0x82, 0x80, 0x80, 0x00,
            0x00,
            0x0b,
          ]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 459, bodyOffset: 201 }),
          ]),
        }),
        // File::Open(path, mode, err). Mode 1 is meant to open an existing
        // file, and `9757` uses it to ask whether a rename's destination is
        // already taken — but in this build mode 1 opens O_RDWR|O_CREAT, the
        // same as the write mode. The probe creates the file it is testing for,
        // reports it present, and refuses every rename.
        //
        // Only the probe is repointed. The write call five instructions later
        // keeps the real function, and so does the load path.
        Object.freeze({
          kind: "fileExists" as const,
          stubFunction: 552,
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9538, bodyOffset: 201 }),
          ]),
        }),
      ]),
    }),
    Object.freeze({
      sha256:
        "3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817",
      outputSha256:
        "9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094",
      importCount: 219,
      carrierImport: 207,
      bridges: Object.freeze([
        Object.freeze({
          kind: "ensureDirectory" as const,
          stubFunction: 185,
          stubBody: Object.freeze([0x00, 0x41, 0x02, 0x0b]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9541, bodyOffset: 171 }),
            Object.freeze({ localFunction: 11528, bodyOffset: 142 }),
            Object.freeze({ localFunction: 12217, bodyOffset: 127 }),
          ]),
        }),
        Object.freeze({
          kind: "findFiles" as const,
          stubFunction: 186,
          stubBody: Object.freeze([0x00, 0x0b]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9530, bodyOffset: 157 }),
            Object.freeze({ localFunction: 9531, bodyOffset: 157 }),
            Object.freeze({ localFunction: 11528, bodyOffset: 210 }),
            Object.freeze({ localFunction: 12217, bodyOffset: 419 }),
          ]),
        }),
        Object.freeze({
          kind: "fileBaseName" as const,
          stubFunction: 197,
          stubBody: Object.freeze([0x00, 0x41, 0x00, 0x0b]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9530, bodyOffset: 276 }),
            Object.freeze({ localFunction: 9531, bodyOffset: 278 }),
          ]),
        }),
        Object.freeze({
          kind: "deleteFile" as const,
          stubFunction: 333,
          stubBody: Object.freeze([
            0x00,
            0x41, 0xca, 0x87, 0xc5, 0x80, 0x00,
            0x41, 0xa3, 0xbb, 0xc3, 0x80, 0x00,
            0x41, 0xc8, 0x06,
            0x10, 0xc2, 0x82, 0x80, 0x80, 0x00,
            0x00,
            0x0b,
          ]),
          callSites: Object.freeze([
            Object.freeze({ localFunction: 459, bodyOffset: 201 }),
          ]),
        }),
        Object.freeze({
          kind: "fileExists" as const,
          stubFunction: 552,
          callSites: Object.freeze([
            Object.freeze({ localFunction: 9541, bodyOffset: 201 }),
          ]),
        }),
      ]),
    }),
  ]);

function fail(message: string): never {
  throw new Error(`template-save transform: ${message}`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function paddedCall(functionIndex: number): Uint8Array {
  return concat(Uint8Array.of(0x10), paddedIndex(functionIndex));
}

/**
 * Body of a forwarder that hands the stub's arguments to
 * `__syscall_newfstatat(dirfd, path, buffer, flags)` behind a dirfd marker.
 */
function forwarder(
  kind: BridgeKind,
  carrier: number,
  target: number,
): Uint8Array {
  const call = concat(Uint8Array.of(0x10), uleb(carrier));
  const marker = (value: number) => concat(Uint8Array.of(0x41), sleb(value));
  const local = (index: number) => Uint8Array.of(0x20, index);
  const noLocals = Uint8Array.of(0x00);
  const end = Uint8Array.of(0x0b);
  if (kind === "ensureDirectory") {
    // (path, recursive) -> error
    return concat(
      noLocals,
      marker(WASM_BRIDGE_MARKERS.ensureDirectory),
      local(0),
      Uint8Array.of(0x41, 0x00),
      local(1),
      call,
      end,
    );
  }
  if (kind === "fileExists") {
    // (path, mode, err) -> handle. Ask the host first; only open when the file
    // is really there, so the probe cannot create its own answer.
    return concat(
      noLocals,
      marker(WASM_BRIDGE_MARKERS.fileExists),
      local(0),
      Uint8Array.of(0x41, 0x00),
      Uint8Array.of(0x41, 0x00),
      call,
      Uint8Array.of(0x04, 0x7f), // if (result i32)
      local(0),
      local(1),
      local(2),
      Uint8Array.of(0x10),
      uleb(target),
      Uint8Array.of(0x05), // else
      Uint8Array.of(0x41, 0x00),
      Uint8Array.of(0x0b), // end if
      end,
    );
  }
  if (kind === "deleteFile") {
    // (path) -> deleted
    return concat(
      noLocals,
      marker(WASM_BRIDGE_MARKERS.deleteFile),
      local(0),
      Uint8Array.of(0x41, 0x00),
      Uint8Array.of(0x41, 0x00),
      call,
      end,
    );
  }
  if (kind === "findFiles") {
    // (out, pattern, flags) -> void
    return concat(
      noLocals,
      marker(WASM_BRIDGE_MARKERS.findFiles),
      local(1),
      local(0),
      local(2),
      call,
      Uint8Array.of(0x1a),
      end,
    );
  }
  // (dst, _, baseDir, _, path, dstChars) -> written
  return concat(
    noLocals,
    marker(WASM_BRIDGE_MARKERS.fileBaseName),
    local(4),
    local(0),
    local(5),
    call,
    end,
  );
}

export function findTemplateSaveBuild(
  inputSha256: string,
): KnownTemplateSaveBuild | null {
  return (
    TEMPLATE_SAVE_BUILDS.find((build) => build.sha256 === inputSha256) ?? null
  );
}

export function rewriteTemplateSaveWasm(
  input: Uint8Array,
  build: KnownTemplateSaveBuild,
): Uint8Array {
  const inputHash = sha256(input);
  if (inputHash !== build.sha256) {
    throw new Error(`template-save transform: unsupported input ${inputHash}`);
  }

  const sections = splitSections(input);
  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  if (functionTypes.length !== bodies.length) {
    fail("function and code sections disagree");
  }

  const nextTypes = [...functionTypes];
  const nextBodies: Uint8Array[] = bodies.map((body) => body.slice());

  for (const bridge of build.bridges) {
    const stub = bodies[bridge.stubFunction]
      ?? fail(`missing stub for ${bridge.kind}`);
    const expectedBody = bridge.stubBody;
    if (
      expectedBody
      && (stub.byteLength !== expectedBody.length
        || !expectedBody.every((byte, index) => stub[index] === byte))
    ) {
      fail(`${bridge.kind} is not the expected stub`);
    }

    // Appending keeps every existing function index valid, so only the chosen
    // call sites change meaning. The forwarder reuses the stub's own type.
    const forwarderIndex = build.importCount + nextBodies.length;
    nextTypes.push(functionTypes[bridge.stubFunction]!);
    nextBodies.push(
      forwarder(
        bridge.kind,
        build.carrierImport,
        build.importCount + bridge.stubFunction,
      ),
    );

    const expected = paddedCall(build.importCount + bridge.stubFunction);
    const replacement = paddedCall(forwarderIndex);
    for (const site of bridge.callSites) {
      const body = nextBodies[site.localFunction]
        ?? fail(`${bridge.kind} call site is out of range`);
      const end = site.bodyOffset + expected.byteLength;
      if (
        site.bodyOffset < 0
        || end > body.byteLength
        || !expected.every(
          (byte, index) => body[site.bodyOffset + index] === byte,
        )
      ) {
        fail(`${bridge.kind} call site signature mismatch`);
      }
      body.set(replacement, site.bodyOffset);
    }
  }

  const rewritten = sections.map((section): Section => {
    if (section.id === 3) {
      return { id: section.id, body: encodeIndexVector(nextTypes) };
    }
    if (section.id === 10) {
      return { id: section.id, body: encodeCode(nextBodies) };
    }
    return section;
  });
  const output = concat(WASM_HEADER, ...rewritten.map(encodeSection));

  const outputHash = sha256(output);
  if (outputHash !== build.outputSha256) {
    throw new Error(`template-save transform: unexpected output ${outputHash}`);
  }
  if (!WebAssembly.validate(output)) {
    throw new Error("template-save transform: rewritten module is invalid");
  }
  return output;
}
