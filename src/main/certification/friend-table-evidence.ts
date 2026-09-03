/**
 * Locates the native friend-table reader and its writers for offline research.
 * These input-bound candidates never grant observation or command authority.
 */
import { createHash } from "node:crypto";
import type { DecodedFunction, ModuleShape } from "./enhancement-evidence-types.js";
import { wasmEvidence, signatureMatches } from "./wasm-evidence.js";
import { relocationAwareFingerprint, type RelocationSpan } from "./semantic-proof.js";
import type { WasmDataEvidence } from "./wasm-data-evidence.js";
import { friendSemanticBodyShape } from "./friend-semantic-shape.js";

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
const RECORD_ROLE_SPECS = Object.freeze({
  arrayGrowth: [235, "9062b0fd4d9ee84f7428e3b2fddb4f86948e4770f78b0c4d5b0c4aebc908ab6c"],
  recordRemoval: [635, "2251934fb29e53d95c226adacafecf1d07cbdce592d8986b22181f8e0ee7a0a6"],
  recordConstructor: [788, "cc85ec7ea2b660c7cf2a5997bc8f7a35bd2a8f774b4d23424faa07d71bb1c8e0"],
  categoryWriter: [220, "6ef7710518737db22ee2a9b6263f2911a5eaae871ddc59ccd01843954494bc4f"],
  characterWriter: [383, "5fbe4aacc43c7053062cce9e294ba9cf146931e27d42f1df4909b849639dcc88"],
  aliasWriter: [375, "ae5bf01dd7d419675852463cc9fd170273ceaad5718a17791b43b69fca052a5f"],
  uuidWriter: [494, "6a7c73afac4742f9d1dc3a2ecbbfb5b20b4c2b49fdb6e049cce9c497fbc1a263"],
} as const);
const NAME_COPY_BYTES = 80;
const NAME_COPY_SHAPE = "1c87ab4b0831420341935898d106c902d85897a116b4beb7492bf4ab3b1ea9c7";

export const FRIEND_RECORD_SEMANTIC_SHA256 = createHash("sha256").update(JSON.stringify({
  roles: RECORD_ROLE_SPECS,
  nameCopy: [NAME_COPY_BYTES, NAME_COPY_SHAPE],
  contract: "sparse-array-record172-category-status-uuid-alias-character-slot-map-v1",
})).digest("hex");

export type FriendRecordLayout = Readonly<{
  capacityOffset: number;
  recordBytes: number;
  categoryOffset: number;
  statusOffset: number;
  uuidOffset: number;
  aliasOffset: number;
  characterOffset: number;
  slotOffset: number;
  mapOffset: number;
}>;

export type FriendTableCandidate = Readonly<{
  root: number;
  accessor: number;
  rootAccessor: number;
  arrayOffset: number;
  countOffset: number;
  scalarWriters: readonly Readonly<{ functionIndex: number; offset: number }>[];
  uiConsumers: readonly number[];
  recordLayout: FriendRecordLayout;
  recordRoles: Readonly<Record<keyof typeof RECORD_ROLE_SPECS | "nameCopy", number>>;
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

function uniqueRole(
  module: ModuleShape,
  data: WasmDataEvidence,
  functions: readonly DecodedFunction[],
  spec: readonly [number, string],
): DecodedFunction | null {
  const matches = functions.filter((fn) => {
    const body = module.bodies[fn.functionIndex - module.functionImportCount];
    return body?.byteLength === spec[0] && friendSemanticBodyShape(module, data, fn) === spec[1];
  });
  return matches.length === 1 ? matches[0]! : null;
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
    const nameCopies = decoded.filter((fn) => {
      const body = module.bodies[fn.functionIndex - module.functionImportCount];
      return body?.byteLength === NAME_COPY_BYTES
        && signatureMatches(module, fn.functionIndex, ["i32", "i32", "i32"], [])
        && fn.calls.size === 0
        && friendSemanticBodyShape(module, context.data, fn) === NAME_COPY_SHAPE;
    });
    const tableRoles = Object.fromEntries(Object.entries(RECORD_ROLE_SPECS)
      .filter(([role]) => role !== "arrayGrowth")
      .map(([role, spec]) => [role, uniqueRole(module, context.data, table, spec)])) as Record<
        Exclude<keyof typeof RECORD_ROLE_SPECS, "arrayGrowth">, DecodedFunction | null
      >;
    const constructor = tableRoles.recordConstructor;
    const arrayGrowthMatches = decoded.filter((fn) => {
      const body = module.bodies[fn.functionIndex - module.functionImportCount];
      return body?.byteLength === RECORD_ROLE_SPECS.arrayGrowth[0]
        && friendSemanticBodyShape(module, context.data, fn) === RECORD_ROLE_SPECS.arrayGrowth[1]
        && constructor?.calls.get(fn.functionIndex) === 1;
    });
    const recordRoles: Record<keyof typeof RECORD_ROLE_SPECS, DecodedFunction | null> = {
      ...tableRoles,
      arrayGrowth: arrayGrowthMatches.length === 1 ? arrayGrowthMatches[0]! : null,
    };
    const nameCopy = nameCopies.length === 1 ? nameCopies[0]! : null;
    if (!nameCopy || Object.values(recordRoles).some((fn) => fn === null)) {
      return unavailable("complete-friend-record-roles-not-found");
    }
    const completeConstructor = recordRoles.recordConstructor!;
    if (!signatureMatches(module, recordRoles.arrayGrowth!.functionIndex, ["i32", "i32", "i32"], [])
      || !signatureMatches(module, recordRoles.recordRemoval!.functionIndex, ["i32", "i32"], [])
      || !signatureMatches(module, completeConstructor.functionIndex,
        ["i32", "i32", "i32", "i32", "i32", "i32"], ["i32"])
      || ![recordRoles.categoryWriter, recordRoles.characterWriter, recordRoles.aliasWriter,
        recordRoles.uuidWriter].every((fn) =>
        signatureMatches(module, fn!.functionIndex, ["i32", "i32", "i32"], []))
      || completeConstructor.calls.get(nameCopy.functionIndex) !== 2
      || completeConstructor.calls.get(recordRoles.arrayGrowth!.functionIndex) !== 1
      || recordRoles.aliasWriter!.calls.get(nameCopy.functionIndex) !== 1
      || recordRoles.characterWriter!.calls.get(nameCopy.functionIndex) !== 1
      || !hasConstant(completeConstructor, 172) || !hasConstant(recordRoles.recordRemoval!, 172)
      || !hasConstant(recordRoles.aliasWriter!, 24)
      || !hasConstant(recordRoles.characterWriter!, 64)
      || !hasConstant(recordRoles.uuidWriter!, 8)
      || !completeConstructor.memorySites.some((site) => site.opcode === 0x36 && site.value === 104)) {
      return unavailable("friend-record-role-relationships-changed");
    }
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
          recordLayout: {
            capacityOffset: 4, recordBytes: 172, categoryOffset: 0,
            statusOffset: 4,
            uuidOffset: 8, aliasOffset: 24, characterOffset: 64,
            slotOffset: 104,
            mapOffset: 108,
          },
          recordRoles: {
            ...Object.fromEntries(Object.entries(recordRoles).map(([role, value]) =>
              [role, value!.functionIndex])) as Record<keyof typeof RECORD_ROLE_SPECS, number>,
            nameCopy: nameCopy.functionIndex,
          },
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
        "friend-service-initialization-and-disconnect",
        "account-session-invalidation",
        "reconnect-location-refresh",
      ],
    };
  } catch {
    return unavailable("bounded-analysis-refused");
  }
}
