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
  encodeCode,
  encodeSection,
  parseExports,
  sectionById,
  splitSections,
  uleb,
  vectorPayload,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";
import {
  activeTableEvidence,
  functionBody,
  signatureMatches,
  wasmEvidence,
} from "./wasm-evidence.js";
import {
  locateNativeDoubleClickRoute,
  NATIVE_DOUBLE_CLICK_ROUTE_SHA256,
} from "./native-double-click-route-proof.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const NATIVE_DOUBLE_CLICK_TRANSFORM_ABI = 2;

/** The exported mutable global the host writes before each trusted press. */
export const DOUBLE_CLICK_FLAG_EXPORT = "gwonmac_double_click";

/**
 * What must hold before a mousedown callback may be rewritten.
 *
 * The semantic verifier proves the registered callback, queue copies, pump,
 * translator, message binding, mouse dispatcher, mask, and final consumer.
 * The raw callback and module hashes then bind that proof to the exact bytes
 * production rewrites. A build whose route changes is refused locally.
 */
export interface NativeDoubleClickBuild {
  /** Active table slot the client registers as its mousedown callback. */
  readonly callbackTableSlot: number;
  /** Function index that slot resolves to. */
  readonly callbackFunctionIndex: number;
  readonly callbackParams: readonly "i32"[];
  readonly callbackResults: readonly "i32"[];
  /** SHA-256 of that function's body, before the rewrite. */
  readonly callbackBodySha256: string;
  /** Semantic identity of the complete callback-to-consumer route. */
  readonly routeSemanticSha256: string;
  /** Byte offset in the body at which the flag store is inserted. */
  readonly flagStoreOffset: number;
  /**
   * Byte offset from the frame pointer in local 3 to the record's flag word.
   * The client's translator copies that word into the press message the
   * double-click bit is masked out of.
   */
  readonly flagStoreFrameOffset: number;
  /** One selected predecessor hash -> the exact hash this stage produces. */
  readonly derivations: Readonly<Record<string, string>>;
}

/** Historical shape only; production derives one exact transaction per input. */
export const NATIVE_DOUBLE_CLICK_BUILDS: readonly NativeDoubleClickBuild[] = [
  {
    callbackTableSlot: 903,
    callbackFunctionIndex: 2448,
    callbackParams: ["i32", "i32", "i32"],
    callbackResults: ["i32"],
    callbackBodySha256:
      "1f6d69d4364a8369aba990defe34f746063a412fb2e6bc0ae9cc1b4b236acf1e",
    routeSemanticSha256: NATIVE_DOUBLE_CLICK_ROUTE_SHA256,
    flagStoreOffset: 101,
    flagStoreFrameOffset: 24,
    derivations: Object.freeze({}),
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

/** The module this stage produces from a certified predecessor. */
export function nativeDoubleClickOutputSha256(
  build: NativeDoubleClickBuild,
  inputSha256: string,
): string | null {
  return build.derivations[inputSha256] ?? null;
}

function sameStrings(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/** Validate a relocated record that crossed the isolated-process boundary. */
export function isDerivedNativeDoubleClickBuild(
  value: unknown,
  inputSha256: string,
  baselines: readonly NativeDoubleClickBuild[] = NATIVE_DOUBLE_CLICK_BUILDS,
): value is NativeDoubleClickBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<NativeDoubleClickBuild>;
  if (
    !Number.isSafeInteger(build.callbackTableSlot)
    || (build.callbackTableSlot as number) < 0
    || !Number.isSafeInteger(build.callbackFunctionIndex)
    || (build.callbackFunctionIndex as number) < 0
    || !Number.isSafeInteger(build.flagStoreOffset)
    || (build.flagStoreOffset as number) < 0
    || !Number.isSafeInteger(build.flagStoreFrameOffset)
    || (build.flagStoreFrameOffset as number) < 0
    || typeof build.callbackBodySha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(build.callbackBodySha256)
    || build.routeSemanticSha256 !== NATIVE_DOUBLE_CLICK_ROUTE_SHA256
    || !build.derivations
    || typeof build.derivations !== "object"
    || Object.keys(build.derivations).length !== 1
    || !/^[0-9a-f]{64}$/.test(build.derivations[inputSha256] ?? "")
  ) return false;
  return baselines.some((baseline) =>
    build.routeSemanticSha256 === baseline.routeSemanticSha256
    && build.flagStoreOffset === baseline.flagStoreOffset
    && build.flagStoreFrameOffset === baseline.flagStoreFrameOffset
    && sameStrings(build.callbackParams, baseline.callbackParams)
    && sameStrings(build.callbackResults, baseline.callbackResults)
  );
}

/** Locate an unchanged callback semantically when only the predecessor hash moved. */
export function deriveNativeDoubleClickBuild(
  input: Uint8Array,
  baselines: readonly NativeDoubleClickBuild[] = NATIVE_DOUBLE_CLICK_BUILDS,
): NativeDoubleClickBuild | null {
  try {
    const route = locateNativeDoubleClickRoute(input);
    if (!route || route.semanticSha256 !== NATIVE_DOUBLE_CLICK_ROUTE_SHA256) return null;
    const evidence = wasmEvidence(input);
    if (!evidence) return null;
    const module = evidence.moduleView();
    const inputSha256 = evidence.inputSha256;
    const baseline = baselines.find((entry) =>
      entry.routeSemanticSha256 === route.semanticSha256
    );
    if (!baseline) return null;
    const callbackBody = functionBody(module, route.callbackFunctionIndex);
    const candidate: NativeDoubleClickBuild = {
      ...baseline,
      callbackTableSlot: route.callbackTableSlot,
      callbackFunctionIndex: route.callbackFunctionIndex,
      callbackBodySha256: sha256(callbackBody),
      routeSemanticSha256: route.semanticSha256,
      flagStoreOffset: route.flagStoreOffset,
      flagStoreFrameOffset: route.flagStoreFrameOffset,
      derivations: {},
    };
    const output = rewriteWithBuild(input, candidate);
    return {
      ...candidate,
      derivations: Object.freeze({ [inputSha256]: sha256(output) }),
    };
  } catch {
    return null;
  }
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
 * Rewrites one semantically certified module. Production obtains unknown-build
 * evidence in the isolated verifier; this synchronous helper is used by local
 * qualification and accepts the same unique callback/table proof.
 */
export function rewriteNativeDoubleClickWasm(input: Uint8Array): Uint8Array {
  const build = deriveNativeDoubleClickBuild(input);
  if (!build) fail("module does not prove the native double-click callback");
  return rewriteWithBuild(input, build);
}

/**
 * The rewrite itself, against an entry supplied rather than looked up. The
 * production caller supplies the isolated verifier's record; this is separated
 * so production performs and checks the transform again before publication.
 */
export function rewriteWithBuild(
  input: Uint8Array,
  build: NativeDoubleClickBuild,
): Uint8Array {
  const sections = splitSections(input);
  const evidence = wasmEvidence(input);
  if (!evidence) fail("invalid or unsupported input module");
  const module = evidence.moduleView();
  const table = activeTableEvidence(module.elementSection);
  if (table.overwrittenSlots.length > 0) {
    fail(`duplicate active table slot ${table.overwrittenSlots[0]}`);
  }
  const callbackSlots = table.relations.get(build.callbackFunctionIndex) ?? [];
  if (!callbackSlots.includes(build.callbackTableSlot)) {
    const held = [...table.relations].find(([, slots]) =>
      slots.includes(build.callbackTableSlot))?.[0];
    fail(
      `table slot ${build.callbackTableSlot} holds function ${held}, `
        + `not ${build.callbackFunctionIndex}`,
    );
  }

  const bodies = module.bodies;
  const localIndex = build.callbackFunctionIndex - module.functionImportCount;
  const body = functionBody(module, build.callbackFunctionIndex);
  if (!body) fail(`function ${build.callbackFunctionIndex} has no body`);
  if (
    !signatureMatches(
      module,
      build.callbackFunctionIndex,
      build.callbackParams,
      build.callbackResults,
    )
  ) fail("the mousedown callback does not have the certified signature");
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
