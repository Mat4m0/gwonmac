/**
 * Adds the closed friend-session notifications to a certified Enhancement module.
 * The game still owns every operation; the companion receives bounded lifecycle facts only.
 */
import { createHash } from "node:crypto";
import { isDigest } from "../../shared/digest.js";
import {
  concat,
  countFunctionImports,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  parseExports,
  parseCode,
  parseIndexVector,
  parseTypes,
  sectionById,
  sleb,
  splitSections,
  uleb,
  WASM_HEADER,
  type Section,
} from "../core/wasm-binary.js";
import {
  deriveFriendObserverCertificate,
  isFriendObserverCertificate,
  type FriendObserverCertificate,
} from "./friend-observer-certificate.js";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export { FRIEND_OBSERVER_TRANSFORM_ABI, FRIEND_OBSERVER_MANIFEST_SECTION } from
  "../../shared/friend-observer-contract.js";
import { FRIEND_OBSERVER_TRANSFORM_ABI, FRIEND_OBSERVER_MANIFEST_SECTION } from
  "../../shared/friend-observer-contract.js";

const ENHANCEMENT_HOOK_EXPORT = "enhancement_hook_slot";
const DISPATCH_PARAM_COUNT = 6;
const DISPATCH_KIND_FRIEND_LIFECYCLE = 4;
const LOGIN_EVENT = 14;
const USER_EVENT_CATEGORY = 36;

export const FRIEND_LIFECYCLE_NOTIFICATIONS = Object.freeze({
  invalidate: 1,
  requestSent: 2,
  completionStarted: 3,
  completionQueued: 4,
  completionFinished: 5,
  completionProcessed: 6,
});

export type FriendObserverBuild = Readonly<{
  transformAbi: typeof FRIEND_OBSERVER_TRANSFORM_ABI;
  certificate: FriendObserverCertificate;
  outputSha256: string;
}>;

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function fail(message: string): never {
  throw new Error(`friend observer transform: ${message}`);
}

function encodeName(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(uleb(bytes.byteLength), bytes);
}

const localGet = (index: number): Uint8Array => concat(Uint8Array.of(0x20), uleb(index));
const globalGet = (index: number): Uint8Array => concat(Uint8Array.of(0x23), uleb(index));
const call = (index: number): Uint8Array => concat(Uint8Array.of(0x10), uleb(index));
const constant = (value: number): Uint8Array => concat(Uint8Array.of(0x41), sleb(value));
const load32 = (offset: number): Uint8Array => concat(Uint8Array.of(0x28, 0x02), uleb(offset));

function dispatch(
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
  notification: number,
  args: readonly Uint8Array[] = [],
): Uint8Array {
  if (args.length > 4) fail("friend notification has too many arguments");
  return concat(
    globalGet(hookGlobalIndex),
    Uint8Array.of(0x04, 0x40),
    constant(DISPATCH_KIND_FRIEND_LIFECYCLE),
    constant(notification),
    ...args,
    ...Array.from({ length: 4 - args.length }, () => constant(0)),
    globalGet(hookGlobalIndex),
    constant(1),
    Uint8Array.of(0x6b, 0x11),
    uleb(dispatchTypeIndex),
    uleb(0),
    Uint8Array.of(0x0b),
  );
}

function originalCall(paramCount: number, originalIndex: number): Uint8Array {
  return concat(
    ...Array.from({ length: paramCount }, (_, index) => localGet(index)),
    call(originalIndex),
  );
}

function invalidatingWrapper(
  paramCount: number,
  originalIndex: number,
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
): Uint8Array {
  return concat(
    uleb(0),
    dispatch(
      hookGlobalIndex,
      dispatchTypeIndex,
      FRIEND_LIFECYCLE_NOTIFICATIONS.invalidate,
    ),
    originalCall(paramCount, originalIndex),
    Uint8Array.of(0x0b),
  );
}

function requestSentWrapper(
  originalIndex: number,
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
): Uint8Array {
  return concat(
    uleb(0),
    originalCall(1, originalIndex),
    dispatch(
      hookGlobalIndex,
      dispatchTypeIndex,
      FRIEND_LIFECYCLE_NOTIFICATIONS.requestSent,
      [
        concat(localGet(0), load32(32)),
        concat(localGet(0), load32(28)),
      ],
    ),
    Uint8Array.of(0x0b),
  );
}

function completionQueuedWrapper(
  originalIndex: number,
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
  eventContextPointer: number,
): Uint8Array {
  // Observe the accepting append itself: the queue facade may report success
  // while skipping it, and scheduling happens only after this function returns.
  return concat(
    // One i32 local preserves the native queue result while the observer runs.
    Uint8Array.of(0x01, 0x01, 0x7f),
    originalCall(6, originalIndex),
    Uint8Array.of(0x21), uleb(6),
    globalGet(hookGlobalIndex), Uint8Array.of(0x04, 0x40),
    localGet(2), constant(LOGIN_EVENT), Uint8Array.of(0x46),
    localGet(0), constant(0), load32(eventContextPointer), constant(592),
    Uint8Array.of(0x6a, 0x46, 0x71),
    localGet(6), Uint8Array.of(0x71, 0x04, 0x40),
    dispatch(
      hookGlobalIndex,
      dispatchTypeIndex,
      FRIEND_LIFECYCLE_NOTIFICATIONS.completionQueued,
    ),
    Uint8Array.of(0x0b, 0x0b),
    localGet(6),
    Uint8Array.of(0x0b),
  );
}

function loginCompletedWrapper(
  originalIndex: number,
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
): Uint8Array {
  // The copied event starts at request +56 and does not carry request identity.
  // Bracket the native callback so the session gate can bind its queue ordinal.
  return concat(
    uleb(0),
    dispatch(
      hookGlobalIndex,
      dispatchTypeIndex,
      FRIEND_LIFECYCLE_NOTIFICATIONS.completionStarted,
      [
        concat(localGet(0), load32(32)),
        concat(localGet(0), load32(28)),
        concat(localGet(0), load32(24), Uint8Array.of(0x45)),
      ],
    ),
    originalCall(1, originalIndex),
    dispatch(
      hookGlobalIndex,
      dispatchTypeIndex,
      FRIEND_LIFECYCLE_NOTIFICATIONS.completionFinished,
    ),
    Uint8Array.of(0x0b),
  );
}

function completionProcessedWrapper(
  originalIndex: number,
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
): Uint8Array {
  // Category 36 delivers a user-event envelope. Its inner ID, not the outer
  // dispatch category, identifies login completion after the roster callback.
  return concat(
    uleb(0),
    originalCall(2, originalIndex),
    globalGet(hookGlobalIndex), Uint8Array.of(0x04, 0x40),
    localGet(0), load32(4), constant(USER_EVENT_CATEGORY), Uint8Array.of(0x46),
    localGet(1), load32(0), constant(LOGIN_EVENT), Uint8Array.of(0x46, 0x71, 0x04, 0x40),
    dispatch(
      hookGlobalIndex,
      dispatchTypeIndex,
      FRIEND_LIFECYCLE_NOTIFICATIONS.completionProcessed,
    ),
    Uint8Array.of(0x0b, 0x0b, 0x0b),
  );
}

function instrumentStores(
  body: Uint8Array,
  offsets: readonly number[],
  hookGlobalIndex: number,
  dispatchTypeIndex: number,
): Uint8Array {
  const unique = [...new Set(offsets)].sort((left, right) => left - right);
  let cursor = 0;
  const parts: Uint8Array[] = [];
  for (const offset of unique) {
    if (offset < cursor || offset >= body.byteLength || body[offset]! < 0x36 || body[offset]! > 0x3e) {
      fail("certified connection store offset changed");
    }
    parts.push(
      body.subarray(cursor, offset),
      dispatch(
        hookGlobalIndex,
        dispatchTypeIndex,
        FRIEND_LIFECYCLE_NOTIFICATIONS.invalidate,
      ),
    );
    cursor = offset;
  }
  parts.push(body.subarray(cursor));
  return concat(...parts);
}

function sameCertificate(
  left: FriendObserverCertificate,
  right: FriendObserverCertificate,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function manifest(certificate: FriendObserverCertificate): Section {
  const value = new TextEncoder().encode(JSON.stringify({
    transformAbi: FRIEND_OBSERVER_TRANSFORM_ABI,
    inputSha256: certificate.inputSha256,
    semanticSha256: certificate.semanticSha256,
    root: certificate.record.root,
  }));
  return { id: 0, body: concat(encodeName(FRIEND_OBSERVER_MANIFEST_SECTION), value) };
}

/** Re-run the proof and derive the exact output identity for one predecessor. */
export function deriveFriendObserverBuild(input: Uint8Array): FriendObserverBuild | null {
  try {
    const certificate = deriveFriendObserverCertificate(input);
    if (!certificate) return null;
    const output = rewriteFriendObserverWasm(input, certificate);
    return Object.freeze({
      transformAbi: FRIEND_OBSERVER_TRANSFORM_ABI,
      certificate,
      outputSha256: sha256(output),
    });
  } catch {
    return null;
  }
}

/** Validate the isolated-process result before production consumes it. */
export function isFriendObserverBuild(
  value: unknown,
  inputSha256: string,
): value is FriendObserverBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<FriendObserverBuild>;
  return Object.keys(value).length === 3
    && build.transformAbi === FRIEND_OBSERVER_TRANSFORM_ABI
    && isFriendObserverCertificate(build.certificate, inputSha256)
    && isDigest(build.outputSha256);
}

/** Apply the observer hooks only to the exact input certified in isolation. */
export function rewriteFriendObserverWasm(
  input: Uint8Array,
  certificate: FriendObserverCertificate,
): Uint8Array {
  const inputSha256 = sha256(input);
  if (!isFriendObserverCertificate(certificate, inputSha256)) {
    fail("certificate does not match the input");
  }
  const derived = deriveFriendObserverCertificate(input);
  if (!derived || !sameCertificate(derived, certificate)) {
    fail("production proof does not reproduce the certificate");
  }

  const sections = splitSections(input);
  const exports = parseExports(sectionById(sections, 7));
  const hookExports = exports.filter((entry) => entry.name === ENHANCEMENT_HOOK_EXPORT);
  if (hookExports.length !== 1 || hookExports[0]!.kind !== 3) {
    fail("certified Enhancement hook global is unavailable");
  }
  const hookGlobalIndex = hookExports[0]!.index;
  const types = parseTypes(sectionById(sections, 1));
  const dispatchTypeIndex = types.findIndex((type) =>
    type.params.length === DISPATCH_PARAM_COUNT
      && type.params.every((parameter) => parameter === 0x7f)
      && type.results.length === 0);
  if (dispatchTypeIndex < 0) {
    fail("Enhancement dispatch function type is unavailable");
  }

  const functionTypes = parseIndexVector(sectionById(sections, 3));
  const bodies = parseCode(sectionById(sections, 10));
  const importCount = countFunctionImports(sectionById(sections, 2));
  const nextFunctionTypes = [...functionTypes];
  const nextBodies = [...bodies];
  const wrap = (
    functionIndex: number,
    wrapper: (originalIndex: number) => Uint8Array,
  ): void => {
    const localIndex = functionIndex - importCount;
    const body = bodies[localIndex];
    const typeIndex = functionTypes[localIndex];
    if (!body || typeIndex === undefined) fail("certified hook function is unavailable");
    const originalIndex = importCount + nextBodies.length;
    nextFunctionTypes.push(typeIndex);
    nextBodies.push(body);
    nextBodies[localIndex] = wrapper(originalIndex);
  };
  const roles = certificate.lifecycle.roles;
  for (const [role, paramCount] of [
    ["clear", 1], ["teardown", 0], ["loginStart", 3], ["logout", 1],
  ] as const) {
    wrap(roles[role], (originalIndex) => invalidatingWrapper(
      paramCount, originalIndex, hookGlobalIndex, dispatchTypeIndex,
    ));
  }
  wrap(roles.requestSent, (originalIndex) => requestSentWrapper(
    originalIndex, hookGlobalIndex, dispatchTypeIndex,
  ));
  wrap(roles.queueAppend, (originalIndex) => completionQueuedWrapper(
    originalIndex, hookGlobalIndex, dispatchTypeIndex, certificate.lifecycle.eventContextPointer,
  ));
  wrap(roles.loginCompleted, (originalIndex) => loginCompletedWrapper(
    originalIndex, hookGlobalIndex, dispatchTypeIndex,
  ));
  wrap(roles.rosterCallback, (originalIndex) => completionProcessedWrapper(
    originalIndex, hookGlobalIndex, dispatchTypeIndex,
  ));
  for (const role of ["connectionEvent", "disconnect", "connected"] as const) {
    const localIndex = roles[role] - importCount;
    nextBodies[localIndex] = instrumentStores(
      bodies[localIndex]!,
      certificate.lifecycle.connectionStoreOffsets[role],
      hookGlobalIndex,
      dispatchTypeIndex,
    );
  }
  const rewritten = sections.map((section): Section => {
    if (section.id === 3) return { id: 3, body: encodeIndexVector(nextFunctionTypes) };
    if (section.id === 10) return { id: 10, body: encodeCode(nextBodies) };
    return section;
  });
  const output = concat(
    WASM_HEADER,
    ...rewritten.map(encodeSection),
    encodeSection(manifest(certificate)),
  );
  if (!WebAssembly.validate(output)) fail("rewritten module failed validation");
  return output;
}
