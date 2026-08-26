/** Feature-owned semantic proof for the client's complete native mouse route. */
import { createHash } from "node:crypto";
import type {
  DecodedFunction,
  InstructionOperandSite,
  ModuleShape,
} from "./enhancement-evidence-types.js";
import {
  functionBody,
  signatureMatches,
  wasmEvidence,
  type WasmEvidence,
} from "./wasm-evidence.js";
import {
  relocationAwareFingerprint,
  type RelocationSpan,
} from "./semantic-proof.js";

const text = new TextEncoder();
const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

type RouteRole =
  | "callback"
  | "enqueue"
  | "dequeue"
  | "pump"
  | "translator"
  | "binder"
  | "dispatcher"
  | "consumer";

interface RoleSpec {
  readonly bodyLength: number;
  readonly params: readonly string[];
  readonly results: readonly string[];
  readonly fingerprint: string;
}

const ROLE_SPECS: Readonly<Record<RouteRole, RoleSpec>> = Object.freeze({
  callback: { bodyLength: 130, params: ["i32", "i32", "i32"], results: ["i32"], fingerprint: "5f3154cf7b079f5cee39d15573cddf2909a2fa584002d9ee2246c7dba4d0d8ca" },
  enqueue: { bodyLength: 400, params: ["i32"], results: [], fingerprint: "10b957d1d7df8714fc8c3056a411c2272c016ce05e193656f33178d90d0b75b6" },
  dequeue: { bodyLength: 252, params: ["i32"], results: ["i32"], fingerprint: "3bd3f3e538169fe6cd1a4992234cc374d9fae74003a58a89187cb94950353705" },
  pump: { bodyLength: 418, params: ["i32"], results: [], fingerprint: "4e9aed54e81c18176f0ac24e62beea80f46f85c1d80f0572758de02231f7a113" },
  translator: { bodyLength: 4_340, params: ["i32", "i32"], results: [], fingerprint: "aa0e634a824f0ff1e999991d8bf16f0faff111bb76442e6d585720fbe1dd4559" },
  binder: { bodyLength: 1_211, params: ["i32"], results: [], fingerprint: "f6cc7260c311b838ea50342a6751a2269f038292c6425260a446b7593169089a" },
  dispatcher: { bodyLength: 246, params: ["i32", "i32"], results: [], fingerprint: "19ac2957d4e308345fbc6ae7d965154ff7fcab9e6b07d917619dd24e3d0d750b" },
  consumer: { bodyLength: 1_051, params: ["i32", "i32", "i32"], results: [], fingerprint: "b420eabcffdbf8a6e580ecaaa81e2b299a36f0a4330f50363de632612939ba52" },
});

const MESSAGE_REGISTRATIONS = Object.freeze([
  1, 2, 3, 5, 10, 17, 16, 18, 19, 20, 21, 22, 23, 24, 26, 27, 30,
  31, 32, 29, 33, 34, 36, 37, 38, 40, 11, 12, 13, 14, 15, 43, 44, 45, 46,
]);

/** The exact roles selected by the complete route proof. */
export interface NativeDoubleClickRoute {
  readonly semanticSha256: string;
  readonly callbackFunctionIndex: number;
  readonly callbackTableSlot: number;
  readonly flagStoreOffset: number;
  readonly flagStoreFrameOffset: number;
  readonly enqueueFunctionIndex: number;
  readonly dequeueFunctionIndex: number;
  readonly pumpFunctionIndex: number;
  readonly translatorFunctionIndex: number;
  readonly binderFunctionIndex: number;
  readonly dispatcherFunctionIndex: number;
  readonly consumerFunctionIndex: number;
}

export const NATIVE_DOUBLE_CLICK_ROUTE_SHA256 = sha256(text.encode(JSON.stringify({
  roles: ROLE_SPECS,
  messageRegistrations: MESSAGE_REGISTRATIONS,
  routeContract: "record16-message4-mask1-consumer1-v1",
})));

interface ProofView {
  readonly evidence: WasmEvidence;
  readonly module: ModuleShape;
  readonly decoded: ReadonlyMap<number, DecodedFunction>;
}

function signatureKey(module: ModuleShape, functionIndex: number): string {
  const typeIndex = module.functionTypeIndices[functionIndex];
  const signature = typeIndex === undefined ? undefined : module.types[typeIndex];
  return signature
    ? `${signature.params.join(",")}=>${signature.results.join(",")}`
    : "missing";
}

function printableCString(value: string | null): value is string {
  return value !== null
    && value.length >= 3
    && [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13
        || (code >= 32 && code <= 126);
    });
}

function immutableWitness(
  evidence: WasmEvidence,
  address: number,
): string | null {
  const value = evidence.data.readCString(address);
  const bytes = printableCString(value)
    ? text.encode(`${value}\0`)
    : evidence.data.readBytes(address, 32);
  if (!bytes) return null;
  const occurrences = evidence.data.addresses(bytes).length;
  if (occurrences < 1) return null;
  return `${sha256(bytes)}:${occurrences}`;
}

interface RegistrationEvidence {
  readonly target: number;
  readonly message30TableSlot: number;
  readonly spans: readonly RelocationSpan[];
}

function binderRegistrations(decoded: DecodedFunction): RegistrationEvidence | null {
  const repeated = [...decoded.callSites].filter(([, sites]) =>
    sites.length === MESSAGE_REGISTRATIONS.length
  );
  if (repeated.length !== 1) return null;
  const [target, calls] = repeated[0]!;
  const spans: RelocationSpan[] = [];
  let baseSlot: number | null = null;
  let message30TableSlot: number | null = null;
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    const constants = decoded.constantSites
      .filter((site) => site.offset < call.offset)
      .slice(-3);
    const [message, slot, context] = constants;
    if (
      !message
      || message.value !== MESSAGE_REGISTRATIONS[index]
      || !slot
      || context?.value !== 0
    ) return null;
    baseSlot ??= slot.value;
    if (slot.value !== baseSlot + index) return null;
    if (message.value === 30) message30TableSlot = slot.value;
    spans.push({
      start: slot.operandStart,
      end: slot.operandEnd,
      addressClass: "function-index",
      role: `message-${message.value}-table-slot`,
    });
  }
  return message30TableSlot === null
    ? null
    : { target, message30TableSlot, spans: Object.freeze(spans) };
}

function semanticFingerprint(
  view: ProofView,
  functionIndex: number,
  role: RouteRole,
): string | null {
  const body = functionBody(view.module, functionIndex);
  const decoded = view.decoded.get(functionIndex);
  if (!decoded) return null;
  const spans: RelocationSpan[] = [];

  const targetRoles = new Map<number, number>();
  const calls = [...decoded.callSites]
    .flatMap(([target, sites]) => sites.map((site) => ({ target, site })))
    .sort((left, right) => left.site.offset - right.site.offset);
  for (const { target, site } of calls) {
    if (!targetRoles.has(target)) targetRoles.set(target, targetRoles.size);
    spans.push({
      start: site.offset + 1,
      end: site.operandEnd,
      addressClass: "function-index",
      role: `callee-${targetRoles.get(target)}:${signatureKey(view.module, target)}`,
    });
  }

  const operandSites = [...decoded.constantSites, ...decoded.memorySites];
  const mutableSites = operandSites
    .filter((site) =>
      site.value >= view.evidence.data.zeroInitializedBase
      && site.value < view.evidence.data.initialMemoryBytes
    )
    .sort((left, right) => left.offset - right.offset);
  const mutableRoles = new Map<number, number>();
  for (const site of mutableSites) {
    if (!mutableRoles.has(site.value)) {
      mutableRoles.set(site.value, mutableRoles.size);
    }
    spans.push({
      start: site.operandStart,
      end: site.operandEnd,
      addressClass: "mutable-static",
      role: `state-${mutableRoles.get(site.value)}`,
    });
  }

  for (const site of operandSites) {
    if (!view.evidence.data.contains(site.value)) continue;
    const witness = immutableWitness(view.evidence, site.value);
    if (!witness) return null;
    spans.push({
      start: site.operandStart,
      end: site.operandEnd,
      addressClass: "immutable-data",
      role: witness,
    });
  }

  if (role === "binder") {
    const registrations = binderRegistrations(decoded);
    if (!registrations) return null;
    spans.push(...registrations.spans);
  }
  return relocationAwareFingerprint(body, spans);
}

function uniqueRole(view: ProofView, role: RouteRole): number | null {
  const spec = ROLE_SPECS[role];
  const matches: number[] = [];
  for (
    let functionIndex = view.module.functionImportCount;
    functionIndex < view.module.functionTypeIndices.length;
    functionIndex += 1
  ) {
    const body = view.module.bodies[functionIndex - view.module.functionImportCount]!;
    if (
      body.byteLength === spec.bodyLength
      && signatureMatches(view.module, functionIndex, spec.params, spec.results)
      && semanticFingerprint(view, functionIndex, role) === spec.fingerprint
    ) matches.push(functionIndex);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

function exactSites(
  sites: readonly InstructionOperandSite[],
  expected: readonly (readonly [number, number, number])[],
): boolean {
  return expected.every(([opcode, offset, value]) =>
    sites.some((site) =>
      site.opcode === opcode && site.offset === offset && site.value === value
    )
  );
}

function callsAt(
  decoded: DecodedFunction,
  target: number,
  offsets: readonly number[],
): boolean {
  const sites = decoded.callSites.get(target) ?? [];
  return sites.length === offsets.length
    && sites.every((site, index) => site.offset === offsets[index]);
}

function callTargetAt(decoded: DecodedFunction, offset: number): number | null {
  const match = [...decoded.callSites].find(([, sites]) =>
    sites.some((site) => site.offset === offset)
  );
  return match?.[0] ?? null;
}

function proveRoute(view: ProofView): NativeDoubleClickRoute | null {
  const roles = Object.fromEntries(
    (Object.keys(ROLE_SPECS) as RouteRole[]).map((role) => [role, uniqueRole(view, role)]),
  ) as Record<RouteRole, number | null>;
  if (Object.values(roles).some((value) => value === null)) return null;
  const located = roles as Record<RouteRole, number>;
  const callback = view.decoded.get(located.callback)!;
  const enqueue = view.decoded.get(located.enqueue)!;
  const dequeue = view.decoded.get(located.dequeue)!;
  const pump = view.decoded.get(located.pump)!;
  const translator = view.decoded.get(located.translator)!;
  const binder = view.decoded.get(located.binder)!;
  const dispatcher = view.decoded.get(located.dispatcher)!;
  const consumer = view.decoded.get(located.consumer)!;

  const callbackSlots = view.evidence.tableRelations.get(located.callback) ?? [];
  if (
    callbackSlots.length !== 1
    || !callsAt(callback, located.enqueue, [106])
    || !exactSites(callback.constantSites, [[0x41, 41, 8], [0x41, 44, 24], [0x41, 54, 18], [0x41, 103, 8]])
    || !exactSites(callback.memorySites, [[0x36, 56, 8], [0x36, 72, 12], [0x36, 88, 16], [0x36, 98, 20]])
  ) return null;
  const callbackBody = functionBody(view.module, located.callback);
  if (
    callbackBody[101] !== 0x20 || callbackBody[102] !== 0x03
    || callbackBody[103] !== 0x41 || callbackBody[105] !== 0x6a
  ) return null;

  if (
    !exactSites(enqueue.memorySites, [
      [0x29, 28, 16], [0x37, 31, 24], [0x29, 38, 8],
      [0x37, 41, 16], [0x29, 48, 0], [0x37, 51, 8],
    ])
    || !exactSites(enqueue.constantSites, [[0x41, 355, 24]])
    || !exactSites(dequeue.constantSites, [[0x41, 112, 24], [0x41, 131, 24]])
  ) return null;
  const queueCopy = callTargetAt(enqueue, 357);
  if (queueCopy === null || callTargetAt(dequeue, 114) !== queueCopy) return null;

  if (
    !callsAt(pump, located.dequeue, [76, 105])
    || !callsAt(pump, located.translator, [94])
  ) return null;
  const pumpOrder = [76, 94, 105].map((offset) => callTargetAt(pump, offset));
  if (pumpOrder.join(",") !== `${located.dequeue},${located.translator},${located.dequeue}`) return null;

  if (
    !exactSites(translator.memorySites, [[0x28, 2122, 16], [0x36, 2125, 12]])
    || !exactSites(translator.constantSites, [[0x41, 2165, 30], [0x41, 2167, 24], [0x41, 2171, 8]])
    || callTargetAt(translator, 2174) === null
  ) return null;

  const registrations = binderRegistrations(binder);
  if (!registrations) return null;
  const dispatcherSlots = view.evidence.tableRelations.get(located.dispatcher) ?? [];
  if (
    dispatcherSlots.length !== 1
    || dispatcherSlots[0] !== registrations.message30TableSlot
    || !callsAt(dispatcher, located.consumer, [238])
    || !exactSites(dispatcher.memorySites, [[0x28, 227, 0], [0x28, 232, 4]])
    || !exactSites(dispatcher.constantSites, [[0x41, 235, 1]])
    || functionBody(view.module, located.dispatcher)[237] !== 0x71
  ) return null;

  const consumerBody = functionBody(view.module, located.consumer);
  if (
    !exactSites(consumer.memorySites, [[0x28, 193, 12], [0x36, 199, 12]])
    || !exactSites(consumer.constantSites, [[0x41, 196, 1]])
    || consumerBody[184] !== 0x20 || consumerBody[185] !== 0x02
    || consumerBody[186] !== 0x45 || consumerBody[187] !== 0x0d
    || consumerBody[198] !== 0x72
  ) return null;

  return Object.freeze({
    semanticSha256: NATIVE_DOUBLE_CLICK_ROUTE_SHA256,
    callbackFunctionIndex: located.callback,
    callbackTableSlot: callbackSlots[0]!,
    flagStoreOffset: 101,
    flagStoreFrameOffset: 24,
    enqueueFunctionIndex: located.enqueue,
    dequeueFunctionIndex: located.dequeue,
    pumpFunctionIndex: located.pump,
    translatorFunctionIndex: located.translator,
    binderFunctionIndex: located.binder,
    dispatcherFunctionIndex: located.dispatcher,
    consumerFunctionIndex: located.consumer,
  });
}

/** Locate the route only when every producer, copy, dispatch, mask, and consumer edge proves. */
export function locateNativeDoubleClickRoute(input: Uint8Array): NativeDoubleClickRoute | null {
  try {
    const evidence = wasmEvidence(input);
    if (!evidence) return null;
    const module = evidence.moduleView();
    const decoded = new Map(
      evidence.decodeFunctions([]).map((entry) => [entry.functionIndex, entry]),
    );
    return proveRoute({ evidence, module, decoded });
  } catch {
    return null;
  }
}
