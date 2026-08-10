/**
 * The native double-click transform: gives the client's own mouse double-click
 * flag the one byte the Emscripten glue never writes.
 *
 * `internal/upstream/mouse-double-click.md` owns the evidence. In short: the
 * client carries a per-press double-click bit from its input record through
 * `FrMouse` to the widget under the cursor, every consumer of it works, and
 * nothing ever sets it, because `fillMouseEventData` does not marshal
 * `MouseEvent.detail` and the mousedown callback memsets the record byte to
 * zero. Without it the host can only reach a double-click by synthesising a
 * touch tap pair, which is a different interaction: it warps the cursor,
 * force-releases captured buttons, enters the drag machinery, and delivers two
 * extra clicks on top of the player's own two.
 *
 * This appends one exported mutable global and one store. It adds no function,
 * moves no function index, and touches no table entry — the mousedown callback
 * writes the flag the host put in the global into the record slot the client
 * already reads.
 *
 * It refuses to own the decision about *when* a press is a double-click. That
 * is Chromium's click count under the player's own macOS preferences, and the
 * host writes it; this file only carries it across.
 */
import { createHash } from "node:crypto";
import {
  concat,
  countFunctionImports,
  encodeCode,
  encodeSection,
  parseCode,
  parseExports,
  readUleb,
  sectionById,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const NATIVE_DOUBLE_CLICK_TRANSFORM_ABI = 1;

/** The exported mutable global the host writes before each trusted press. */
export const DOUBLE_CLICK_FLAG_EXPORT = "gwonmac_double_click";

/**
 * What must hold before a mousedown callback may be rewritten.
 *
 * `callbackBodySha256` is the whole proof. The transform inserts instructions
 * at a fixed offset into that body and relies on local 3 being the frame
 * pointer and the record living at frame+8; a body that hashes to the
 * certified value *is* that body, so there is nothing left to infer. A build
 * whose callback differs by a byte is refused rather than guessed at.
 *
 * `derivations` is separate from that proof and does a different job: it is
 * the set of certified predecessor modules this stage may consume, each mapped
 * to the module it produces. The chain runs this transform last, so those
 * predecessors are the template-save output and the Enhancement output of each
 * certified capability profile — and because the callback body survives both
 * of those transforms untouched, one proof covers every entry.
 */
export interface NativeDoubleClickBuild {
  /** Active table slot the client registers as its mousedown callback. */
  readonly callbackTableSlot: number;
  /** Function index that slot resolves to. */
  readonly callbackFunctionIndex: number;
  /** SHA-256 of that function's body, before the rewrite. */
  readonly callbackBodySha256: string;
  /** Byte offset in the body at which the flag store is inserted. */
  readonly flagStoreOffset: number;
  /**
   * Byte offset from the frame pointer in local 3 to the record's flag word.
   * The client's translator copies that word into the press message the
   * double-click bit is masked out of.
   */
  readonly flagStoreFrameOffset: number;
  /** Certified predecessor module hash -> the hash this stage produces. */
  readonly derivations: Readonly<Record<string, string>>;
}

/**
 * Build 38735, whose official module is
 * `3229678d…`. Every hash below is reproduced by
 * `pnpm certification double-click`, which re-runs the chain from the official
 * bytes; the table is a cache of that derivation, never its authority.
 */
export const NATIVE_DOUBLE_CLICK_BUILDS: readonly NativeDoubleClickBuild[] = [
  {
    callbackTableSlot: 903,
    callbackFunctionIndex: 2448,
    callbackBodySha256:
      "1f6d69d4364a8369aba990defe34f746063a412fb2e6bc0ae9cc1b4b236acf1e",
    flagStoreOffset: 101,
    flagStoreFrameOffset: 24,
    derivations: {
      // template-save output, with the Enhancement off
      "9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094":
        "e7d86cfcf7b09abbedd3afca758dbf4a3f3c6e1aa4d44e53b31e45e886d7f250",
      // Enhancement outputs, one per certified capability profile
      "d187f89fe65ccde26ad3b1cf04a26f73ee5a245960f48d6ff6fb8d94d7156568":
        "e1dfd5cdda210c6c0ec7ad072a1ae3b04c904fd129b76cae25c55917de75599c",
      "b1d8a1d05d3ba8875cd02189849fb5c5fd35060ade9b0ec1851b6fbc597e0016":
        "c0e500344d86b79879bc71a7cb835b11e1e9c26f6498af01f4dce7dbe2accd10",
      "a8c7da36538171f51dbbf413bdcdc7f5981d8de70b31b107a9d27d750d102d46":
        "1a5bb34d01a810ac40c212da8875480958dd6ab2c3d1c935c16e68a53445046f",
      "d09d10ee32ce527320e8955d59a438e056a9e8b07fb8c1677ccdcce011fb76e9":
        "305014a2a03491c4ccb7a9bec2b3433a8817102210f242a3031e269412e7e8aa",
      "76e1ab16d293166d6920b3e27e002ca4558a1d3bce23fb46a73b7bcc99e0c3c4":
        "f4355d7f304b8f3b0288b7162f83e10e374df3f9f996562fe218a71032ada2fa",
      "bab9ad6f5f4c5ca56b014737192b353f0449a71348376bb8918c49ffd0e956b2":
        "955040ae3514e6a11efc8b681d16c6ae531ef1448c966f7bbe06fe6a203f377e",
    },
  },
];

function fail(message: string): never {
  throw new Error(`native double-click transform: ${message}`);
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function encodeName(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  return concat(uleb(bytes.length), bytes);
}

/** The entry that may consume this module, or null when none may. */
export function findNativeDoubleClickBuild(
  inputSha256: string,
): NativeDoubleClickBuild | null {
  return (
    NATIVE_DOUBLE_CLICK_BUILDS.find((build) =>
      Object.hasOwn(build.derivations, inputSha256),
    ) ?? null
  );
}

/** The module this stage produces from a certified predecessor. */
export function nativeDoubleClickOutputSha256(
  build: NativeDoubleClickBuild,
  inputSha256: string,
): string | null {
  return build.derivations[inputSha256] ?? null;
}

/**
 * Every active table slot mapped to the function it holds. Only slot-zero
 * segments with a constant offset appear in this module; anything else is
 * refused rather than approximated, because a mislocated callback would
 * rewrite an unrelated function.
 */
function tableSlotFunctions(body: Uint8Array): Map<number, number> {
  const slots = new Map<number, number>();
  const cursor = { offset: 0 };
  const count = readUleb(body, cursor);
  for (let segment = 0; segment < count; segment += 1) {
    if (readUleb(body, cursor) !== 0) fail("unsupported element segment flags");
    if (body[cursor.offset++] !== 0x41) fail("expected element i32.const");
    const base = readUleb(body, cursor);
    if (body[cursor.offset++] !== 0x0b) fail("malformed element offset");
    const entries = readUleb(body, cursor);
    for (let i = 0; i < entries; i += 1) {
      slots.set(base + i, readUleb(body, cursor));
    }
  }
  if (cursor.offset !== body.byteLength) fail("malformed element section");
  return slots;
}

/**
 * `local.get 3; global.get $flag; i32.store offset=<frameOffset>`.
 *
 * Three instructions and no branch: whatever the host last wrote lands in the
 * record slot, so a press the host declared ordinary clears the slot as surely
 * as a double-click sets it and no state survives between presses.
 */
function flagStore(globalIndex: number, frameOffset: number): Uint8Array {
  return concat(
    Uint8Array.of(0x20, 0x03),
    Uint8Array.of(0x23),
    uleb(globalIndex),
    Uint8Array.of(0x36, 0x02),
    uleb(frameOffset),
  );
}

/**
 * Rewrites one certified module. Returns the derived bytes; throws with the
 * reason on any input the entry above does not exactly describe.
 */
export function rewriteNativeDoubleClickWasm(input: Uint8Array): Uint8Array {
  const build = findNativeDoubleClickBuild(sha256(input));
  if (!build) fail("module hash is not a certified build");
  return rewriteWithBuild(input, build);
}

/**
 * The rewrite itself, against an entry supplied rather than looked up. The
 * production caller above resolves the entry by module hash; this is separated
 * so the guards can be executed against modules the shipped table does not
 * name, which is every module a test can build.
 */
export function rewriteWithBuild(
  input: Uint8Array,
  build: NativeDoubleClickBuild,
): Uint8Array {
  const sections = splitSections(input);
  const slots = tableSlotFunctions(sectionById(sections, 9));
  const held = slots.get(build.callbackTableSlot);
  if (held !== build.callbackFunctionIndex) {
    fail(
      `table slot ${build.callbackTableSlot} holds function ${held}, ` +
        `not ${build.callbackFunctionIndex}`,
    );
  }

  const bodies = parseCode(sectionById(sections, 10));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const localIndex = build.callbackFunctionIndex - importCount;
  const body = bodies[localIndex];
  if (!body) fail(`function ${build.callbackFunctionIndex} has no body`);
  if (sha256(body) !== build.callbackBodySha256) {
    fail("the mousedown callback is not the certified body");
  }
  if (build.flagStoreOffset > body.byteLength) {
    fail("flag store offset lies outside the callback body");
  }

  const globals = vectorPayload(sectionById(sections, 6));
  const exportSection = sectionById(sections, 7);
  const exports = vectorPayload(exportSection);
  if (
    parseExports(exportSection).some(
      (entry) => entry.name === DOUBLE_CLICK_FLAG_EXPORT,
    )
  ) {
    fail(`export ${DOUBLE_CLICK_FLAG_EXPORT} already exists`);
  }
  const flagGlobalIndex = globals.count;

  const nextBodies = [...bodies];
  nextBodies[localIndex] = concat(
    body.subarray(0, build.flagStoreOffset),
    flagStore(flagGlobalIndex, build.flagStoreFrameOffset),
    body.subarray(build.flagStoreOffset),
  );

  const rewritten = sections.map((section): Section => {
    if (section.id === 6) {
      return {
        id: section.id,
        body: concat(
          uleb(globals.count + 1),
          globals.entries,
          // i32, mutable, initialised to zero: no press is a double-click
          // until the host says so, including the first one after a reload.
          Uint8Array.of(0x7f, 0x01, 0x41, 0x00, 0x0b),
        ),
      };
    }
    if (section.id === 7) {
      return {
        id: section.id,
        body: concat(
          uleb(exports.count + 1),
          exports.entries,
          encodeName(DOUBLE_CLICK_FLAG_EXPORT),
          Uint8Array.of(0x03),
          uleb(flagGlobalIndex),
        ),
      };
    }
    if (section.id === 10) {
      return { id: section.id, body: encodeCode(nextBodies) };
    }
    return section;
  });

  const output = concat(WASM_HEADER, ...rewritten.map(encodeSection));
  if (!WebAssembly.validate(output)) fail("rewritten module failed validation");
  return output;
}
