/** Execute production observer wrappers with explicit native-call substitutes and synthetic memory. */
import assert from "node:assert/strict";
import type { FriendObserverCertificate } from "../../src/main/certification/friend-observer-certificate.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat, encodeCode, encodeIndexVector, encodeSection, parseExports,
  sectionById, splitSections, uleb, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const WRAPPERS = [
  "clear", "teardown", "loginStart", "logout", "requestSent", "queueAppend",
  "loginCompleted", "rosterCallback",
] as const;
type Wrapper = typeof WRAPPERS[number];

export async function observerTransformFixture(
  predecessor: Uint8Array,
  transformed: Uint8Array,
  certificate: FriendObserverCertificate,
) {
  const before = wasmEvidence(predecessor);
  const after = wasmEvidence(transformed);
  assert.ok(before && after);
  const module = after.moduleView();
  const decoded = new Map(after.decodeFunctions([]).map((fn) => [fn.functionIndex, fn]));
  const firstClone = before.moduleView().functionTypeIndices.length;
  const clones = new Map<Wrapper, number>();
  for (const role of WRAPPERS) {
    const fn = decoded.get(certificate.lifecycle.roles[role])!;
    const calls = [...fn.calls.keys()].filter((index) => index >= firstClone);
    assert.equal(calls.length, 1, `${role} must call its one native clone`);
    clones.set(role, calls[0]!);
  }
  const hookIndex = parseExports(sectionById(splitSections(transformed), 7))
    .find((entry) => entry.name === "enhancement_hook_slot")!.index;
  const dispatchType = module.types.findIndex((type) =>
    type.params.length === 6 && type.params.every((value) => value === 0x7f)
    && type.results.length === 0);
  assert.ok(dispatchType >= 0);
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
  const view = new DataView(memory.buffer);
  const events: Array<{ kind: "notification" | "native"; name: string; args: number[] }> = [];
  const handlers = new Map<Wrapper, (...args: number[]) => number | void>();
  const dependencyStubs = new Map<number, (...args: number[]) => number | void>([
    [10241, () => {}], [10322, () => 1], [879, () => {}],
  ]);
  const stubs = new Map<number, (...args: number[]) => number | void>([
    ...[...clones].map(([role, index]) => [index, (...args: number[]) => {
      events.push({ kind: "native", name: role, args });
      return handlers.get(role)?.(...args) ?? (role === "queueAppend" ? 1 : undefined);
    }] as const),
    ...dependencyStubs,
  ]);
  const nativeRoles = [...WRAPPERS, "disconnect"] as const;
  const nativeIndices = nativeRoles.map((role) => certificate.lifecycle.roles[role]);
  // Import 0 is the closed observer dispatch used by the existing hook slot.
  const remap = new Map([...stubs.keys(), ...nativeIndices]
    .map((index, ordinal) => [index, ordinal + 1]));
  const string = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return concat(uleb(bytes.length), bytes);
  };
  const imports = [
    concat(string("fixture"), string("notify"), Uint8Array.of(0), uleb(dispatchType)),
    ...[...stubs.keys()].map((index) => concat(
      string("fixture"), string(String(index)), Uint8Array.of(0),
      uleb(module.functionTypeIndices[index]!),
    )),
    concat(string("fixture"), string("memory"), Uint8Array.of(2, 1), uleb(256), uleb(256)),
  ];
  const bodies = nativeIndices.map((index) => {
    const body = module.bodies[index - module.functionImportCount]!;
    const sites = [...decoded.get(index)!.callSites].flatMap(([target, entries]) =>
      entries.map((site) => ({ target, site }))).sort((a, b) => a.site.offset - b.site.offset);
    const parts: Uint8Array[] = [];
    let cursor = 0;
    for (const { target, site } of sites) {
      const mapped = remap.get(target);
      assert.ok(mapped !== undefined, `dependency ${target} must be modeled explicitly`);
      parts.push(body.subarray(cursor, site.offset + 1), uleb(mapped));
      cursor = site.operandEnd;
    }
    parts.push(body.subarray(cursor));
    return concat(...parts);
  });
  const sections = [
    { id: 1, body: sectionById(splitSections(transformed), 1) },
    { id: 2, body: concat(uleb(imports.length), ...imports) },
    { id: 3, body: encodeIndexVector(nativeIndices.map((index) => module.functionTypeIndices[index]!)) },
    { id: 4, body: Uint8Array.of(1, 0x70, 0, 1) },
    { id: 6, body: concat(uleb(hookIndex + 1), ...Array.from({ length: hookIndex + 1 }, (_, index) =>
      Uint8Array.of(0x7f, 1, 0x41, index === hookIndex ? 1 : 0, 0x0b))) },
    { id: 7, body: concat(uleb(nativeRoles.length + 1), ...nativeRoles.map((role) =>
      concat(string(role), Uint8Array.of(0), uleb(remap.get(certificate.lifecycle.roles[role])!))),
      string("hook"), Uint8Array.of(3), uleb(hookIndex)) },
    { id: 9, body: concat(Uint8Array.of(1, 0, 0x41, 0, 0x0b), encodeIndexVector([0])) },
    { id: 10, body: encodeCode(bodies) },
  ];
  const capsule = new Uint8Array(concat(WASM_HEADER, ...sections.map(encodeSection)));
  assert.equal(WebAssembly.validate(capsule), true);
  let onNotification: ((args: number[]) => void) | undefined;
  const { instance } = await WebAssembly.instantiate(capsule, {
    fixture: {
      memory,
      notify: (...args: number[]) => {
        events.push({ kind: "notification", name: String(args[1]), args });
        onNotification?.(args);
      },
      ...Object.fromEntries([...stubs].map(([index, fn]) => [String(index), fn])),
    },
  });
  return {
    events, handlers,
    write: (address: number, value: number) => view.setUint32(address, value, true),
    read: (address: number) => view.getUint32(address, true),
    hook: instance.exports.hook as WebAssembly.Global,
    notifications: () => events.filter((event) => event.kind === "notification"),
    observe: (callback: (args: number[]) => void) => { onNotification = callback; },
    call(role: typeof nativeRoles[number], ...args: number[]): unknown {
      const fn = instance.exports[role];
      assert.equal(typeof fn, "function");
      return (fn as CallableFunction)(...args);
    },
  };
}
