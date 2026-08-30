import assert from "node:assert/strict";
import test from "node:test";
import {
  characterActionExecute,
  characterActionFramePointerWithinMemory,
} from "../../src/main/certification/enhancement-character-switch-transform.js";
import { decodeFunctions } from "../../src/main/certification/wasm-instruction-evidence.js";
import type { ModuleShape } from "../../src/main/certification/enhancement-evidence-types.js";
import {
  concat,
  encodeCode,
  encodeSection,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const bodyModule = (body: Uint8Array): ModuleShape => ({
  types: [],
  functionTypeIndices: [0],
  functionImportCount: 0,
  bodies: [body],
  exports: [],
  importSection: null,
  memorySection: null,
  tableSection: null,
  elementSection: null,
  dataSegments: [],
});

const section = (id: number, body: Uint8Array) => encodeSection({ id, body });

function pointerGuardModule(frameBytes: number): Uint8Array {
  const type = concat(
    uleb(1), Uint8Array.of(0x60),
    uleb(1), Uint8Array.of(0x7f),
    uleb(1), Uint8Array.of(0x7f),
  );
  const exportName = new TextEncoder().encode("withinMemory");
  return concat(
    WASM_HEADER,
    section(1, type),
    section(3, concat(uleb(1), uleb(0))),
    section(5, concat(uleb(1), Uint8Array.of(0x00), uleb(1))),
    section(7, concat(
      uleb(1), uleb(exportName.byteLength), exportName,
      Uint8Array.of(0x00), uleb(0),
    )),
    section(10, encodeCode([
      concat(
        uleb(0),
        characterActionFramePointerWithinMemory(0, frameBytes),
        Uint8Array.of(0x0b),
      ),
    ])),
  );
}

test("the generated frame guard accepts even pointers and rejects unsafe ranges", async () => {
  const frameBytes = 0x1c8;
  const bytes = pointerGuardModule(frameBytes);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert.equal(WebAssembly.validate(buffer), true);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(buffer));
  const withinMemory = instance.exports.withinMemory as (pointer: number) => number;

  assert.equal(withinMemory(0), 0, "null must fail closed");
  assert.equal(withinMemory(64), 1, "a normal aligned/even frame pointer is valid");
  assert.equal(withinMemory(65_536 - frameBytes), 1, "the last complete record is valid");
  assert.equal(withinMemory(65_536 - frameBytes + 1), 0, "a truncated record must fail closed");
  assert.equal(withinMemory(65_536), 0, "a pointer outside memory must fail closed");
});

test("character switching uses only the certified internal frame dispatcher", () => {
  const frameChild = 7;
  const frameParent = 8;
  const frameResolver = 9;
  const frameDispatch = 10;
  const logoutDispatch = 11;
  const body = characterActionExecute({
    layout: {
      contextRoot: 100,
      gameContextSlot: 1,
      characterContext: 4,
      currentInstanceType: 8,
      characterArrayPointer: 104,
      characterArrayCount: 112,
      frameArray: 116,
      frameCount: 124,
      frameBytes: 0x1c8,
      frameId: 0xbc,
      frameChildOffsetId: 0xb8,
      frameState: 0x18c,
      frameHashId: 0x134,
    },
    dispatcherFunctionIndex: logoutDispatch,
    frameChildFunctionIndex: frameChild,
    frameParentFunctionIndex: frameParent,
    frameResolverFunctionIndex: frameResolver,
    frameDispatchFunctionIndex: frameDispatch,
    frameDispatchOffset: 0xa8,
    logoutMessageId: 0x1000_009d,
    selectorHash: 11,
    playHash: 12,
    pendingGlobalIndex: 2,
    expectedIndexGlobalIndex: 3,
    confirmationAttemptsGlobalIndex: 4,
  });
  const decoded = decodeFunctions(bodyModule(body), [0x31, 0x4a, 0x5a, 85])[0]!;
  const memorySizeChecks = [...body].filter((byte, index) =>
    byte === 0x3f
    && body[index + 1] === 0x00
    && body[index + 2] === 0x41
    && body[index + 3] === 0x10
    && body[index + 4] === 0x74).length;

  assert.equal(decoded.calls.get(logoutDispatch), 1);
  assert.equal(decoded.calls.get(frameChild), 1);
  assert.equal(decoded.calls.get(frameParent), 2);
  assert.equal(decoded.calls.get(frameResolver), 3);
  assert.equal(memorySizeChecks, 10,
    "Selector traversal must bound both frame tables, callback rows, context arrays, and names");
  assert.equal(decoded.calls.get(frameDispatch), 3);
  assert.equal(decoded.messageSites[0x31], 2);
  assert.equal(decoded.messageSites[0x5a], 1,
    "the Selector index message's current numeric value is 0x5a");
  assert.equal(decoded.messageSites[0x4a], undefined,
    "the historical symbol suffix is not the current numeric message ID");
  assert.equal(decoded.messageSites[85], undefined,
    "the action must not encode low messages through the external-frame guard");
  assert.notEqual(body.findIndex((byte, index) =>
    byte === 0x28
    && body[index + 1] === 0x02
    && body[index + 2] === 0x08
    && body[index + 3] === 0x41
    && body[index + 4] === 0x01
    && body[index + 5] === 0x4b), -1,
  "logout must accept only outpost/explorable instance values 0 and 1");
});
