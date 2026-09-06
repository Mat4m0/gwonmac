import assert from "node:assert/strict";
import test from "node:test";
import { concat, encodeCode, encodeSection, sleb, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { resignConfigure, resignDrain, resignEnqueue, resignExecute } from "../../src/main/certification/enhancement-resign-transform.js";

const bytes = (...values: number[]) => Uint8Array.of(...values);
const name = (value: string) => concat(uleb(value.length), new TextEncoder().encode(value));
const section = (id: number, body: Uint8Array) => encodeSection({ id, body });

function fixture() {
  return concat(WASM_HEADER,
    section(1, concat(uleb(4),
      bytes(0x60, 0, 0), bytes(0x60, 1, 0x7f, 1, 0x7f),
      bytes(0x60, 0, 1, 0x7f), bytes(0x60, 2, 0x7f, 0x7f, 0))),
    section(2, concat(uleb(1), name("game"), name("send"), bytes(0, 3))),
    section(3, bytes(4, 1, 2, 0, 0)),
    section(5, bytes(1, 0, 1)),
    section(6, concat(uleb(3), ...[65_520, 0, 0].map(value =>
      concat(bytes(0x7f, 1, 0x41), sleb(value), bytes(0x0b))))),
    section(7, concat(uleb(6),
      name("configure"), bytes(0, 1), name("enqueue"), bytes(0, 2),
      name("drain"), bytes(0, 4), name("memory"), bytes(2, 0),
      name("stack"), bytes(3, 0), name("pending"), bytes(3, 1))),
    section(10, encodeCode([
      resignConfigure(1, 2), resignEnqueue(1, 2), resignExecute(0),
      concat(uleb(0), resignDrain(1, 2, 3), bytes(0x0b)),
    ])),
  );
}

test("native Resign sends only the fixed line once, on drain, and cancels when disabled", async () => {
  const sent: Array<{ text: string; agent: number }> = [];
  const module = await WebAssembly.compile(Uint8Array.from(fixture()).buffer);
  const instance = await WebAssembly.instantiate(module, { game: { send(pointer: number, agent: number) {
    const units = new Uint16Array(memory.buffer, pointer, 8);
    assert.equal(units[7], 0);
    sent.push({ text: String.fromCharCode(...units.subarray(0, 7)), agent });
  } } });
  const memory = instance.exports.memory as WebAssembly.Memory;
  const configure = instance.exports.configure as (enabled: number) => number;
  const enqueue = instance.exports.enqueue as () => number;
  const drain = instance.exports.drain as () => void;
  const stack = instance.exports.stack as WebAssembly.Global;
  const pending = instance.exports.pending as WebAssembly.Global;
  assert.equal(enqueue(), 0);
  configure(1);
  assert.equal(enqueue(), 1);
  assert.equal(enqueue(), 0, "a pending request cannot be duplicated");
  assert.deepEqual(sent, [], "requesting does not call the game on the renderer stack");
  drain(); drain();
  assert.deepEqual(sent, [{ text: "/resign", agent: 0 }]);
  assert.equal(stack.value, 65_520, "native stack ownership is restored");
  enqueue(); configure(0); drain();
  assert.equal(sent.length, 1, "disabling cancels the pending command");
  configure(1); drain();
  assert.equal(sent.length, 1, "re-enabling cannot replay an old request");
  pending.value = -2;
  assert.equal(enqueue(), 0, "other commands keep ownership of the shared mailbox");
  configure(0);
  assert.equal(pending.value, -2, "disabling Resign must not cancel Travel");
});
