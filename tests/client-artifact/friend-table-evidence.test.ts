/** Offline mutation experiments for candidates; none grant runtime authority. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectFriendTable } from "../../src/main/certification/friend-table-evidence.js";
import { wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import {
  concat, encodeCode, encodeSection, paddedIndex, parseCode,
  sectionById, splitSections, WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

test("friend candidate survives address and function movement and refuses changed relationships", {
  timeout: 120_000,
}, async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name a retained official artifact");
  const input = new Uint8Array(await readFile(path));
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  const module = evidence.moduleView();
  const functions = evidence.decodeFunctions([]);
  const original = inspectFriendTable(input);
  assert.equal(original.status, "candidate");
  assert.equal(original.runtimeAuthority, false);
  assert.ok(original.unresolved.includes("account-session-invalidation"));
  const candidate = original.candidates[0]!;
  const local = (index: number): number => index - module.functionImportCount;
  const participating = new Set([
    candidate.accessor, candidate.rootAccessor,
    ...candidate.scalarWriters.map((writer) => writer.functionIndex),
    ...candidate.uiConsumers,
  ]);
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
    assert.equal(WebAssembly.validate(new Uint8Array(output)), true, "experiments must remain valid WASM");
    return output;
  };
  const inspect = (bytes: Uint8Array) => {
    const result = inspectFriendTable(bytes);
    assert.equal(result.runtimeAuthority, false);
    assert.notEqual(result.inputSha256, original.inputSha256);
    return result;
  };

  await t.test("unrelated body changes do not identify the input by hash", () => {
    const changed = mutate((bodies) => {
      const index = local(destination(candidate.rootAccessor));
      const body = bodies[index]!;
      bodies[index] = concat(body.subarray(0, -1), Uint8Array.of(0x01, 0x0b));
    });
    assert.deepEqual(inspect(changed).candidates, original.candidates);
  });

  await t.test("the root is derived from all participating direct references", () => {
    const relocatedRoot = candidate.root + 4096;
    const moved = mutate((bodies) => {
      for (const fn of functions) {
        for (const site of fn.constantSites.filter((site) => site.value === candidate.root)) {
          assert.equal(site.operandEnd - site.operandStart, 5);
          bodies[local(fn.functionIndex)]!.set(paddedIndex(relocatedRoot), site.operandStart);
        }
      }
    });
    assert.equal(inspect(moved).candidates[0]?.root, relocatedRoot);
  });

  await t.test("accessor and writer indices can move independently", () => {
    for (const source of [candidate.accessor, candidate.scalarWriters[0]!.functionIndex]) {
      assert.equal(evidence.tableRelations.has(source), false);
      const target = destination(source);
      const moved = mutate((bodies) => {
        for (const fn of functions) {
          for (const [callee, sites] of fn.callSites) {
            if (callee !== source && callee !== target) continue;
            for (const site of sites) {
              assert.equal(site.operandEnd - site.offset - 1, 5);
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
      if (source === candidate.accessor) assert.equal(result.candidates[0]?.accessor, target);
      else assert.ok(result.candidates[0]?.scalarWriters.some((writer) => writer.functionIndex === target));
    }
  });

  await t.test("a valid but changed index check is refused", () => {
    const changed = mutate((bodies) => {
      const fn = functions.find((fn) => fn.functionIndex === candidate.accessor)!;
      const load = fn.memorySites[0]!;
      assert.equal(load.operandEnd - load.operandStart, 1);
      bodies[local(candidate.accessor)]![load.operandStart] = load.value + 4;
    });
    assert.equal(inspect(changed).status, "unavailable");
  });

  await t.test("changed scalar field meanings are refused", () => {
    for (const writer of candidate.scalarWriters) {
      const changed = mutate((bodies) => {
        const fn = functions.find((fn) => fn.functionIndex === writer.functionIndex)!;
        const store = fn.memorySites.find((site) => site.opcode === 0x36)!;
        assert.equal(store.operandEnd - store.operandStart, 1);
        bodies[local(writer.functionIndex)]![store.operandStart] = store.value + 4;
      });
      assert.equal(inspect(changed).status, "unavailable");
    }
  });

  await t.test("duplicate root accessors refuse unique identification", () => {
    const duplicated = mutate((bodies) => {
      bodies[local(destination(candidate.rootAccessor))] = bodies[local(candidate.rootAccessor)]!.slice();
    });
    const result = inspect(duplicated);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.candidates.length, 2);
  });

  await t.test("a disconnected root wrapper is refused", () => {
    const changed = mutate((bodies) => {
      const fn = functions.find((fn) => fn.functionIndex === candidate.rootAccessor)!;
      const site = fn.constantSites[0]!;
      bodies[local(candidate.rootAccessor)]!.set(paddedIndex(candidate.root + 4096), site.operandStart);
    });
    assert.equal(inspect(changed).status, "unavailable");
  });
});
