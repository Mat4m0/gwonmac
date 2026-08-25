import assert from "node:assert/strict";
import { test } from "node:test";
import type { KnownEnhancementBuild } from "../../src/main/certification/enhancement-builds.js";
import { ENHANCEMENT_TRANSFORM_ABI } from "../../src/shared/enhancement-contracts.js";
import {
  preGameDiagnosticReader,
  preGameStateReader,
} from "../../src/main/certification/enhancement-pre-game-transform.js";
import {
  concat,
  encodeCode,
  encodeSection,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";

const certificate = {
  labels: { play: 101, selector: 102, yes: 103, no: 104, reconnectDialog: 105 },
  labelHashes: {
    play: 101,
    selector: 102,
    yes: 103,
    no: 104,
    reconnectDialog: 105,
  },
  layout: {
    frameArray: 0,
    frameCount: 4,
    frameBytes: 0x80,
    frameId: 0x04,
    frameHashId: 0x1c,
    frameState: 0x20,
    contextRoot: 8,
    gameContextSlot: 1,
    characterContext: 0x08,
    currentInstanceType: 0x0c,
  },
} as NonNullable<KnownEnhancementBuild["preGameControls"]>;

function section(id: number, body: Uint8Array): Uint8Array {
  return encodeSection({ id, body });
}

function moduleBytes(): Uint8Array {
  const typeSection = concat(
    uleb(2),
    Uint8Array.of(0x60), uleb(2), Uint8Array.of(0x7f, 0x7f),
    uleb(1), Uint8Array.of(0x7f),
    Uint8Array.of(0x60), uleb(0), uleb(1), Uint8Array.of(0x7f),
  );
  const name = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return concat(uleb(bytes.length), bytes);
  };
  return concat(
    WASM_HEADER,
    section(1, typeSection),
    section(3, concat(uleb(3), uleb(0), uleb(1), uleb(1))),
    section(5, concat(uleb(1), Uint8Array.of(0x00), uleb(1))),
    section(7, concat(
      uleb(3),
      name("memory"), Uint8Array.of(0x02), uleb(0),
      name("diagnostic"), Uint8Array.of(0x00), uleb(1),
      name("state"), Uint8Array.of(0x00), uleb(2),
    )),
    section(10, encodeCode([
      // Kept as an unrelated function to prove the reader needs no runtime
      // callback to compute its already-certified label hashes.
      concat(uleb(0), Uint8Array.of(0x20), uleb(0), Uint8Array.of(0x0b)),
      preGameDiagnosticReader(certificate),
      preGameStateReader(certificate, 1),
    ])),
  );
}

test("pre-game state scans exact live label hashes and loading context", async () => {
  const bytes = moduleBytes();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert.equal(WebAssembly.validate(buffer), true);
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(buffer));
  const memory = instance.exports.memory as WebAssembly.Memory;
  const state = instance.exports.state as () => number;
  const diagnostic = instance.exports.diagnostic as () => number;
  const view = new DataView(memory.buffer);
  const abi = ENHANCEMENT_TRANSFORM_ABI << 24;

  view.setUint32(certificate.layout.frameArray, 32, true);
  view.setUint32(certificate.layout.frameCount, 6, true);
  const frames = [0, 128, 256, 384, 512, 640];
  const hashes = [0, certificate.labels.play, certificate.labels.selector,
    certificate.labels.yes, certificate.labels.no,
    certificate.labels.reconnectDialog];
  for (let id = 1; id <= 5; id += 1) {
    const frame = frames[id]!;
    view.setUint32(32 + id * 4, frame, true);
    view.setUint32(frame + certificate.layout.frameId, id, true);
    view.setUint32(frame + certificate.layout.frameHashId, hashes[id]!, true);
    view.setUint32(frame + certificate.layout.frameState, 0x204, true);
  }

  assert.equal(diagnostic(), abi | 0x1fc0ff);
  assert.equal(state(), 0);

  view.setUint32(32 + 4 * 4, 70_000, true);
  assert.equal(diagnostic() & 0x8000_0000, 0);
  view.setUint32(32 + 4 * 4, frames[4]!, true);

  view.setUint32(frames[1]! + certificate.layout.frameState, 4, true);
  view.setUint32(frames[2]! + certificate.layout.frameState, 4, true);
  assert.equal(diagnostic(), abi | 0x1fe3ff);
  assert.equal(state(), 1);

  view.setUint32(frames[1]! + certificate.layout.frameState, 0x204, true);
  view.setUint32(frames[2]! + certificate.layout.frameState, 0x204, true);
  view.setUint32(frames[3]! + certificate.layout.frameState, 4, true);
  view.setUint32(frames[4]! + certificate.layout.frameState, 4, true);
  assert.equal(diagnostic(), abi | 0x1fdcff);
  assert.equal(state(), 0, "generic Yes/No buttons are not reconnect authority");
  view.setUint32(frames[5]! + certificate.layout.frameState, 4, true);
  assert.equal(diagnostic(), abi | 0x7fdcff);
  assert.equal(state(), 2);

  // A stale table slot is rejected even if its hash and visible state match.
  view.setUint32(frames[3]! + certificate.layout.frameId, 99, true);
  assert.equal(diagnostic(), abi | 0x3fc8bf);
  assert.equal(state(), 0);
  view.setUint32(frames[3]! + certificate.layout.frameId, 3, true);

  for (let id = 1; id <= 5; id += 1) {
    view.setUint32(frames[id]! + certificate.layout.frameState, 0x204, true);
  }
  view.setUint32(certificate.layout.contextRoot, 700, true);
  view.setUint32(700 + certificate.layout.gameContextSlot * 4, 720, true);
  view.setUint32(720 + certificate.layout.characterContext, 760, true);
  view.setUint32(760 + certificate.layout.currentInstanceType, 2, true);
  assert.equal(state(), 3);
});
