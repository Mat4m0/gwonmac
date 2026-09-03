/**
 * Locates the complete friend-session notification graph without granting runtime authority.
 * It refuses missing roles, changed call relationships, and incomplete connection-store coverage.
 */
import { createHash } from "node:crypto";
import type { DecodedFunction, ModuleShape } from "./enhancement-evidence-types.js";
import { inspectFriendTable } from "./friend-table-evidence.js";
import { friendSemanticBodyShape } from "./friend-semantic-shape.js";
import { signatureMatches, wasmEvidence } from "./wasm-evidence.js";
import type { WasmDataEvidence } from "./wasm-data-evidence.js";

const ROLE_SPECS = Object.freeze({
  queueAppend: [644, ["i32", "i32", "i32", "i32", "i32", "i32"], ["i32"], "87376639db6c8e1fd2e72a7489ca737d83086d673f03930eed09d062bde70994"],
  queueFacade: [179, ["i32", "i32", "i32", "i32", "i32"], ["i32"], "13b9c7743346ddc37f8cdd42b58c2914e6596e36139f12584a3670db116b73f5"],
  friendCallback: [872, ["i32", "i32"], [], "6660fdb5b02f1dc6c3a235b6be081bb52f2e148a60ddedb377cdd88153d0a4e2"],
  clear: [18, ["i32"], [], "d94f5f3480655bff618e0a910472d906ab7e9ec2264a85d2e8a469c896113a6a"],
  teardown: [47, [], [], "01ade3d374bc0a833931e9327eeca3b2582529f44c62755b52fc3ca9444a1d03"],
  requestPump: [566, ["i32"], [], "9102b2ab141f8c21c4e1ff39ad511ea5d785f4573dfe477f20ddb97de3bbce10"],
  requestSent: [308, ["i32"], [], "333442280da68345df2bc5f4c05f8a7f1294fe2a7b9b1ca8b4d5cdd5159777ee"],
  requestCompleted: [135, ["i32", "i32"], ["i32"], "7e80d653d1077f72f868789973010da5b011c2728c6d43ad9554e53cd11fd720"],
  rosterEntry: [213, ["i32", "i32", "i32", "i32"], [], "47a667d21f1c472ebb462d6253440b7efccd3f9257425689f6635c6008708d19"],
  loginCompleted: [842, ["i32"], [], "03eef78a6173dfb5dcb82b2323ad30c02d723d807adcdb49404cc6148ce3ebc2"],
  loginStart: [386, ["i32", "i32", "i32"], [], "e5782bc6a7338a396f38adf1aaa3fec1a15d4520d0534a17c56312d2df0b5f43"],
  connectionEvent: [1_084, ["i32", "i32", "i32", "i32", "i32"], ["i32"], "061fd037de39a6c992055e17655da1ace48cd6ba27973c2345ad05d1b6157fe3"],
  disconnect: [70, ["i32"], [], "f077464bfc81ca12102aa9d6069b8f984e604a34cec19ad945659b6b9750aec7"],
  logout: [206, ["i32"], [], "951991fe548dc3f2a0929f8e044fb72986e79c33230ff37faa50a022e1664643"],
  connected: [342, ["i32", "i32"], ["i32"], "f2fa4fca9b49b2646a53a99b66468a01bad47b42827f9c99730451eea87efb6a"],
} as const);

type FriendLifecycleRole = keyof typeof ROLE_SPECS;

export type FriendLifecycleCandidate = Readonly<{
  roles: Readonly<Record<FriendLifecycleRole, number>>;
  connectionPointer: number;
  connectionStoreOffsets: Readonly<{
    connectionEvent: readonly number[];
    disconnect: readonly number[];
    connected: readonly number[];
  }>;
}>;

export type FriendLifecycleEvidence = Readonly<{
  inputSha256: string;
  runtimeAuthority: false;
  status: "candidate" | "unavailable";
  candidate: FriendLifecycleCandidate | null;
  unresolved: readonly string[];
}>;

function hasConstant(fn: DecodedFunction, value: number): boolean {
  return fn.constantSites.some((site) => site.value === value);
}

function uniqueRole(
  module: ModuleShape,
  data: WasmDataEvidence,
  functions: readonly DecodedFunction[],
  role: FriendLifecycleRole,
): DecodedFunction | null {
  const [bytes, params, results, fingerprint] = ROLE_SPECS[role];
  const matches = functions.filter((fn) =>
    module.bodies[fn.functionIndex - module.functionImportCount]?.byteLength === bytes
    && signatureMatches(module, fn.functionIndex, params, results)
    && friendSemanticBodyShape(module, data, fn) === fingerprint
  );
  return matches.length === 1 ? matches[0]! : null;
}

function storeWidth(opcode: number): number | null {
  return [4, 8, 4, 8, 1, 2, 1, 2, 4][opcode - 0x36] ?? null;
}

export function inspectFriendLifecycle(input: Uint8Array): FriendLifecycleEvidence {
  const inputSha256 = createHash("sha256").update(input).digest("hex");
  const unavailable = (reason: string): FriendLifecycleEvidence => ({
    inputSha256, runtimeAuthority: false, status: "unavailable",
    candidate: null, unresolved: [reason],
  });
  const evidence = wasmEvidence(input);
  if (!evidence) return unavailable("invalid-or-unsupported-module");
  try {
    const table = inspectFriendTable(input);
    if (table.status !== "candidate") return unavailable("friend-record-proof-unavailable");
    const module = evidence.moduleView();
    const functions = evidence.decodeFunctions([]);
    const found = Object.fromEntries((Object.keys(ROLE_SPECS) as FriendLifecycleRole[])
      .map((role) => [role, uniqueRole(module, evidence.data, functions, role)])) as Record<
        FriendLifecycleRole, DecodedFunction | null
      >;
    if (Object.values(found).some((fn) => fn === null)) {
      return unavailable("complete-friend-lifecycle-roles-not-found");
    }
    const roles = found as Record<FriendLifecycleRole, DecodedFunction>;
    const records = table.candidates[0]!.recordRoles;
    const callbackCalls = [
      records.recordRemoval, records.recordConstructor, records.categoryWriter,
      records.characterWriter, records.aliasWriter, records.uuidWriter,
      ...table.candidates[0]!.scalarWriters.map((writer) => writer.functionIndex),
    ];
    if (roles.queueFacade.calls.get(roles.queueAppend.functionIndex) !== 1
      || roles.loginCompleted.calls.get(roles.queueFacade.functionIndex) !== 1
      || roles.loginStart.calls.get(roles.queueFacade.functionIndex) !== 1
      || roles.rosterEntry.calls.get(roles.queueFacade.functionIndex) !== 1
      || roles.requestPump.calls.get(roles.queueFacade.functionIndex) !== 1
      || roles.teardown.calls.get(roles.clear.functionIndex) !== 1
      || callbackCalls.some((target) => !roles.friendCallback.calls.has(target))
      || !hasConstant(roles.loginCompleted, 14) || !hasConstant(roles.loginCompleted, 352)
      || !hasConstant(roles.loginStart, 14) || !hasConstant(roles.loginStart, 352)
      || !hasConstant(roles.rosterEntry, 38) || !hasConstant(roles.rosterEntry, 104)
      || !hasConstant(roles.requestPump, 28)
      || !roles.requestSent.memorySites.some((site) => site.opcode === 0x28 && site.value === 32)
      || !roles.requestCompleted.memorySites.some((site) => site.opcode === 0x28 && site.value === 32)) {
      return unavailable("friend-lifecycle-relationships-changed");
    }

    const connectionWriters = ["connectionEvent", "disconnect", "connected"] as const;
    const stores = {
      connectionEvent: roles.connectionEvent.memorySites.filter((site) => storeWidth(site.opcode) !== null),
      disconnect: roles.disconnect.memorySites.filter((site) => storeWidth(site.opcode) !== null),
      connected: roles.connected.memorySites.filter((site) => storeWidth(site.opcode) !== null),
    };
    const addresses = stores.disconnect.map((site) => site.value).filter((address) =>
      address >= evidence.data.zeroInitializedBase
      && stores.connected.some((site) => site.value === address)
      && stores.connectionEvent.filter((site) => site.value === address).length === 3
    );
    if (addresses.length !== 1) return unavailable("active-connection-pointer-not-unique");
    const connectionPointer = addresses[0]!;
    const overlapping = functions.flatMap((fn) => fn.memorySites.flatMap((site) => {
      const width = storeWidth(site.opcode);
      return width !== null && site.value < connectionPointer + 4 && site.value + width > connectionPointer
        ? [{ functionIndex: fn.functionIndex, offset: site.offset }]
        : [];
    }));
    const expectedFunctions = new Set(connectionWriters.map((role) => roles[role].functionIndex));
    if (overlapping.length !== 5
      || overlapping.some(({ functionIndex }) => !expectedFunctions.has(functionIndex))) {
      return unavailable("active-connection-store-coverage-changed");
    }
    const roleIndices = Object.fromEntries(Object.entries(roles)
      .map(([role, fn]) => [role, fn.functionIndex])) as Record<FriendLifecycleRole, number>;
    return {
      inputSha256, runtimeAuthority: false, status: "candidate",
      candidate: {
        roles: roleIndices,
        connectionPointer,
        connectionStoreOffsets: {
          connectionEvent: stores.connectionEvent
            .filter((site) => site.value === connectionPointer).map((site) => site.offset),
          disconnect: stores.disconnect
            .filter((site) => site.value === connectionPointer).map((site) => site.offset),
          connected: stores.connected
            .filter((site) => site.value === connectionPointer).map((site) => site.offset),
        },
      },
      unresolved: ["production-friend-lifecycle-transform", "live-session-observation"],
    };
  } catch {
    return unavailable("bounded-analysis-refused");
  }
}
