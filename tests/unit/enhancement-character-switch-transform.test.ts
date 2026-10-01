import assert from "node:assert/strict";
import test from "node:test";
import {
  characterActionExecute,
  characterActionFramePointerWithinMemory,
  characterSelectorSlot,
} from "../../src/main/certification/enhancement-character-switch-transform.js";
import { decodeFunctions } from "../../src/main/certification/wasm-instruction-evidence.js";
import type { ModuleShape } from "../../src/main/certification/enhancement-evidence-types.js";
import {
  concat,
  encodeCode,
  encodeSection,
  uleb,
  sleb,
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

const actionConfig = {
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
    dispatcherFunctionIndex: 4,
    frameChildFunctionIndex: 0,
    frameParentFunctionIndex: 1,
    frameResolverFunctionIndex: 2,
    frameDispatchFunctionIndex: 3,
    frameDispatchOffset: 0xa8,
    logoutMessageId: 0x1000_009d,
    selectorHash: 11,
    playHash: 12,
    pendingGlobalIndex: 2,
    expectedIndexGlobalIndex: 3,
    confirmationAttemptsGlobalIndex: 4,
  };

test("character switching uses only the certified internal frame dispatcher", () => {
  const { frameChildFunctionIndex: frameChild, frameParentFunctionIndex: frameParent,
    frameResolverFunctionIndex: frameResolver, frameDispatchFunctionIndex: frameDispatch,
    dispatcherFunctionIndex: logoutDispatch } = actionConfig;
  const body = characterActionExecute(actionConfig);
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

function selectorSlotModule(body: Uint8Array): Uint8Array {
  const type = concat(
    uleb(1), Uint8Array.of(0x60),
    uleb(1), Uint8Array.of(0x7f),
    uleb(1), Uint8Array.of(0x7f),
  );
  const memoryName = new TextEncoder().encode("memory");
  const slotName = new TextEncoder().encode("slot");
  return concat(
    WASM_HEADER,
    section(1, type),
    section(3, concat(uleb(1), uleb(0))),
    section(5, concat(uleb(1), Uint8Array.of(0x00), uleb(1))),
    section(7, concat(
      uleb(2),
      uleb(memoryName.byteLength), memoryName, Uint8Array.of(0x02), uleb(0),
      uleb(slotName.byteLength), slotName, Uint8Array.of(0x00), uleb(0),
    )),
    section(10, encodeCode([body])),
  );
}

test("the Selector slot reader maps account characters to carousel slots read-only", async () => {
  const layout = {
    characterArrayPointer: 104,
    characterArrayCount: 112,
    frameArray: 116,
    frameCount: 124,
    frameBytes: 0x1c8,
    frameId: 0xbc,
    frameState: 0x18c,
    frameHashId: 0x134,
  };
  const body = characterSelectorSlot({ layout, frameDispatchOffset: 0xa8, selectorHash: 11 });
  const decoded = decodeFunctions(bodyModule(body), [])[0]!;
  assert.equal(decoded.calls.size, 0, "the reader must not call game functions");
  assert.equal(body.includes(0x36), false, "the reader must not store to memory");

  const bytes = selectorSlotModule(body);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  assert.equal(WebAssembly.validate(buffer), true);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(buffer));
  const memory = instance.exports.memory as WebAssembly.Memory;
  const slot = instance.exports.slot as (accountIndex: number) => number;
  const view = new DataView(memory.buffer);
  const u32 = (at: number, value: number) => view.setUint32(at, value, true);
  const name = (at: number, value: string) => {
    for (let index = 0; index < 20; index += 1) {
      view.setUint16(at + index * 2, index < value.length ? value.charCodeAt(index) : 0, true);
    }
  };

  // Account array order: Alpha, Beta, Gamma.
  u32(layout.characterArrayPointer, 0x1000);
  u32(layout.characterArrayCount, 3);
  ["Alpha", "Beta", "Gamma"].forEach((value, index) => name(0x1000 + index * 0x84 + 0x18, value));
  // Frame 1 is the visible Selector; frame 2 has its hash but is hidden.
  u32(layout.frameArray, 0x2000);
  u32(layout.frameCount, 3);
  [0x3000, 0x3400, 0x3800].forEach((frame, index) => {
    u32(0x2000 + index * 4, frame);
    u32(frame + layout.frameId, index);
  });
  u32(0x3000 + layout.frameHashId, 99);
  u32(0x3000 + layout.frameState, 4);
  u32(0x3400 + layout.frameHashId, 11);
  u32(0x3400 + layout.frameState, 4);
  u32(0x3800 + layout.frameHashId, 11);
  // The latest non-null callback row owns the context.
  u32(0x3400 + 0xa8, 0x4000);
  u32(0x3400 + 0xb0, 2);
  u32(0x4000 + 12 + 4, 0x4100);
  u32(0x4100 + 4, 1);
  u32(0x4100 + 8, 0x4200);
  u32(0x4100 + 12, 4);
  u32(0x4100 + 16, 4);
  // Carousel: Beta, an empty purchased slot, Gamma, Alpha.
  [0x5000, 0, 0x5100, 0x5200].forEach((record, index) => u32(0x4200 + index * 4, record));
  name(0x5000 + 0x20, "Beta");
  name(0x5100 + 0x20, "Gamma");
  name(0x5200 + 0x20, "Alpha");

  assert.deepEqual([0, 1, 2].map(slot), [3, 0, 2]);
  assert.equal(slot(3), -1, "an index outside the account array reports no slot");

  name(0x5100 + 0x20, "Alpha");
  assert.equal(slot(0), -1, "a duplicate carousel name is ambiguous");
  name(0x5100 + 0x20, "Gamma");

  u32(0x3400 + layout.frameState, 0x204);
  assert.equal(slot(0), -1, "a hidden Selector reports no slot");
  u32(0x3400 + layout.frameState, 4);
  u32(0x4100 + 4, 2);
  assert.equal(slot(0), -1, "a context owned by another frame reports no slot");
});


test("Play rechecks the Selector identity and refuses a selection changed after confirmation", async () => {
  // ArenaNet owns these callbacks. Execute our real generated guard against a
  // bounded memory fixture; count messages at that external game boundary.
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return concat(uleb(bytes.length), bytes);
  };
  const signature = (parameters: number, returns: boolean) => concat(
    Uint8Array.of(0x60), uleb(parameters), new Uint8Array(parameters).fill(0x7f),
    uleb(returns ? 1 : 0), returns ? Uint8Array.of(0x7f) : new Uint8Array(),
  );
  const imports = ["child", "parent", "resolve", "frameDispatch", "logout"];
  const bytes = concat(
    WASM_HEADER,
    section(1, concat(uleb(5), signature(3, false), signature(2, true),
      signature(1, true), signature(4, false), signature(3, false))),
    section(2, concat(uleb(5), ...imports.map((name, index) => concat(
      text("game"), text(name), Uint8Array.of(0), uleb([1, 2, 2, 3, 4][index]!),
    )))),
    section(3, concat(uleb(1), uleb(0))),
    section(5, concat(uleb(1), Uint8Array.of(0), uleb(1))),
    section(6, concat(uleb(5), ...[0, 0, 0, -1, 0].map(value => concat(
      Uint8Array.of(0x7f, 1, 0x41), sleb(value), Uint8Array.of(0x0b),
    )))),
    section(7, concat(uleb(2), text("execute"), Uint8Array.of(0), uleb(5),
      text("memory"), Uint8Array.of(2), uleb(0))),
    section(10, encodeCode([characterActionExecute(actionConfig)])),
  );
  const module = await WebAssembly.compile(Uint8Array.from(bytes).buffer);
  let selectedIndex = 1;
  let playMessages = 0;
  let selectorClicks = 0;
  const frames = [1024, 1536, 2048, 2560, 3072];
  const instance = await WebAssembly.instantiate(module, { game: {
    child: () => 1,
    parent: (id: number) => id === 3 ? 4 : 2,
    resolve: (id: number) => frames[id] ?? 0,
    frameDispatch: (frame: number, message: number, _wparam: number, payload: number) => {
      if (message === 0x5a) new DataView(memory.buffer).setUint32(payload, selectedIndex, true);
      else if (frame === frames[4]! + 0xa8) playMessages += 1;
      else selectorClicks += 1;
    },
    logout: () => {},
  } });
  const memory = instance.exports.memory as WebAssembly.Memory;
  const execute = instance.exports.execute as (action: number, target: number, packet: number) => void;
  const view = new DataView(memory.buffer);
  const set = (address: number, value: number) => view.setUint32(address, value, true);
  const name = (address: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint16(address + index * 2, value.charCodeAt(index), true);
  };
  set(104, 5000); set(112, 2); set(116, 512); set(124, 5);
  frames.forEach((pointer, id) => {
    set(512 + id * 4, pointer); set(pointer + 0xbc, id);
    set(pointer + 0xb8, id); set(pointer + 0x18c, 4);
  });
  set(1024 + 0x134, 11); set(2560 + 0x134, 12);
  set(1024 + 0xa8, 3500); set(1024 + 0xb0, 1); set(3504, 3600);
  set(3604, 0); set(3608, 3800); set(3612, 2); set(3616, 2);
  set(3800, 4000); set(3804, 4200);
  name(4000 + 0x20, "Alpha"); name(4200 + 0x20, "Beta");
  name(5000 + 0x18, "Alpha"); name(5000 + 0x84 + 0x18, "Beta");
  execute(2, 1, 6000);
  assert.equal(view.getUint32(6020, true), 1, "the target was confirmed before the delay");
  selectedIndex = 0;
  execute(3, 1, 6000);
  assert.equal(view.getUint32(6020, true), 7, "changed selection must refuse Play");
  assert.equal(playMessages, 0);
  assert.equal(selectorClicks, 0, "refusal must not correct selection with another click");
  selectedIndex = 1;
  execute(3, 1, 6000);
  assert.equal(view.getUint32(6020, true), 1);
  assert.equal(playMessages, 1, "the exact target may receive one Play message");
  assert.equal(view.getUint32(6032, true), 1, "diagnostics retain the rechecked Selector index");
  execute(3, 64, 6000);
  assert.equal(view.getUint32(6020, true), 3, "an out-of-range target must refuse");
  assert.equal(playMessages, 1);
});
