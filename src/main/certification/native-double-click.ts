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
import type {
  DecodedFunction,
  ModuleShape,
} from "./enhancement-evidence-types.js";
import { relocationAwareFingerprint } from "./semantic-proof.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const NATIVE_DOUBLE_CLICK_TRANSFORM_ABI = 1;

/** The exported mutable global the host writes before each trusted press. */
export const DOUBLE_CLICK_FLAG_EXPORT = "gwonmac_double_click";

/**
 * What must hold before a mousedown callback may be rewritten.
 *
 * `callbackBodySha256` binds the insertion site. `route` separately proves the
 * existing enqueue, pump, translator, mouse dispatch and click-consumer path;
 * an unchanged callback cannot grant authority when a downstream edge moved.
 *
 * `derivations` contains exactly one verifier-issued input/output transaction
 * after derivation. Authored baselines keep it empty; no capability-profile
 * Cartesian hash table participates in authority.
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
  readonly callbackFingerprint: string;
  /** Byte offset in the body at which the flag store is inserted. */
  readonly flagStoreOffset: number;
  /**
   * Byte offset from the frame pointer in local 3 to the record's flag word.
   * The client's translator copies that word into the press message the
   * double-click bit is masked out of.
   */
  readonly flagStoreFrameOffset: number;
  /** End-to-end client path that consumes the stored record field. */
  readonly route?: NativeDoubleClickRoute;
  /** Certified predecessor module hash -> the hash this stage produces. */
  readonly derivations: Readonly<Record<string, string>>;
}

interface NativeDoubleClickRouteRole {
  readonly functionIndex: number;
  readonly params: readonly "i32"[];
  readonly results: readonly "i32"[];
  readonly bodySha256: string;
  readonly bodyFingerprint: string;
}

export interface NativeDoubleClickRoute {
  readonly enqueue: NativeDoubleClickRouteRole;
  readonly dequeue: NativeDoubleClickRouteRole;
  readonly pump: NativeDoubleClickRouteRole;
  readonly translator: NativeDoubleClickRouteRole;
  readonly mouseDispatch: NativeDoubleClickRouteRole & { readonly tableSlot: number };
  readonly clickConsumer: NativeDoubleClickRouteRole;
  readonly flagLift: NativeDoubleClickRouteRole;
}

/**
 * These hashes identify the semantic roles inside the proven route. Function
 * indexes and table slots are observations only: derivation relocates every
 * unique role and rechecks the call and table relationships.
 */
export const NATIVE_DOUBLE_CLICK_BUILDS: readonly NativeDoubleClickBuild[] = [
  {
    callbackTableSlot: 903,
    callbackFunctionIndex: 2448,
    callbackParams: ["i32", "i32", "i32"],
    callbackResults: ["i32"],
    callbackBodySha256:
      "1f6d69d4364a8369aba990defe34f746063a412fb2e6bc0ae9cc1b4b236acf1e",
    callbackFingerprint: "fe687410854b1a0ab96016f2badfe47534b9b0fc21851a3cf28110cdeab683a0",
    flagStoreOffset: 101,
    flagStoreFrameOffset: 24,
    route: {
      enqueue: { functionIndex: 791, params: ["i32"], results: [], bodySha256: "d9f78373ec35f3fb4ad7388d3b31e06b3d0c4db3343a0e74097a9dadfc80a93c", bodyFingerprint: "2d2039fa68e1196e7aebf2f987451a9188bce5ad2e60a977e11bdd6f397a939f" },
      dequeue: { functionIndex: 794, params: ["i32"], results: ["i32"], bodySha256: "f6d22a37562eb7ec95f2d0aa9544c6eb8e9a209f1484ad0a6af1334940aaa2f0", bodyFingerprint: "4df17bd1d3dca473649f97098023e6f6e52a6f5f286c882a8719ff9b6971d1e1" },
      pump: { functionIndex: 828, params: ["i32"], results: [], bodySha256: "11620652301dab72026f9c30b69a000412e8f19f7373755c19ed22b3f60d3a8f", bodyFingerprint: "f41f2481394d0264aca285ff719081173c5596ae87998d7f70f654233f69b248" },
      translator: { functionIndex: 829, params: ["i32", "i32"], results: [], bodySha256: "c12a6ae5eb7fa95d377b4ac6ce5614d0632197e73ac730cd12a9e3ca43b9cfe0", bodyFingerprint: "c2b011ae71ed8c1cf6770dc4c7f2147c8ddb7a1bd6bd0b23c0d28205425e60ea" },
      mouseDispatch: { functionIndex: 6293, params: ["i32", "i32"], results: [], bodySha256: "6c54a3e00fe0345f9ce2eaf4623553073883de2881819515f68c72f6e695876b", bodyFingerprint: "163d569bbd7595f3416f27aeffa562926a46a48640cad6bcdc19d0206a0ab700", tableSlot: 1736 },
      clickConsumer: { functionIndex: 6269, params: ["i32", "i32", "i32"], results: [], bodySha256: "decf63eac1ae329406fc7da67a7612a4ece55b0ba6461d9f0cabce12fb817b97", bodyFingerprint: "167afdad4a437d0c89e3d8f6f3f4202780bbab71fd7bf0a01a89a63754a4da86" },
      flagLift: { functionIndex: 6270, params: ["i32", "i32"], results: [], bodySha256: "9a6fe4439e635c9489bdc88d06de9d55039e47a214a82b5567c81024d11ea515", bodyFingerprint: "aa2524ac44c6287512b9d98feaf78ebaa6a5d984738b3e94007508d258df2f0d" },
    },
    derivations: {},
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

function routeMatchesBaseline(
  route: NativeDoubleClickRoute,
  baseline: NativeDoubleClickRoute,
): boolean {
  const roles = [
    "enqueue", "dequeue", "pump", "translator", "mouseDispatch",
    "clickConsumer", "flagLift",
  ] as const;
  return roles.every((role) =>
    route[role].bodyFingerprint === baseline[role].bodyFingerprint
    && sameStrings(route[role].params, baseline[role].params)
    && sameStrings(route[role].results, baseline[role].results),
  );
}

function callNormalizedFingerprint(
  body: Uint8Array,
  decoded: DecodedFunction,
): string {
  const sites = [...decoded.callSites.values()].flat()
    .sort((left, right) => left.offset - right.offset);
  return relocationAwareFingerprint(body, sites.map((site, index) => ({
    start: site.offset + 1,
    end: site.operandEnd,
    addressClass: "function-index",
    role: `direct-call:${index}`,
  })));
}

function locateRouteRole(
  module: ModuleShape,
  decoded: ReadonlyMap<number, DecodedFunction>,
  baseline: NativeDoubleClickRouteRole,
): NativeDoubleClickRouteRole | null {
  const matches = module.bodies.flatMap((body, localIndex) =>
    [localIndex + module.functionImportCount],
  ).filter((functionIndex) => signatureMatches(
    module, functionIndex, baseline.params, baseline.results,
  ) && callNormalizedFingerprint(
    functionBody(module, functionIndex), decoded.get(functionIndex)!,
  ) === baseline.bodyFingerprint);
  return matches.length === 1
    ? Object.freeze({
        ...baseline,
        functionIndex: matches[0]!,
        bodySha256: sha256(functionBody(module, matches[0]!)),
      })
    : null;
}

function deriveCompleteRoute(
  evidence: NonNullable<ReturnType<typeof wasmEvidence>>,
  baseline: NativeDoubleClickRoute,
  callbackFunctionIndex: number,
): NativeDoubleClickRoute | null {
  const module = evidence.moduleView();
  const decoded = new Map(evidence.decodeFunctions([]).map((entry) => [
    entry.functionIndex, entry,
  ]));
  const enqueue = locateRouteRole(module, decoded, baseline.enqueue);
  const dequeue = locateRouteRole(module, decoded, baseline.dequeue);
  const pump = locateRouteRole(module, decoded, baseline.pump);
  const translator = locateRouteRole(module, decoded, baseline.translator);
  const mouseDispatch = locateRouteRole(module, decoded, baseline.mouseDispatch);
  const clickConsumer = locateRouteRole(module, decoded, baseline.clickConsumer);
  const flagLift = locateRouteRole(module, decoded, baseline.flagLift);
  if (!enqueue || !dequeue || !pump || !translator || !mouseDispatch
    || !clickConsumer || !flagLift) return null;
  const calls = new Map([...decoded].map(([functionIndex, entry]) => [
    functionIndex, entry.calls,
  ]));
  const callsAtLeast = (from: number, to: number, count = 1): boolean =>
    (calls.get(from)?.get(to) ?? 0) >= count;
  const dispatchSlots = evidence.tableRelations.get(mouseDispatch.functionIndex) ?? [];
  if (
    !callsAtLeast(callbackFunctionIndex, enqueue.functionIndex)
    || !callsAtLeast(pump.functionIndex, dequeue.functionIndex)
    || !callsAtLeast(pump.functionIndex, translator.functionIndex)
    || !callsAtLeast(mouseDispatch.functionIndex, clickConsumer.functionIndex)
    || !callsAtLeast(clickConsumer.functionIndex, flagLift.functionIndex, 2)
    || dispatchSlots.length !== 1
  ) return null;
  return Object.freeze({
    enqueue,
    dequeue,
    pump,
    translator,
    mouseDispatch: Object.freeze({
      ...mouseDispatch,
      tableSlot: dispatchSlots[0]!,
    }),
    clickConsumer,
    flagLift,
  });
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
    || typeof build.callbackFingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(build.callbackFingerprint)
    || !build.derivations
    || typeof build.derivations !== "object"
    || Object.keys(build.derivations).length !== 1
    || !/^[0-9a-f]{64}$/.test(build.derivations[inputSha256] ?? "")
  ) return false;
  return baselines.some((baseline) =>
    build.callbackFingerprint === baseline.callbackFingerprint
    && build.flagStoreOffset === baseline.flagStoreOffset
    && build.flagStoreFrameOffset === baseline.flagStoreFrameOffset
    && sameStrings(build.callbackParams, baseline.callbackParams)
    && sameStrings(build.callbackResults, baseline.callbackResults)
    && (baseline.route === undefined
      || (build.route !== undefined
        && routeMatchesBaseline(build.route, baseline.route)))
  );
}

/** Locate an unchanged callback semantically when only the predecessor hash moved. */
export function deriveNativeDoubleClickBuild(
  input: Uint8Array,
  baselines: readonly NativeDoubleClickBuild[] = NATIVE_DOUBLE_CLICK_BUILDS,
): NativeDoubleClickBuild | null {
  try {
    const evidence = wasmEvidence(input);
    if (!evidence) return null;
    const module = evidence.moduleView();
    const table = activeTableEvidence(module.elementSection);
    if (table.overwrittenSlots.length > 0) return null;
    const tableRelations = table.relations;
    const inputSha256 = evidence.inputSha256;
    const decoded = new Map(evidence.decodeFunctions([]).map((entry) => [
      entry.functionIndex, entry,
    ]));
    const matches: NativeDoubleClickBuild[] = [];
    for (const baseline of baselines) {
      const candidates = module.bodies.flatMap((body, localIndex) =>
        callNormalizedFingerprint(
          body,
          decoded.get(localIndex + module.functionImportCount)!,
        ) === baseline.callbackFingerprint
          ? [localIndex + module.functionImportCount]
          : [],
      );
      if (candidates.length !== 1) continue;
      const callbackFunctionIndex = candidates[0]!;
      const callbackSlots = tableRelations.get(callbackFunctionIndex) ?? [];
      if (
        callbackSlots.length !== 1 ||
        !signatureMatches(
          module,
          callbackFunctionIndex,
          baseline.callbackParams,
          baseline.callbackResults,
        )
      )
        continue;
      const route = baseline.route
        ? deriveCompleteRoute(evidence, baseline.route, callbackFunctionIndex)
        : undefined;
      if (baseline.route && !route) continue;
      const candidate: NativeDoubleClickBuild = {
        ...baseline,
        callbackTableSlot: callbackSlots[0]!,
        callbackFunctionIndex,
        callbackBodySha256: sha256(functionBody(module, callbackFunctionIndex)),
        ...(route ? { route } : {}),
        derivations: {},
      };
      const output = rewriteWithBuild(input, candidate);
      matches.push({
        ...candidate,
        derivations: Object.freeze({ [inputSha256]: sha256(output) }),
      });
    }
    return matches.length === 1 ? matches[0]! : null;
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
  if (build.route
    && !deriveCompleteRoute(evidence, build.route, build.callbackFunctionIndex)) {
    fail("the complete native double-click route is not certified");
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
