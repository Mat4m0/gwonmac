/** Qualification of the complete mouse double-click route on retained clients. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  concat,
  encodeCode,
  encodeSection,
  functionImportIndex,
  paddedIndex,
  parseCode,
  readUleb,
  sectionById,
  splitSections,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import {
  deriveNativeDoubleClickBuild,
  rewriteWithBuild,
} from "../../src/main/certification/native-double-click.js";
import {
  locateNativeDoubleClickRoute,
} from "../../src/main/certification/native-double-click-route-proof.js";
import {
  wasmEvidence,
} from "../../src/main/certification/wasm-evidence.js";

declare const WebAssembly: { validate(bytes: Uint8Array): boolean };

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const paths = [process.env.GW_CLIENT_WASM_PREVIOUS, process.env.GW_CLIENT_WASM]
  .filter((value): value is string => Boolean(value));

function rewriteCode(
  input: Uint8Array,
  edit: (bodies: Uint8Array[], importCount: number) => void,
  editElements?: (bytes: Uint8Array) => Uint8Array,
): Uint8Array {
  const sections = splitSections(input);
  const module = wasmEvidence(input)?.moduleView();
  assert.ok(module);
  const bodies = parseCode(sectionById(sections, 10));
  edit(bodies, module.functionImportCount);
  return concat(
    WASM_HEADER,
    ...sections.map((section) => encodeSection(
      section.id === 10
        ? { id: 10, body: encodeCode(bodies) }
        : section.id === 9 && editElements
          ? { id: 9, body: editElements(section.body.slice()) }
          : section,
    )),
  );
}

function swapCalls(bodies: Uint8Array[], left: number, right: number): void {
  const leftBytes = paddedIndex(left);
  const rightBytes = paddedIndex(right);
  for (const body of bodies) {
    for (let offset = 0; offset <= body.byteLength - 6; offset += 1) {
      if (body[offset] !== 0x10) continue;
      const operand = body.subarray(offset + 1, offset + 6);
      if (leftBytes.every((byte, index) => operand[index] === byte)) {
        body.set(rightBytes, offset + 1);
      } else if (rightBytes.every((byte, index) => operand[index] === byte)) {
        body.set(leftBytes, offset + 1);
      }
    }
  }
}

function swapBodies(
  bodies: Uint8Array[],
  importCount: number,
  left: number,
  right: number,
): void {
  swapCalls(bodies, left, right);
  const leftLocal = left - importCount;
  const rightLocal = right - importCount;
  [bodies[leftLocal], bodies[rightLocal]] = [bodies[rightLocal]!, bodies[leftLocal]!];
}

function swapActiveTableFunctions(
  bytes: Uint8Array,
  left: number,
  right: number,
): Uint8Array {
  const cursor = { offset: 0 };
  const segments = readUleb(bytes, cursor);
  for (let segment = 0; segment < segments; segment += 1) {
    const flags = readUleb(bytes, cursor);
    assert.equal(flags, 0, "retained fixture uses bounded active table segments");
    assert.equal(bytes[cursor.offset++], 0x41);
    readUleb(bytes, cursor);
    assert.equal(bytes[cursor.offset++], 0x0b);
    const count = readUleb(bytes, cursor);
    for (let entry = 0; entry < count; entry += 1) {
      const start = cursor.offset;
      const value = readUleb(bytes, cursor);
      if (value !== left && value !== right) continue;
      const replacement = uleb(value === left ? right : left);
      assert.equal(replacement.byteLength, cursor.offset - start);
      bytes.set(replacement, start);
    }
  }
  assert.equal(cursor.offset, bytes.byteLength);
  return bytes;
}

function destinationFor(
  input: Uint8Array,
  source: number,
  excluded: ReadonlySet<number>,
): number {
  const evidence = wasmEvidence(input);
  assert.ok(evidence);
  const module = evidence.moduleView();
  const sourceType = module.functionTypeIndices[source]!;
  for (let index = module.functionImportCount; index < module.functionTypeIndices.length; index += 1) {
    if (
      index !== source
      && !excluded.has(index)
      && module.functionTypeIndices[index] === sourceType
      && (evidence.tableRelations.get(index)?.length ?? 0) === 0
      && uleb(index).byteLength === uleb(source).byteLength
    ) return index;
  }
  throw new Error(`no relocation destination for function ${source}`);
}

test("retained clients prove the complete native double-click route", {
  skip: paths.length < 2 ? "set GW_CLIENT_WASM_PREVIOUS and GW_CLIENT_WASM" : false,
}, async () => {
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path));
    const route = locateNativeDoubleClickRoute(bytes);
    assert.ok(route, `${path} must prove the complete route`);
    const build = deriveNativeDoubleClickBuild(bytes);
    assert.ok(build);
    const output = rewriteWithBuild(bytes, build);
    assert.equal(WebAssembly.validate(output), true);
    assert.equal(build.derivations[sha256(bytes)], sha256(output));
    if (sha256(bytes) === "a3644a2a18bbfa237e578f2eb21d277e645b6b201f65034e00b3dcf021cae7a3") {
      assert.equal(
        sha256(output),
        "c775ec21b47e909159a85d77f3b8a5636c7f9896bef801e2681504741b5aa64c",
      );
    }
  }
});

test("route proof survives reindexing and table relocation, but refuses broken edges", {
  skip: !process.env.GW_CLIENT_WASM ? "set GW_CLIENT_WASM" : false,
}, async () => {
  const bytes = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM!));
  const route = locateNativeDoubleClickRoute(bytes);
  assert.ok(route);
  const routeFunctions = new Set(Object.entries(route)
    .filter(([key]) => key.endsWith("FunctionIndex"))
    .map(([, value]) => value as number));

  const pumpDestination = destinationFor(bytes, route.pumpFunctionIndex, routeFunctions);
  const reindexed = rewriteCode(bytes, (bodies, imports) => {
    swapBodies(bodies, imports, route.pumpFunctionIndex, pumpDestination);
  });
  assert.equal(WebAssembly.validate(reindexed), true);
  assert.equal(locateNativeDoubleClickRoute(reindexed)?.pumpFunctionIndex, pumpDestination);

  const dispatcherDestination = destinationFor(bytes, route.dispatcherFunctionIndex, routeFunctions);
  const tableRelocated = rewriteCode(
    bytes,
    (bodies, imports) => swapBodies(
      bodies,
      imports,
      route.dispatcherFunctionIndex,
      dispatcherDestination,
    ),
    (elements) => swapActiveTableFunctions(
      elements,
      route.dispatcherFunctionIndex,
      dispatcherDestination,
    ),
  );
  assert.equal(WebAssembly.validate(tableRelocated), true);
  assert.equal(
    locateNativeDoubleClickRoute(tableRelocated)?.dispatcherFunctionIndex,
    dispatcherDestination,
  );

  const wrongTranslatorField = rewriteCode(bytes, (bodies, imports) => {
    bodies[route.translatorFunctionIndex - imports]![2_124] = 20;
  });
  assert.equal(WebAssembly.validate(wrongTranslatorField), true);
  assert.equal(locateNativeDoubleClickRoute(wrongTranslatorField), null);

  const evidence = wasmEvidence(bytes);
  assert.ok(evidence);
  const module = evidence.moduleView();
  const decoded = new Map(
    evidence.decodeFunctions([]).map((entry) => [entry.functionIndex, entry]),
  );

  const dispatchDecoy = destinationFor(
    bytes,
    route.messageDispatchFunctionIndex,
    routeFunctions,
  );
  const translator = decoded.get(route.translatorFunctionIndex);
  assert.ok(translator);
  const dispatchCalls = translator.callSites.get(route.messageDispatchFunctionIndex);
  assert.ok(dispatchCalls);
  const retargetedTranslator = rewriteCode(bytes, (bodies, imports) => {
    const body = bodies[route.translatorFunctionIndex - imports]!;
    for (const call of dispatchCalls) {
      body.set(paddedIndex(dispatchDecoy), call.offset + 1);
    }
  });
  assert.equal(WebAssembly.validate(retargetedTranslator), true);
  assert.equal(locateNativeDoubleClickRoute(retargetedTranslator), null);

  const enqueue = decoded.get(route.enqueueFunctionIndex);
  assert.ok(enqueue);
  const queueSite = enqueue.memorySites.find((site) => site.offset === 223);
  assert.ok(queueSite);
  const usedOperands = new Set(
    [...decoded.values()].flatMap((entry) =>
      [...entry.constantSites, ...entry.memorySites].map((site) => site.value)
    ),
  );
  let movedQueueStorage = queueSite.value + 4;
  while (usedOperands.has(movedQueueStorage)) movedQueueStorage += 4;
  assert.ok(movedQueueStorage < evidence.data.initialMemoryBytes);
  const splitQueueStorage = rewriteCode(bytes, (bodies, imports) => {
    const body = bodies[route.enqueueFunctionIndex - imports]!;
    for (const site of [...enqueue.constantSites, ...enqueue.memorySites]) {
      if (site.value === queueSite.value) {
        body.set(paddedIndex(movedQueueStorage), site.operandStart);
      }
    }
  });
  assert.equal(WebAssembly.validate(splitQueueStorage), true);
  assert.equal(locateNativeDoubleClickRoute(splitQueueStorage), null);

  const mousedownImport = functionImportIndex(
    module.importSection!,
    "emscripten_set_mousedown_callback_on_thread",
  );
  assert.notEqual(mousedownImport, null);
  const registration = evidence.decodeFunctions([]).find(
    ({ functionIndex }) => functionIndex === route.registrationFunctionIndex,
  );
  assert.ok(registration);
  const registrationCall = registration.callSites.get(mousedownImport!)?.[0];
  assert.ok(registrationCall);
  const registeredSlot = registration.constantSites
    .filter((site) => site.offset < registrationCall.offset)
    .slice(-3)[1];
  assert.equal(registeredSlot?.value, route.callbackTableSlot);
  const wrongRegisteredSlot = rewriteCode(bytes, (bodies, imports) => {
    bodies[route.registrationFunctionIndex - imports]!.set(
      paddedIndex(route.callbackTableSlot + 1),
      registeredSlot!.operandStart,
    );
  });
  assert.equal(WebAssembly.validate(wrongRegisteredSlot), true);
  assert.equal(locateNativeDoubleClickRoute(wrongRegisteredSlot), null);

  const mousemoveImport = functionImportIndex(
    module.importSection!,
    "emscripten_set_mousemove_callback_on_thread",
  );
  assert.notEqual(mousemoveImport, null);
  const wrongBrowserCallback = rewriteCode(bytes, (bodies, imports) => {
    bodies[route.registrationFunctionIndex - imports]!.set(
      paddedIndex(mousemoveImport!),
      registrationCall.offset + 1,
    );
  });
  assert.equal(WebAssembly.validate(wrongBrowserCallback), true);
  assert.equal(locateNativeDoubleClickRoute(wrongBrowserCallback), null);

  const wrongDispatchField = rewriteCode(bytes, (bodies, imports) => {
    bodies[route.dispatcherFunctionIndex - imports]![234] = 8;
  });
  assert.equal(WebAssembly.validate(wrongDispatchField), true);
  assert.equal(locateNativeDoubleClickRoute(wrongDispatchField), null);

  const wrongMask = rewriteCode(bytes, (bodies, imports) => {
    bodies[route.consumerFunctionIndex - imports]![197] = 2;
  });
  assert.equal(WebAssembly.validate(wrongMask), true);
  assert.equal(locateNativeDoubleClickRoute(wrongMask), null);

  const wrongTableBinding = rewriteCode(bytes, (bodies, imports) => {
    const body = bodies[route.binderFunctionIndex - imports]!;
    body[653] = body[653]! + 1;
  });
  assert.equal(WebAssembly.validate(wrongTableBinding), true);
  assert.equal(locateNativeDoubleClickRoute(wrongTableBinding), null);

  const consumerDecoy = destinationFor(bytes, route.consumerFunctionIndex, routeFunctions);
  const brokenDownstreamEdge = rewriteCode(bytes, (bodies, imports) => {
    bodies[route.dispatcherFunctionIndex - imports]!.set(paddedIndex(consumerDecoy), 239);
  });
  assert.equal(WebAssembly.validate(brokenDownstreamEdge), true);
  assert.equal(locateNativeDoubleClickRoute(brokenDownstreamEdge), null);

  const translatorDecoy = destinationFor(bytes, route.translatorFunctionIndex, routeFunctions);
  const ambiguous = rewriteCode(bytes, (bodies, imports) => {
    bodies[translatorDecoy - imports] = bodies[route.translatorFunctionIndex - imports]!.slice();
  });
  assert.equal(WebAssembly.validate(ambiguous), true);
  assert.equal(locateNativeDoubleClickRoute(ambiguous), null);
});
