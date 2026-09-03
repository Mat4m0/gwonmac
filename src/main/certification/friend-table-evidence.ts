/**
 * Locates the native friend-table reader and its writers for offline research.
 * These input-bound candidates never grant observation or command authority.
 */
import { createHash } from "node:crypto";
import type { DecodedFunction, ModuleShape } from "./enhancement-evidence-types.js";
import { wasmEvidence, signatureMatches } from "./wasm-evidence.js";
import { relocationAwareFingerprint, type RelocationSpan } from "./semantic-proof.js";
import type { WasmDataEvidence } from "./wasm-data-evidence.js";

const TABLE_SOURCE = "../../../../Gw/Friend/FriendTable.cpp";
const API_SOURCE = "../../../../Gw/Friend/FriendApi.cpp";
const UI_SOURCE = "../../../../Gw/Ui/Game/GmFriendsList.cpp";
const INDEX_ASSERTION = "friendId < m_array.Count()";
const MAX_ROLE_FUNCTIONS = 64;
const ACCESSOR_SHAPE = "682df558db1505e0a2042f8f881e4f4c73c9c1bfa28f43cf18bf723ae5b9e130";
const WRITER_SHAPES = new Set([
  "717a24547951672cc0ae6e8fcbb0f96045adafe78ab808e9929ab44eed4dbc88",
  "3b220a2557bbdf56e7221240b76b543735a0f9202c7b456bf7115df64317312a",
]);

export type FriendTableCandidate = Readonly<{
  root: number;
  accessor: number;
  rootAccessor: number;
  arrayOffset: number;
  countOffset: number;
  scalarWriters: readonly Readonly<{ functionIndex: number; offset: number }>[];
  uiConsumers: readonly number[];
}>;

export type FriendTableEvidence = Readonly<{
  inputSha256: string;
  runtimeAuthority: false;
  status: "candidate" | "ambiguous" | "unavailable";
  candidates: readonly FriendTableCandidate[];
  unresolved: readonly string[];
}>;

function i32Loads(fn: DecodedFunction): readonly number[] {
  return fn.memorySites.filter((site) => site.opcode === 0x28).map((site) => site.value);
}

function hasConstant(fn: DecodedFunction, value: number): boolean {
  return fn.constantSites.some((site) => site.value === value);
}

function assertionBodyShape(
  module: ModuleShape,
  data: WasmDataEvidence,
  fn: DecodedFunction,
): string | null {
  if (fn.calls.size !== 1) return null;
  const assertFunction = fn.calls.keys().next().value;
  if (assertFunction === undefined
    || !signatureMatches(module, assertFunction, ["i32", "i32", "i32"], [])) return null;
  const spans: RelocationSpan[] = [];
  for (const site of fn.constantSites) {
    const text = data.readCString(site.value);
    if (text) spans.push({
      start: site.operandStart, end: site.operandEnd,
      addressClass: "immutable-data", role: text,
    });
  }
  for (const sites of fn.callSites.values()) {
    for (const site of sites) spans.push({
      start: site.offset + 1, end: site.operandEnd,
      addressClass: "function-index", role: "assert",
    });
  }
  return relocationAwareFingerprint(
    module.bodies[fn.functionIndex - module.functionImportCount]!, spans,
  );
}

function rootWrapper(
  module: ModuleShape,
  fn: DecodedFunction,
  accessor: number,
): number | null {
  if (!signatureMatches(module, fn.functionIndex, ["i32"], ["i32"])
    || fn.calls.size !== 1 || fn.calls.get(accessor) !== 1
    || fn.constantSites.length !== 1 || fn.memorySites.length !== 0) return null;
  const body = module.bodies[fn.functionIndex - module.functionImportCount];
  const constant = fn.constantSites[0]!;
  const call = fn.callSites.get(accessor)?.[0];
  if (!body || !call || body[0] !== 0 || constant.offset !== 1
    || body[constant.operandEnd] !== 0x20 || body[constant.operandEnd + 1] !== 0
    || call.offset !== constant.operandEnd + 2
    || call.operandEnd !== body.length - 1 || body.at(-1) !== 0x0b) return null;
  return constant.value;
}

export function inspectFriendTable(input: Uint8Array): FriendTableEvidence {
  const inputSha256 = createHash("sha256").update(input).digest("hex");
  const unavailable = (reason: string): FriendTableEvidence => ({
    inputSha256, runtimeAuthority: false, status: "unavailable",
    candidates: [], unresolved: [reason],
  });
  const context = wasmEvidence(input);
  if (!context) return unavailable("invalid-or-unsupported-module");
  try {
    const address = (text: string): number | null => {
      const matches = context.data.addresses(new TextEncoder().encode(`${text}\0`));
      return matches.length === 1 ? matches[0]! : null;
    };
    const tableSource = address(TABLE_SOURCE);
    const apiSource = address(API_SOURCE);
    const uiSource = address(UI_SOURCE);
    const indexAssertion = address(INDEX_ASSERTION);
    if (tableSource === null || apiSource === null || uiSource === null
      || indexAssertion === null) return unavailable("missing-or-ambiguous-source-anchor");
    const module = context.moduleView();
    const decoded = context.decodeFunctions([]);
    const table = decoded.filter((fn) => hasConstant(fn, tableSource));
    const api = decoded.filter((fn) => hasConstant(fn, apiSource));
    const ui = decoded.filter((fn) => hasConstant(fn, uiSource));
    if ([table, api, ui].some((functions) => functions.length > MAX_ROLE_FUNCTIONS)) {
      return unavailable("too-many-source-consumers");
    }
    const accessors = table.filter((fn) =>
      hasConstant(fn, indexAssertion)
      && signatureMatches(module, fn.functionIndex, ["i32", "i32"], ["i32"])
      && fn.memorySites.every((site) => site.opcode === 0x28)
      && assertionBodyShape(module, context.data, fn) === ACCESSOR_SHAPE
    );
    const candidates: FriendTableCandidate[] = [];
    for (const accessor of accessors) {
      const loads = i32Loads(accessor);
      if (loads.length !== 4 || loads[0] !== loads[1]
        || loads[2] !== 0 || loads[3] !== 0) continue;
      const wrappers = decoded.flatMap((fn) => {
        const root = rootWrapper(module, fn, accessor.functionIndex);
        return root === null ? [] : [{ fn, root }];
      });
      if (wrappers.length > MAX_ROLE_FUNCTIONS) return unavailable("too-many-root-wrappers");
      for (const { fn: wrapper, root } of wrappers) {
        if (root % 4 !== 0 || root < context.data.zeroInitializedBase
          || root + 12 > context.data.initialMemoryBytes) continue;
        const apiConsumers = api.filter((fn) =>
          hasConstant(fn, root) && fn.calls.has(accessor.functionIndex)
        );
        if (apiConsumers.length < 2) continue;
        const scalarWriters = table.filter((fn) =>
          hasConstant(fn, indexAssertion)
          && signatureMatches(module, fn.functionIndex, ["i32", "i32", "i32"], [])
          && fn.memorySites.filter((site) => site.opcode === 0x36).length === 1
          && fn.memorySites.every((site) => site.opcode === 0x28 || site.opcode === 0x36)
          && i32Loads(fn).join(",") === loads.join(",")
          && WRITER_SHAPES.has(assertionBodyShape(module, context.data, fn) ?? "")
        ).map((fn) => ({
          functionIndex: fn.functionIndex,
          offset: fn.memorySites.find((site) => site.opcode === 0x36)!.value,
        }));
        const uiConsumers = ui.filter((fn) =>
          scalarWriters.every((writer) => i32Loads(fn).includes(writer.offset))
        ).map((fn) => fn.functionIndex);
        if (scalarWriters.length !== 2 || uiConsumers.length === 0) continue;
        candidates.push({
          root, accessor: accessor.functionIndex, rootAccessor: wrapper.functionIndex,
          arrayOffset: 0, countOffset: loads[0]!, scalarWriters, uiConsumers,
        });
      }
    }
    return {
      inputSha256,
      runtimeAuthority: false,
      status: candidates.length === 1 ? "candidate"
        : candidates.length > 1 ? "ambiguous" : "unavailable",
      candidates,
      unresolved: candidates.length === 0 ? ["friend-table-relationships-not-found"] : [
        "complete-reader-writer-and-allocation-semantics",
        "friend-service-initialization-and-disconnect",
        "account-session-invalidation",
        "reconnect-location-refresh",
      ],
    };
  } catch {
    return unavailable("bounded-analysis-refused");
  }
}
