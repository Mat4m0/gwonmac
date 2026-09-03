/** Execute retained event delivery to distinguish queued login completion from processed updates. */
import assert from "node:assert/strict";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat, encodeCode, encodeIndexVector, encodeSection, paddedIndex,
  sectionById, sleb, splitSections, uleb, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const INPUT_SHA256 = "1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b";
const CONTEXT = 0x700000;
const PAYLOAD = 0x780000;
const REQUEST = 0x790000;
const ALIAS = 0x791000;
const UUID = 0x792000;
const NATIVE = {
  splice: 222, dispatchCallbacks: 474, register: 475, initQueue: 487,
  allocateBlock: 491, append: 493, recycleBlock: 494, attachReader: 499,
  initReader: 501, disposeReader: 502, read: 503, enqueue: 876,
  dispatch: 888, drain: 889, compareName: 354, copyName: 358,
  rosterEntry: 10084, completeRequest: 10068, loginComplete: 9998,
  createFriend: 8822, growArray: 8818, hashName: 363, removeFriend: 8820,
  growFreeSlots: 874, setFriendLocation: 8835, setFriendStatus: 8834,
  queuedBytes: 497,
} as const;

export async function queueFixture(input: Uint8Array) {
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  assert.equal(evidence.inputSha256, INPUT_SHA256, "reinspect queue roles for another retained client");
  const module = evidence.moduleView();
  const decoded = new Map(evidence.decodeFunctions([]).map((fn) => [fn.functionIndex, fn]));
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
  const view = new DataView(memory.buffer);
  const delivered: { id: number; value: number; size: number }[] = [];
  let allocated = 0x800000;
  let scheduled = 0;
  let duringDelivery: ((id: number) => void) | undefined;
  let sessionHooks: Readonly<{
    completionStarted(requestId: number, connection: number, success: boolean): void;
    completionQueued(): void;
    completionFinished(): void;
    completionProcessed(): void;
  }> | undefined;
  const unsupported = () => { throw new Error("unmodeled event queue dependency"); };
  const stubs = new Map<number, (...args: number[]) => number | void>([
    [322, (expression, source, line) => { throw new Error(`native assertion ${expression}/${source}:${line}`); }],
    // Single-threaded fixture: no scheduler, locks, or client telemetry executes.
    [224, (address) => address], [226, () => {}], [227, () => {}],
    [872, () => { scheduled += 1; }], [827, () => {}],
    [332, (size) => {
      assert.ok(size !== undefined && size > 0 && size <= 16384);
      const address = allocated;
      allocated += (size + 15) & ~15;
      assert.ok(allocated < 0x900000);
      return address;
    }],
    [264, (destination, source, size) => {
      assert.ok(destination !== undefined && source !== undefined && size !== undefined && size <= 1024);
      new Uint8Array(memory.buffer, destination, size).set(new Uint8Array(memory.buffer, source, size).slice());
      return destination;
    }],
    [8849, (metadata, event) => {
      assert.ok(metadata !== undefined && event !== undefined);
      assert.equal(view.getUint32(metadata + 4, true), 36, "native user-event callback category");
      const id = view.getUint32(event, true);
      const size = view.getUint32(event + 8, true);
      assert.equal(view.getUint32(metadata + 8, true), size + 12);
      delivered.push({ id, size, value: size >= 4 ? view.getUint32(event + 12, true) : 0 });
      duringDelivery?.(id);
      if (id === 14) sessionHooks?.completionProcessed();
    }],
    [17809, (address, size) => {
      assert.ok(address !== undefined && address >= 0x800000 && address < allocated);
      assert.ok(size === 24 || size === 172); // Queue block or friend record; allocator reuse is not modeled.
    }],
    [267, (address, size) => {
      assert.ok(address !== undefined && size !== undefined && size <= 352);
      new Uint8Array(memory.buffer, address, size).fill(0);
      return address;
    }],
    [9999, (_array, count) => { assert.equal(count, 0, "this fixture has no account properties"); }],
    // Suppress formatting/logging of the synthetic account fields; never emit identities.
    [8844, () => {}], [325, () => {}], [400, () => 0],
    [10000, () => {}], [9968, () => {}],
    // Record experiments reserve their pointer arrays up front. Hash membership
    // is outside the reader: the empty lookup bucket and these substitutes do
    // not establish native alias replacement or real hash-list ownership.
    [8823, () => {}], [8824, () => 0], [294, unsupported], [295, unsupported],
    [10329, unsupported], [10242, unsupported], [10264, unsupported], [334, unsupported],
    [223, unsupported], [245, unsupported], [246, unsupported],
    [848, unsupported], [482, unsupported], [480, unsupported], [495, unsupported],
  ]);
  for (const [index, stub] of stubs) {
    if (stub === unsupported) stubs.set(index, () => { throw new Error(`unmodeled queue dependency ${index}`); });
  }
  const nativeIndices = Object.values(NATIVE);
  const remap = new Map([...stubs.keys(), ...nativeIndices].map((index, ordinal) => [index, ordinal]));
  const string = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return concat(uleb(bytes.length), bytes);
  };
  const imports = [...stubs.keys()].map((index) => concat(
    string("fixture"), string(String(index)), Uint8Array.of(0), uleb(module.functionTypeIndices[index]!),
  ));
  imports.push(concat(string("fixture"), string("memory"), Uint8Array.of(2, 1), uleb(256), uleb(256)));
  const bodies = nativeIndices.map((index) => {
    const body = module.bodies[index - module.functionImportCount]!.slice();
    for (const [callee, sites] of decoded.get(index)!.callSites) {
      const target = remap.get(callee);
      assert.ok(target !== undefined, `dependency ${callee} must be modeled explicitly`);
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
    { id: 4, body: Uint8Array.of(1, 0x70, 0, 1) },
    { id: 6, body: concat(Uint8Array.of(1, 0x7f, 1, 0x41), sleb(0x600000), Uint8Array.of(0x0b)) },
    { id: 7, body: concat(uleb(nativeIndices.length), ...Object.entries(NATIVE).map(([name, index]) =>
      concat(string(name), Uint8Array.of(0), uleb(remap.get(index)!)))) },
    { id: 9, body: concat(Uint8Array.of(1, 0, 0x41, 0, 0x0b), encodeIndexVector([remap.get(8849)!])) },
    { id: 10, body: encodeCode(bodies) },
  ];
  const capsule = new Uint8Array(concat(WASM_HEADER, ...sections.map(encodeSection)));
  assert.equal(WebAssembly.validate(capsule), true);
  const { instance } = await WebAssembly.instantiate(capsule, {
    fixture: { memory, ...Object.fromEntries([...stubs].map(([index, fn]) => [String(index), fn])) },
  });
  function call(name: keyof typeof NATIVE, ...args: number[]): unknown {
    const fn = instance.exports[name];
    assert.ok(typeof fn === "function");
    return fn(...args);
  }
  const write = (address: number, value: number) => view.setUint32(address, value, true);
  // A single event context, with no child contexts, recording, or replay.
  write(CONTEXT + 16, 1);
  for (let category = 0; category < 47; category += 1) {
    const list = CONTEXT + 28 + category * 12;
    write(list, 12);
    write(list + 4, list + 4);
    write(list + 8, list - 7);
  }
  write(5928476, CONTEXT);
  write(5928396, 4);
  write(5928404, REQUEST);
  write(REQUEST + 8, 1);
  write(REQUEST + 12, 1); // Login request kind, already sent on the synthetic connection.
  write(REQUEST + 20, 3);
  write(REQUEST + 28, 7);
  write(REQUEST + 32, 42);
  write(REQUEST + 340, 123); // Synthetic account UUID copied by native completion.
  write(REQUEST + 356, 456); // Synthetic character UUID.
  write(UUID, 789);
  view.setUint16(ALIAS, 65, true);
  call("initQueue", CONTEXT + 592);
  call("register", CONTEXT + 28, 36, 0, 0);
  return {
    delivered, write, memory,
    friendTable() {
      const root = 0x7b0000;
      write(root, 0x7c0000);
      write(root + 4, 4096);
      write(root + 8, 1); // Native null sentinel; no initialized roster claim.
      write(root + 16, 0x7d0000);
      write(root + 20, 4096);
      write(root + 104, 0x7e0000);
      write(root + 112, 1);
      write(0x7e0000 + 8, 1); // Empty synthetic alias hash bucket.
      return {
        root,
        create(uuid: number, status = 4) {
          write(UUID, uuid);
          return call("createFriend", root, 1, status, UUID, ALIAS, 0x793000);
        },
        remove: (slot: number) => call("removeFriend", root, slot),
        location: (slot: number, map: number) => call("setFriendLocation", root, slot, map),
        status: (slot: number, status: number) => call("setFriendStatus", root, slot, status),
      };
    },
    rosterEntry: (requestId = 42) => call("rosterEntry", requestId, 1, UUID, ALIAS),
    prepareLogin(requestId: number) {
      write(REQUEST + 20, 3);
      write(REQUEST + 24, 0);
      write(REQUEST + 32, requestId);
    },
    completeLogin(error: number) {
      const requestId = view.getUint32(REQUEST + 32, true);
      const connection = view.getUint32(REQUEST + 28, true);
      sessionHooks?.completionStarted(requestId, connection, error === 0);
      const before = call("queuedBytes", CONTEXT + 592);
      call("completeRequest", requestId, error);
      call("loginComplete", REQUEST);
      const after = call("queuedBytes", CONTEXT + 592);
      assert.equal(typeof before, "number");
      assert.equal(typeof after, "number");
      if (typeof before !== "number" || typeof after !== "number") {
        throw new Error("native queue byte count is unavailable");
      }
      if (after - before === 368) sessionHooks?.completionQueued();
      else assert.equal(after, before, "login completion appends either one complete event or none");
      sessionHooks?.completionFinished();
    },
    enqueue(id: number, value = 0, size = 4) {
      write(PAYLOAD, value);
      return call("enqueue", CONTEXT, 0, id, PAYLOAD, size);
    },
    drain: () => call("drain", CONTEXT, 0),
    onDelivery: (callback: (id: number) => void) => { duringDelivery = callback; },
    onSession: (hooks: NonNullable<typeof sessionHooks>) => { sessionHooks = hooks; },
    scheduled: () => scheduled,
    allocatedBytes: () => allocated - 0x800000,
  };
}
