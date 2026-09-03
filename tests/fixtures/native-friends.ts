/** Execute retained native friend paths against synthetic memory, with no client or network. */
import assert from "node:assert/strict";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat, encodeCode, encodeIndexVector, encodeSection, paddedIndex,
  readUleb, sectionById, sleb, splitSections, uleb, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

// Regression evidence for this retained input only. Never imported by production.
const INPUT_SHA256 = "1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b";
export const ROOT = 5925656;
export const OWN_STATUS = ROOT + 160;
const REQUEST_HEAD = 5928404;
const REQUEST_LINK_OFFSET = 5928396;
export const CONNECTION = 5930208;
export const REQUEST = 0x700000;
export const SOCKET = 0x710000;
export const ALIAS = 0x720000;
export const UUID = 0x720100;
export const CHARACTER = 0x720200;
export const ARRAY = 0x730000;
export const RECORD = 0x740000;
const VTABLE = 0x750000;
export const LOGIN_REPLY = 0x760000;

const NATIVE = {
  completeRequest: 10068,
  rosterEntry: 10084,
  statusEvent: 10085,
  locationEvent: 10086,
  setOwnStatus: 8851,
  sendOwnStatus: 10144,
  queryConnection: 10242,
  authenticated: 10243,
  loginReply: 10281,
  storeLoginReply: 10073,
  pumpRequest: 9988,
  logout: 10244,
  setFriendStatus: 8834,
  setFriendLocation: 8835,
  clear: 8839,
  clearRecords: 8821,
  loginStart: 10116,
  disconnect: 10240,
  connectionEvent: 10236,
  connected: 10278,
  reportConnected: 10080,
  teardown: 8850,
} as const;

export async function nativeFixture(input: Uint8Array, instrumentInvalidation = false) {
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  assert.equal(evidence.inputSha256, INPUT_SHA256, "reinspect native roles for another retained client");
  const module = evidence.moduleView();
  const decoded = new Map(evidence.decodeFunctions([]).map((fn) => [fn.functionIndex, fn]));
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
  const view = new DataView(memory.buffer);
  const events: { id: number; payload: Uint8Array }[] = [];
  const statusRequests: number[] = [];
  const outbound: number[][] = [];
  const completions: { requestId: number; error: number }[] = [];
  let loginRequestCount = 0;
  let disconnectNoticeCount = 0;
  let dataDispatchSucceeds = true;
  const invalidationAt: { login: number[]; disconnect: number[]; free: number[]; teardown: number[] } = {
    login: [], disconnect: [], free: [], teardown: [],
  };
  const unreachable = () => { throw new Error("native fixture reached an unmodeled dependency"); };
  const stubs = new Map<number, (...args: number[]) => number | void>([
    [322, () => { throw new Error("native assertion rejected the synthetic fixture"); }],
    [358, (destination, source, count) => {
      assert.ok(destination !== undefined && source !== undefined && count !== undefined);
      assert.ok(count <= 20, "only bounded fixture names are supported");
      for (let i = 0; i < count; i += 1) {
        const unit = view.getUint16(source + i * 2, true);
        view.setUint16(destination + i * 2, unit, true);
        if (unit === 0) break;
      }
      return destination;
    }],
    [876, (_target, _flags, id, address, size) => {
      assert.ok(id !== undefined && address !== undefined && size !== undefined);
      assert.ok(size <= 352);
      events.push({ id, payload: new Uint8Array(memory.buffer, address, size).slice() });
      return 1;
    }],
    [10264, (status) => { assert.ok(status !== undefined); statusRequests.push(status); }],
    [10324, () => -1],
    [309, () => { throw new Error("unexpected native error-report path"); }],
    [5950, (_socket, address, count) => {
      assert.ok(address !== undefined && count !== undefined && count <= 4);
      outbound.push(Array.from({ length: count }, (_, i) => view.getUint32(address + i * 4, true)));
    }],
    [8820, () => { throw new Error("nonempty native removal is outside this fixture"); }],
    [264, (destination, source, size) => {
      assert.ok(destination !== undefined && source !== undefined && size !== undefined);
      assert.ok(size >= 0 && size <= 256);
      new Uint8Array(memory.buffer, destination, size).set(new Uint8Array(memory.buffer, source, size).slice());
      return destination;
    }],
    [10342, () => { throw new Error("the fixture must use the auth connection path"); }],
    // Only these two virtual calls are reachable for the already-sent requests below.
    [334, (request) => {
      assert.equal(request, REQUEST);
      completions.push({
        requestId: view.getUint32(REQUEST + 32, true),
        error: view.getUint32(REQUEST + 24, true),
      });
    }],
    [10329, (request) => {
      assert.equal(request, REQUEST);
      view.setUint32(REQUEST_HEAD, 1, true);
    }],
    [267, (address, size) => {
      assert.ok(address !== undefined && size !== undefined && size >= 0 && size <= 352);
      new Uint8Array(memory.buffer, address, size).fill(0);
      return address;
    }],
    [462, () => 0],
    [10395, () => { loginRequestCount += 1; invalidationAt.login.push(Number(epoch.value) >>> 0); }],
    [10380, unreachable],
    [10381, unreachable],
    [10241, () => {}],
    [10322, () => 1], // Exercise the native branch that removes an active connection.
    [879, () => {}],
    [862, () => { invalidationAt.teardown.push(Number(epoch.value) >>> 0); }],
    [5932, unreachable],
    [332, unreachable],
    [5944, unreachable],
    [10238, unreachable],
    [307, () => {}],
    [10067, () => { disconnectNoticeCount += 1; invalidationAt.disconnect.push(Number(epoch.value) >>> 0); }],
    [5949, () => {}],
    [17809, (address, size) => {
      assert.equal(address, SOCKET);
      assert.equal(size, 48);
      invalidationAt.free.push(Number(epoch.value) >>> 0);
    }],
    [5952, () => dataDispatchSucceeds ? 1 : 0], // No game messages are dispatched in this fixture.
    [241, () => 1],
    [878, () => {}],
    [769, unreachable],
    [505, unreachable],
    [780, unreachable],
    [752, unreachable],
  ]);
  const nativeIndices = Object.values(NATIVE);
  const indices = [...stubs.keys(), ...nativeIndices];
  const remap = new Map(indices.map((index, ordinal) => [index, ordinal]));
  const string = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return concat(uleb(bytes.byteLength), bytes);
  };
  const imports = [...stubs.keys()].map((index) => concat(
    string("fixture"), string(String(index)), Uint8Array.of(0), uleb(module.functionTypeIndices[index]!),
  ));
  imports.push(concat(string("fixture"), string("memory"), Uint8Array.of(2, 1), uleb(256), uleb(256)));
  const bodies = nativeIndices.map((index) => {
    const body = module.bodies[index - module.functionImportCount]!.slice();
    for (const [callee, sites] of decoded.get(index)!.callSites) {
      const target = remap.get(callee);
      assert.ok(target !== undefined, `native dependency ${callee} must be explicitly modeled`);
      for (const site of sites) {
        assert.equal(site.operandEnd - site.offset - 1, 5);
        body.set(paddedIndex(target), site.offset + 1);
      }
    }
    if (!instrumentInvalidation) return body;
    const cursor = { offset: 0 };
    const groups = readUleb(body, cursor);
    for (let group = 0; group < groups; group += 1) {
      readUleb(body, cursor);
      cursor.offset += 1;
    }
    const points = [NATIVE.clear, NATIVE.loginStart, NATIVE.logout, NATIVE.teardown]
      .some((entry) => entry === index) ? [cursor.offset] : [];
    if ([NATIVE.disconnect, NATIVE.connectionEvent, NATIVE.connected].some((entry) => entry === index)) {
      for (const site of decoded.get(index)!.memorySites) {
        if (site.opcode === 0x36 && site.value === CONNECTION) points.push(site.offset);
      }
      assert.ok(points.length > 0, "connection writers must contain the inspected pointer stores");
    }
    // Private fixture global 1. Wrap reaches terminal zero and can never reuse an epoch.
    const invalidate = Uint8Array.of(
      0x23, 1, 0x04, 0x40, 0x23, 1, 0x41, 1, 0x6a, 0x24, 1, 0x0b,
    );
    const parts: Uint8Array[] = [];
    let start = 0;
    for (const point of points.sort((left, right) => left - right)) {
      parts.push(body.subarray(start, point), invalidate);
      start = point;
    }
    return concat(...parts, body.subarray(start));
  });
  const sections = [
    { id: 1, body: sectionById(splitSections(input), 1) },
    { id: 2, body: concat(uleb(imports.length), ...imports) },
    { id: 3, body: encodeIndexVector(nativeIndices.map((index) => module.functionTypeIndices[index]!)) },
    { id: 4, body: Uint8Array.of(1, 0x70, 0, 2) },
    { id: 6, body: concat(Uint8Array.of(2, 0x7f, 1, 0x41), sleb(0x600000),
      Uint8Array.of(0x0b, 0x7f, 1, 0x41, 1, 0x0b)) },
    { id: 7, body: concat(uleb(nativeIndices.length + 1), ...Object.entries(NATIVE).map(([name, index]) =>
      concat(string(name), Uint8Array.of(0), uleb(remap.get(index)!))),
    concat(string("invalidationEpoch"), Uint8Array.of(3, 1))) },
    { id: 9, body: concat(Uint8Array.of(1, 0, 0x41, 0, 0x0b),
      encodeIndexVector([remap.get(334)!, remap.get(10329)!])) },
    { id: 10, body: encodeCode(bodies) },
  ];
  const capsule = new Uint8Array(concat(WASM_HEADER, ...sections.map(encodeSection)));
  assert.equal(WebAssembly.validate(capsule), true);
  const { instance } = await WebAssembly.instantiate(capsule, {
    fixture: { memory, ...Object.fromEntries([...stubs].map(([index, fn]) => [String(index), fn])) },
  });
  const epochExport = instance.exports.invalidationEpoch;
  assert.ok(epochExport instanceof WebAssembly.Global);
  const epoch = epochExport;
  function call(name: keyof typeof NATIVE, ...args: number[]): unknown {
    const fn = instance.exports[name];
    assert.equal(typeof fn, "function");
    if (typeof fn !== "function") throw new Error("missing native fixture export");
    return fn(...args);
  }
  const write = (address: number, value: number) => view.setUint32(address, value, true);
  const read = (address: number) => view.getUint32(address, true);
  for (const [address, name] of [[ALIAS, "Fixture Alias"], [CHARACTER, "Fixture Character"]] as const) {
    for (let i = 0; i < name.length; i += 1) view.setUint16(address + i * 2, name.charCodeAt(i), true);
  }
  write(UUID, 17);
  write(REQUEST_HEAD, REQUEST);
  write(REQUEST_LINK_OFFSET, 4);
  write(REQUEST, VTABLE);
  write(VTABLE + 16, 0); // Completion callback, not the real login completion implementation.
  write(VTABLE + 4, 1); // Fixture destructor only unlinks this synthetic request.
  write(REQUEST + 8, 1); // Intrusive-list end tag.
  write(REQUEST + 16, 3); // Native auth connection kind.
  write(REQUEST + 20, 3); // Sent request, awaiting completion.
  write(REQUEST + 28, 7); // Connection ID captured by the pending request.
  write(REQUEST + 32, 42);
  write(CONNECTION, SOCKET);
  write(SOCKET, 7);
  write(SOCKET + 8, SOCKET + 8);
  write(SOCKET + 12, SOCKET + 9); // Empty intrusive-list links used by native destruction.
  write(SOCKET + 28, 4); // Authenticated flag in the inspected connection.
  write(5928952, 1); // Enable the null-credential native login-start branch.
  write(ROOT, ARRAY);
  write(ROOT + 4, 2);
  write(ROOT + 8, 2);
  write(ROOT + 96, 1); // Empty hash-list sentinel for the clear-only experiment.
  write(ARRAY + 4, RECORD);
  write(RECORD, 1);
  write(RECORD + 4, 1);
  write(RECORD + 108, 133);
  return {
    call, write, read, events, statusRequests, outbound, completions, epoch, memory,
    invalidationAt,
    failDataDispatch: () => { dataDispatchSucceeds = false; },
    generation: () => Number(epoch.value) >>> 0,
    loginRequestCount: () => loginRequestCount,
    disconnectNoticeCount: () => disconnectNoticeCount,
  };
}
