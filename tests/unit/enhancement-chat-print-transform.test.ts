/** Local chat lines: only bounded printable ASCII reaches the producer, once, after the game's own validator. */
import assert from "node:assert/strict";
import test from "node:test";
import { concat, encodeCode, encodeSection, sleb, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { CHAT_PRINT_CHANNEL, chatPrintConfigure, chatPrintDrain, chatPrintEnqueue } from "../../src/main/certification/enhancement-chat-print-transform.js";
import { CHAT_PRINT_MAILBOX as M, CHAT_PRINT_UNITS } from "../../src/shared/chat-print.js";

const bytes = (...values: number[]) => Uint8Array.of(...values);
const name = (value: string) => concat(uleb(value.length), new TextEncoder().encode(value));
const section = (id: number, body: Uint8Array) => encodeSection({ id, body });

async function fixture() {
  // types: print (i32,i32)->(), configure (i32,i32)->i32, enqueue ()->i32, drain ()->(), validate (i32)->i32
  const wasm = concat(WASM_HEADER,
    section(1, concat(uleb(5), bytes(0x60, 2, 0x7f, 0x7f, 0), bytes(0x60, 2, 0x7f, 0x7f, 1, 0x7f),
      bytes(0x60, 0, 1, 0x7f), bytes(0x60, 0, 0), bytes(0x60, 1, 0x7f, 1, 0x7f))),
    section(2, concat(uleb(2), name("game"), name("print"), bytes(0, 0), name("game"), name("validate"), bytes(0, 4))),
    section(3, bytes(3, 1, 2, 3)), section(5, bytes(1, 0, 1)),
    section(6, concat(uleb(3), ...[0, 0, 0].map(value => concat(bytes(0x7f, 1, 0x41), sleb(value), bytes(0x0b))))),
    section(7, concat(uleb(5), name("configure"), bytes(0, 2), name("enqueue"), bytes(0, 3), name("drain"), bytes(0, 4),
      name("memory"), bytes(2, 0), name("pending"), bytes(3, 0))),
    section(10, encodeCode([chatPrintConfigure(0, 1, 2), chatPrintEnqueue(0, 1, 2),
      concat(uleb(0), chatPrintDrain(0, 1, 2, { validator: 1, producer: 0 }), bytes(0x0b))])),
  );
  const printed: { channel: number; units: number[] }[] = [];
  const validator = { accepts: true, calls: 0 };
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(Uint8Array.from(wasm).buffer), { game: {
    print(channel: number, pointer: number) {
      const units = new Uint16Array(memory.buffer, pointer, CHAT_PRINT_UNITS + 4);
      printed.push({ channel, units: [...units.subarray(0, units.indexOf(0) + 1)] });
    },
    validate(pointer: number) { validator.calls++; assert.equal(pointer, 1024 + M.queued); return validator.accepts ? 1 : 0; },
  } });
  const memory = instance.exports.memory as WebAssembly.Memory;
  const pointer = 1024;
  return {
    configure: instance.exports.configure as (pointer: number, enabled: number) => number,
    enqueue: instance.exports.enqueue as () => number,
    drain: instance.exports.drain as () => void,
    pending: instance.exports.pending as WebAssembly.Global,
    status: () => new DataView(memory.buffer).getUint32(pointer + M.status, true),
    pointer, printed, validator,
    write(text: string) {
      const view = new DataView(memory.buffer);
      view.setUint32(pointer + M.length, text.length, true);
      for (let i = 0; i < text.length; i++) view.setUint16(pointer + M.source + i * 2, text.charCodeAt(i), true);
    },
  };
}
const literal = (text: string) => [0x108, 0x107, ...[...text].map(c => c.charCodeAt(0)), 0x1, 0];

test("a line prints once on the notice channel as a literal encoded string", async () => {
  const f = await fixture();
  const line = "[gwonmac] Grail of Might ends in 1 minute.";
  f.write(line);
  assert.equal(f.enqueue(), 0, "refused before configuration");
  assert.equal(f.configure(f.pointer, 1), 1);
  assert.equal(f.enqueue(), 1);
  assert.equal(f.enqueue(), 0, "one line at a time");
  f.drain(); f.drain();
  assert.deepEqual(f.printed, [{ channel: CHAT_PRINT_CHANNEL, units: literal(line) }]);
  assert.equal(f.status(), 2);
  f.write("x".repeat(CHAT_PRINT_UNITS)); assert.equal(f.enqueue(), 1, "the longest line fits"); f.drain();
  assert.deepEqual(f.printed[1]!.units, literal("x".repeat(CHAT_PRINT_UNITS)));
});

test("refuses empty, long, markup, control and non-ASCII text without queueing", async () => {
  const f = await fixture();
  f.configure(f.pointer, 1);
  for (const text of ["", "x".repeat(CHAT_PRINT_UNITS + 1), "a<b", "a>b", "tab\there", "Café", "del\x7f"]) {
    f.write(text);
    assert.equal(f.enqueue(), 0, JSON.stringify(text));
    assert.equal(f.pending.value, 0, JSON.stringify(text));
  }
  f.drain();
  assert.deepEqual(f.printed, []);
});

test("a rejected line, a disabled mailbox, or another queued command prints nothing", async () => {
  const f = await fixture();
  f.configure(f.pointer, 1);
  f.validator.accepts = false; f.write("ok"); assert.equal(f.enqueue(), 1); f.drain();
  assert.equal(f.validator.calls, 1);
  f.validator.accepts = true; f.write("ok"); assert.equal(f.enqueue(), 1);
  assert.equal(f.configure(0, 0), 1); f.drain();
  assert.equal(f.configure(f.pointer, 1), 1);
  f.pending.value = -6; f.write("ok"); assert.equal(f.enqueue(), 0, "the shared game-thread slot is taken");
  f.drain();
  assert.deepEqual(f.printed, []);
});
