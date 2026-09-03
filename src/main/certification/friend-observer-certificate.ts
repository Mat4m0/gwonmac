/**
 * Produces and validates the closed friend-observer certificate used across verifier IPC.
 * Production must re-run the same structural inspectors before rewriting the certified bytes.
 */
import { createHash } from "node:crypto";
import { isDigest } from "../../shared/digest.js";
import {
  FRIEND_LIFECYCLE_SEMANTIC_SHA256,
  inspectFriendLifecycle,
  type FriendLifecycleCandidate,
} from "./friend-lifecycle-evidence.js";
import {
  FRIEND_RECORD_SEMANTIC_SHA256,
  inspectFriendTable,
  type FriendTableCandidate,
} from "./friend-table-evidence.js";
import { SEMANTIC_VERIFIER_ABI } from "./semantic-proof.js";

const RECORD_ROLE_KEYS = Object.freeze([
  "arrayGrowth", "recordRemoval", "recordConstructor", "categoryWriter",
  "characterWriter", "aliasWriter", "uuidWriter", "nameCopy",
] as const);
const LIFECYCLE_ROLE_KEYS = Object.freeze([
  "eventDispatcher", "callbackListInsert", "eventRegistration",
  "rosterRegistration", "queueDispatcher", "queueDrain",
  "queueAppend", "queueFacade", "rosterCallback", "clear", "teardown",
  "requestPump", "requestSent", "requestCompleted", "rosterEntry",
  "loginCompleted", "loginStart", "connectionEvent", "disconnect", "logout", "connected",
] as const);

export const FRIEND_OBSERVER_SEMANTIC_SHA256 = createHash("sha256").update(JSON.stringify({
  record: FRIEND_RECORD_SEMANTIC_SHA256,
  lifecycle: FRIEND_LIFECYCLE_SEMANTIC_SHA256,
  contract: "isolated-input-bound-friend-observer-v1",
})).digest("hex");

export type FriendObserverCertificate = Readonly<{
  inputSha256: string;
  verifierAbi: typeof SEMANTIC_VERIFIER_ABI;
  semanticSha256: string;
  record: FriendTableCandidate;
  lifecycle: FriendLifecycleCandidate;
}>;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function index(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function indexRecord(value: unknown, keys: readonly string[]): value is Record<string, number> {
  return !!value && typeof value === "object" && exactKeys(value, keys)
    && keys.every((key) => index((value as Record<string, unknown>)[key]));
}

export function isFriendObserverCertificate(
  value: unknown,
  inputSha256: string,
): value is FriendObserverCertificate {
  if (!value || typeof value !== "object" || !isDigest(inputSha256)) return false;
  const certificate = value as Partial<FriendObserverCertificate>;
  if (!exactKeys(value, ["inputSha256", "verifierAbi", "semanticSha256", "record", "lifecycle"])
    || certificate.inputSha256 !== inputSha256
    || certificate.verifierAbi !== SEMANTIC_VERIFIER_ABI
    || certificate.semanticSha256 !== FRIEND_OBSERVER_SEMANTIC_SHA256
    || !certificate.record || typeof certificate.record !== "object"
    || !certificate.lifecycle || typeof certificate.lifecycle !== "object") return false;
  const record = certificate.record;
  const lifecycle = certificate.lifecycle;
  if (!exactKeys(record, [
    "root", "accessor", "rootAccessor", "arrayOffset", "countOffset",
    "scalarWriters", "uiConsumers", "recordLayout", "recordRoles",
  ])
    || !index(record.root) || !index(record.accessor) || !index(record.rootAccessor)
    || record.arrayOffset !== 0 || record.countOffset !== 8
    || !Array.isArray(record.scalarWriters) || record.scalarWriters.length !== 2
    || !record.scalarWriters.every((writer) => exactKeys(writer, ["functionIndex", "offset"])
      && index(writer.functionIndex) && [4, 108].includes(writer.offset))
    || new Set(record.scalarWriters.map(({ offset }) => offset)).size !== 2
    || !Array.isArray(record.uiConsumers) || record.uiConsumers.length < 1
    || !record.uiConsumers.every(index)
    || !exactKeys(record.recordLayout, [
      "capacityOffset", "recordBytes", "categoryOffset", "statusOffset", "uuidOffset",
      "aliasOffset", "characterOffset", "slotOffset", "mapOffset",
    ])
    || JSON.stringify(record.recordLayout) !== JSON.stringify({
      capacityOffset: 4, recordBytes: 172, categoryOffset: 0, statusOffset: 4,
      uuidOffset: 8, aliasOffset: 24, characterOffset: 64, slotOffset: 104, mapOffset: 108,
    })
    || !indexRecord(record.recordRoles, RECORD_ROLE_KEYS)
    || new Set(Object.values(record.recordRoles)).size !== RECORD_ROLE_KEYS.length) return false;
  if (!exactKeys(lifecycle, [
    "roles", "rosterCallbackTableSlot", "eventContextPointer",
    "connectionPointer", "connectionStoreOffsets",
  ])
    || !indexRecord(lifecycle.roles, LIFECYCLE_ROLE_KEYS)
    || new Set(Object.values(lifecycle.roles)).size !== LIFECYCLE_ROLE_KEYS.length
    || !index(lifecycle.rosterCallbackTableSlot)
    || !index(lifecycle.eventContextPointer)
    || !index(lifecycle.connectionPointer)
    || !exactKeys(lifecycle.connectionStoreOffsets, ["connectionEvent", "disconnect", "connected"])
    || !Array.isArray(lifecycle.connectionStoreOffsets.connectionEvent)
    || lifecycle.connectionStoreOffsets.connectionEvent.length !== 3
    || !lifecycle.connectionStoreOffsets.connectionEvent.every(index)
    || !Array.isArray(lifecycle.connectionStoreOffsets.disconnect)
    || lifecycle.connectionStoreOffsets.disconnect.length !== 1
    || !lifecycle.connectionStoreOffsets.disconnect.every(index)
    || !Array.isArray(lifecycle.connectionStoreOffsets.connected)
    || lifecycle.connectionStoreOffsets.connected.length !== 1
    || !lifecycle.connectionStoreOffsets.connected.every(index)) return false;
  return true;
}

export function deriveFriendObserverCertificate(input: Uint8Array): FriendObserverCertificate | null {
  const record = inspectFriendTable(input);
  const lifecycle = inspectFriendLifecycle(input);
  if (record.status !== "candidate" || lifecycle.status !== "candidate" || !lifecycle.candidate) {
    return null;
  }
  const certificate: FriendObserverCertificate = Object.freeze({
    inputSha256: createHash("sha256").update(input).digest("hex"),
    verifierAbi: SEMANTIC_VERIFIER_ABI,
    semanticSha256: FRIEND_OBSERVER_SEMANTIC_SHA256,
    record: record.candidates[0]!,
    lifecycle: lifecycle.candidate,
  });
  return isFriendObserverCertificate(certificate, certificate.inputSha256) ? certificate : null;
}
