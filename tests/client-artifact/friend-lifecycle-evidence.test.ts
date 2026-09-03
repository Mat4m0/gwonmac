/** Offline mutations prove the friend lifecycle graph without granting runtime authority. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectFriendLifecycle } from "../../src/main/certification/friend-lifecycle-evidence.js";
import {
  deriveFriendObserverCertificate,
  isFriendObserverCertificate,
} from "../../src/main/certification/friend-observer-certificate.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat, encodeCode, encodeSection, paddedIndex, parseCode,
  sectionById, splitSections, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

test("friend lifecycle roles survive movement and refuse changed notification paths", {
  timeout: 120_000,
}, async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name a retained official artifact");
  const input = new Uint8Array(await readFile(path));
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  const module = evidence.moduleView();
  const functions = evidence.decodeFunctions([]);
  const original = inspectFriendLifecycle(input);
  assert.equal(original.status, "candidate");
  assert.equal(original.runtimeAuthority, false);
  const candidate = original.candidate!;
  assert.equal(candidate.eventContextPointer % 4, 0);
  assert.ok(candidate.eventContextPointer + 4 <= evidence.data.initialMemoryBytes);
  const certificate = deriveFriendObserverCertificate(input);
  assert.ok(certificate);
  assert.equal(isFriendObserverCertificate(certificate, original.inputSha256), true);
  const participating = new Set(Object.values(candidate.roles));
  const local = (index: number): number => index - module.functionImportCount;
  const destination = (source: number): number => {
    const found = functions.find((fn) =>
      !participating.has(fn.functionIndex)
      && module.functionTypeIndices[fn.functionIndex] === module.functionTypeIndices[source]
      && !evidence.tableRelations.has(fn.functionIndex)
      && !module.exports.some((entry) => entry.kind === 0 && entry.index === fn.functionIndex)
    );
    assert.ok(found);
    return found.functionIndex;
  };
  const mutate = (edit: (bodies: Uint8Array[]) => void): Uint8Array => {
    const sections = splitSections(input);
    const bodies = parseCode(sectionById(sections, 10));
    edit(bodies);
    const output = concat(WASM_HEADER, ...sections.map((section) => encodeSection(
      section.id === 10 ? { id: 10, body: encodeCode(bodies) } : section,
    )));
    assert.equal(WebAssembly.validate(new Uint8Array(output)), true);
    return output;
  };
  const inspect = (bytes: Uint8Array) => {
    const result = inspectFriendLifecycle(bytes);
    assert.equal(result.runtimeAuthority, false);
    assert.notEqual(result.inputSha256, original.inputSha256);
    return result;
  };

  await t.test("the queue append role can move independently", () => {
    const source = candidate.roles.queueAppend;
    const target = destination(source);
    const moved = mutate((bodies) => {
      for (const fn of functions) {
        for (const [callee, sites] of fn.callSites) {
          if (callee !== source && callee !== target) continue;
          for (const site of sites) {
            bodies[local(fn.functionIndex)]!.set(
              paddedIndex(callee === source ? target : source), site.offset + 1,
            );
          }
        }
      }
      [bodies[local(source)], bodies[local(target)]] = [
        bodies[local(target)]!, bodies[local(source)]!,
      ];
    });
    const result = inspect(moved);
    assert.equal(result.status, "candidate");
    assert.equal(result.candidate?.roles.queueAppend, target);
  });

  await t.test("a queue facade disconnected from the append role is refused", () => {
    const facade = candidate.roles.queueFacade;
    const source = candidate.roles.queueAppend;
    const target = destination(source);
    const changed = mutate((bodies) => {
      const fn = functions.find((entry) => entry.functionIndex === facade)!;
      const site = fn.callSites.get(source)![0]!;
      bodies[local(facade)]!.set(paddedIndex(target), site.offset + 1);
    });
    assert.equal(inspect(changed).status, "unavailable");
  });

  await t.test("changed active-connection store coverage is refused", () => {
    const source = candidate.roles.disconnect;
    const changed = mutate((bodies) => {
      const fn = functions.find((entry) => entry.functionIndex === source)!;
      const site = fn.memorySites.find((memory) => memory.value === candidate.connectionPointer
        && memory.opcode === 0x36)!;
      const body = bodies[local(source)]!;
      body[site.operandStart] = body[site.operandStart]! + 4;
    });
    assert.equal(inspect(changed).status, "unavailable");
  });

  await t.test("a changed user-event roster callback binding is refused", () => {
    const source = candidate.roles.rosterRegistration;
    const changed = mutate((bodies) => {
      const fn = functions.find((entry) => entry.functionIndex === source)!;
      const site = fn.constantSites.find((constant) =>
        constant.value === candidate.rosterCallbackTableSlot
      )!;
      const body = bodies[local(source)]!;
      body[site.operandStart] = body[site.operandStart]! + 1;
    });
    assert.equal(inspect(changed).status, "unavailable");
  });

  await t.test("a duplicate lifecycle role is refused", () => {
    const source = candidate.roles.logout;
    const duplicated = mutate((bodies) => {
      bodies[local(destination(source))] = bodies[local(source)]!.slice();
    });
    assert.equal(inspect(duplicated).status, "unavailable");
  });

  await t.test("the IPC certificate refuses altered semantic and hook facts", () => {
    for (const record of [
      { ...certificate.record, recordLayout: null },
      { ...certificate.record, scalarWriters: [null, null] },
    ]) {
      assert.equal(isFriendObserverCertificate({ ...certificate, record }, original.inputSha256), false);
    }
    assert.equal(isFriendObserverCertificate({
      ...certificate,
      semanticSha256: "0".repeat(64),
    }, original.inputSha256), false);
    assert.equal(isFriendObserverCertificate({
      ...certificate,
      lifecycle: { ...certificate.lifecycle, connectionPointer: -1 },
    }, original.inputSha256), false);
    assert.equal(isFriendObserverCertificate({
      ...certificate,
      lifecycle: { ...certificate.lifecycle, rosterCallbackTableSlot: -1 },
    }, original.inputSha256), false);
    assert.equal(isFriendObserverCertificate({
      ...certificate,
      lifecycle: {
        ...certificate.lifecycle,
        connectionStoreOffsets: {
          ...certificate.lifecycle.connectionStoreOffsets,
          connectionEvent: certificate.lifecycle.connectionStoreOffsets.connectionEvent.slice(1),
        },
      },
    }, original.inputSha256), false);
  });
});
