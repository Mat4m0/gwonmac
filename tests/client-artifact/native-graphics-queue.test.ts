/** Executes the official flush assertion to verify the publisher's queue guard. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nativeGraphicsBusy, NATIVE_RENDER_REFERENCE_FUNCTIONS } from "../../src/main/certification/native-render-reference.js";
import { functionBodySha256, wasmEvidence } from "../../src/main/certification/wasm-evidence.js";
import { concat, encodeCode, encodeSection, parseCode, sectionById, splitSections, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { encodeName } from "../../src/main/certification/cartography-transform-internals.js";

test("graphics guard rejects every phase that triggers the official GrDev flush assertion", async () => {
  assert.ok(process.env.GW_CLIENT_WASM);
  const input = new Uint8Array(await readFile(process.env.GW_CLIENT_WASM));
  const evidence = wasmEvidence(input); assert.ok(evidence); const module = evidence.moduleView();
  for (const [index, hash] of NATIVE_RENDER_REFERENCE_FUNCTIONS) {
    assert.equal(functionBodySha256(module, index), hash, `native guard owner ${index}`);
  }
  const sections = splitSections(input);
  const body = parseCode(sectionById(sections, 10))[2902 - module.functionImportCount]!;
  const sites = evidence.decodeFunctions([]).find(row => row.functionIndex === 2902)?.callSites; assert.ok(sites);
  const peers = [...sites.keys()];
  const edits = [...sites].flatMap(([target, calls]) => calls.map(site => ({...site, target})))
    .sort((a, b) => a.offset - b.offset);
  let cursor = 0; const parts: Uint8Array[] = [];
  for (const edit of edits) {
    parts.push(body.slice(cursor, edit.offset + 1), uleb(peers.indexOf(edit.target)));
    cursor = edit.operandEnd;
  }
  const section = (id: number, bytes: Uint8Array) => encodeSection({id, body: bytes});
  const type = module.functionTypeIndices[2902]!;
  const fixture = concat(WASM_HEADER, section(1, sectionById(sections, 1)),
    section(2, concat(uleb(peers.length), ...peers.map(index => concat(encodeName("peer"), encodeName(String(index)),
      Uint8Array.of(0), uleb(module.functionTypeIndices[index]!))))),
    section(3, concat(uleb(2), uleb(type), uleb(type))), section(5, Uint8Array.of(1, 0, 48)),
    section(7, concat(uleb(3), encodeName("flush"), Uint8Array.of(0), uleb(peers.length),
      encodeName("busy"), Uint8Array.of(0), uleb(peers.length + 1), encodeName("memory"), Uint8Array.of(2, 0))),
    section(10, encodeCode([concat(...parts, body.slice(cursor)), concat(Uint8Array.of(0), nativeGraphicsBusy(0), Uint8Array.of(0x0b))])));
  // Execute the real queue state machine; only backend work and assertion reporting are stubbed.
  const imports = Object.fromEntries(peers.map(index => [String(index), (...args: number[]) => {
    if (index === 322) throw new Error(`native assertion line ${args[2]}`);
    return 0;
  }]));
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(fixture)), {peer: imports});
  const memory = exports.memory; assert.ok(memory instanceof WebAssembly.Memory);
  const view = new DataView(memory.buffer);
  const flush = exports.flush, busy = exports.busy;
  assert.ok(typeof flush === "function" && typeof busy === "function");
  assert.equal(busy(0), 1, "no device defers publishing");
  const device = 65536;
  view.setUint32(2734712, device, true);
  for (const phase of [0, 1, 2, 4]) {
    view.setUint32(device + 460, phase, true);
    assert.equal(busy(0), 1);
    assert.throws(() => flush(device), /native assertion line 998/);
  }
  view.setUint32(device + 460, 3, true);
  assert.equal(busy(0), 0);
  assert.doesNotThrow(() => flush(device));
  assert.equal(view.getUint32(device + 460, true), 3, "native flush restores the idle sentinel");
});
