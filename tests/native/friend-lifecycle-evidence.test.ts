/** Execute retained native friend paths against synthetic memory, with no client or network. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat, encodeCode, encodeIndexVector, encodeSection, paddedIndex,
  sectionById, sleb, splitSections, uleb, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

// Regression evidence for this retained input only. Never imported by production.
const INPUT_SHA256 = "1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b";
const ROOT = 5925656;
const OWN_STATUS = ROOT + 160;
const REQUEST_HEAD = 5928404;
const REQUEST_LINK_OFFSET = 5928396;
const CONNECTION = 5930208;
const REQUEST = 0x700000;
const SOCKET = 0x710000;
const ALIAS = 0x720000;
const UUID = 0x720100;
const CHARACTER = 0x720200;
const ARRAY = 0x730000;
const RECORD = 0x740000;
const VTABLE = 0x750000;
const LOGIN_REPLY = 0x760000;

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
} as const;

async function nativeFixture(input: Uint8Array) {
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
      assert.ok(size <= 112);
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
    return body;
  });
  const sections = [
    { id: 1, body: sectionById(splitSections(input), 1) },
    { id: 2, body: concat(uleb(imports.length), ...imports) },
    { id: 3, body: encodeIndexVector(nativeIndices.map((index) => module.functionTypeIndices[index]!)) },
    { id: 4, body: Uint8Array.of(1, 0x70, 0, 2) },
    { id: 6, body: concat(Uint8Array.of(1, 0x7f, 1, 0x41), sleb(0x600000), Uint8Array.of(0x0b)) },
    { id: 7, body: concat(uleb(nativeIndices.length), ...Object.entries(NATIVE).map(([name, index]) =>
      concat(string(name), Uint8Array.of(0), uleb(remap.get(index)!)))) },
    { id: 9, body: concat(Uint8Array.of(1, 0, 0x41, 0, 0x0b),
      encodeIndexVector([remap.get(334)!, remap.get(10329)!])) },
    { id: 10, body: encodeCode(bodies) },
  ];
  const capsule = new Uint8Array(concat(WASM_HEADER, ...sections.map(encodeSection)));
  assert.equal(WebAssembly.validate(capsule), true);
  const { instance } = await WebAssembly.instantiate(capsule, {
    fixture: { memory, ...Object.fromEntries([...stubs].map(([index, fn]) => [String(index), fn])) },
  });
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
  write(SOCKET + 28, 4); // Authenticated flag in the inspected connection.
  write(ROOT, ARRAY);
  write(ROOT + 4, 2);
  write(ROOT + 8, 2);
  write(ROOT + 96, 1); // Empty hash-list sentinel for the clear-only experiment.
  write(ARRAY + 4, RECORD);
  write(RECORD, 1);
  write(RECORD + 4, 1);
  write(RECORD + 108, 133);
  return { call, write, read, events, statusRequests, outbound, completions };
}

test("native friend lifecycle experiments distinguish local state from session proof", async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
  const input = new Uint8Array(await readFile(path));

  await t.test("roster entries require a matching request that is still pending", async () => {
    const f = await nativeFixture(input);
    f.call("rosterEntry", 41, 1, UUID, ALIAS);
    assert.equal(f.events.length, 0);
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0]?.id, 38);
    assert.equal(f.call("completeRequest", 42, 0), 1);
    assert.equal(f.read(REQUEST + 20), 1);
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 1, "completed requests reject later roster entries");
  });

  await t.test("the entry callback alone does not validate the request's connection", async () => {
    const f = await nativeFixture(input);
    f.write(SOCKET, 8); // A replacement connection; the request still belongs to ID 7.
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 1, "upstream dispatch/cleanup must supply this missing guarantee");
  });

  await t.test("the native request pump aborts a pending request on connection replacement", async () => {
    const f = await nativeFixture(input);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [], "same-connection pending requests remain pending");
    f.write(SOCKET, 8);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [{ requestId: 42, error: 7 }]);
    f.call("rosterEntry", 42, 1, UUID, ALIAS);
    assert.equal(f.events.length, 0, "unlinked requests reject later entries");
  });

  await t.test("the native request pump aborts a pending request when disconnected", async () => {
    const f = await nativeFixture(input);
    f.write(CONNECTION, 0);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [{ requestId: 42, error: 7 }]);
  });

  await t.test("a completion already accepted is not rechecked against the connection by the pump", async () => {
    const f = await nativeFixture(input);
    assert.equal(f.call("completeRequest", 42, 0), 1);
    f.write(SOCKET, 8);
    f.call("pumpRequest", REQUEST);
    assert.deepEqual(f.completions, [{ requestId: 42, error: 0 }]);
  });

  await t.test("status and location callbacks do not establish an authenticated session", async () => {
    const f = await nativeFixture(input);
    f.write(CONNECTION, 0);
    f.call("statusEvent", 1, UUID, ALIAS, CHARACTER);
    f.call("locationEvent", ALIAS, 133, 0, 0, 0);
    assert.deepEqual(f.events.map((event) => event.id), [44, 40]);
  });

  await t.test("own status changes locally even when the status request cannot be sent", async () => {
    const f = await nativeFixture(input);
    f.write(CONNECTION, 0);
    f.call("setOwnStatus", 1);
    assert.equal(f.read(OWN_STATUS), 1);
    assert.deepEqual(f.statusRequests, []);
    f.write(CONNECTION, SOCKET);
    f.call("setOwnStatus", 0);
    assert.equal(f.read(OWN_STATUS), 0);
    assert.deepEqual(f.statusRequests, [0]);
  });

  await t.test("logout clears the auth flag while retaining connection and friend storage", async () => {
    const f = await nativeFixture(input);
    f.call("logout", 0);
    assert.deepEqual(f.outbound, [[13, 0]]);
    assert.equal(f.read(CONNECTION), SOCKET);
    assert.equal(f.read(SOCKET + 28) & 4, 0);
    assert.equal(f.call("authenticated"), 0);
    assert.equal(f.read(ARRAY + 4), RECORD);
    assert.equal(f.read(RECORD + 108), 133);
  });

  await t.test("a later login reply can restore the flag without changing the connection or roster", async () => {
    const f = await nativeFixture(input);
    const observed = () => [
      f.call("authenticated"), f.read(CONNECTION), f.read(SOCKET),
      f.read(ROOT), f.read(ROOT + 8), f.read(ARRAY + 4), f.read(RECORD + 108),
    ];
    const before = observed();
    f.call("logout", 0);
    assert.equal(f.call("authenticated"), 0);
    f.write(REQUEST + 12, 1); // Native login request kind.
    f.write(REQUEST + 32, 43);
    f.write(LOGIN_REPLY + 4, 43);
    f.write(LOGIN_REPLY + 32, 23); // Synthetic account UUID, no private input.
    f.write(LOGIN_REPLY + 48, 29); // Synthetic character UUID.
    f.call("loginReply", LOGIN_REPLY, SOCKET);
    assert.equal(f.call("authenticated"), 1);
    assert.deepEqual(observed(), before,
      "these sampled values alone do not record the intervening transition");
  });

  await t.test("friend status changes do not clear the last reported location", async () => {
    const f = await nativeFixture(input);
    f.call("setFriendStatus", ROOT, 1, 0);
    assert.equal(f.read(RECORD + 4), 0);
    assert.equal(f.read(RECORD + 108), 133);
    f.call("setFriendStatus", ROOT, 1, 1);
    assert.equal(f.read(RECORD + 108), 133);
    f.call("setFriendLocation", ROOT, 1, 55);
    assert.equal(f.read(RECORD + 108), 55);
  });

  await t.test("clearing an already empty table preserves its allocated slots", async () => {
    const f = await nativeFixture(input);
    f.write(ARRAY + 4, 0);
    f.call("clear", ROOT);
    assert.equal(f.read(ROOT), ARRAY);
    assert.equal(f.read(ROOT + 8), 2);
    assert.equal(f.read(OWN_STATUS), 4);
  });
});
