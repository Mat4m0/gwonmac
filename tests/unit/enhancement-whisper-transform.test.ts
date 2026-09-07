import assert from "node:assert/strict";
import test from "node:test";
import { concat, encodeCode, encodeSection, sleb, uleb, WASM_HEADER } from "../../src/main/core/wasm-binary.js";
import { whisperConfigure, whisperDrain, whisperEnqueue } from "../../src/main/certification/enhancement-whisper-transform.js";
import { WHISPER_MAILBOX as M, whisperLine } from "../../src/shared/whispers.js";

const bytes = (...values: number[]) => Uint8Array.of(...values);
const name = (value: string) => concat(uleb(value.length), new TextEncoder().encode(value));
const section = (id: number, body: Uint8Array) => encodeSection({ id, body });

async function fixture() {
  const wasm = concat(WASM_HEADER,
    section(1, concat(uleb(5), bytes(0x60, 2, 0x7f, 0x7f, 0),
      bytes(0x60, 2, 0x7f, 0x7f, 1, 0x7f), bytes(0x60, 0, 1, 0x7f), bytes(0x60, 0, 0), bytes(0x60, 6, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0))),
    section(2, concat(uleb(2), name("game"), name("send"), bytes(0, 0), name("game"), name("gate"), bytes(0, 4))),
    section(3, bytes(3, 1, 2, 3)), section(4, bytes(1, 0x70, 0, 1)), section(5, bytes(1, 0, 1)),
    section(6, concat(uleb(4), ...[0, 0, 0, 1].map(value =>
      concat(bytes(0x7f, 1, 0x41), sleb(value), bytes(0x0b))))),
    section(7, concat(uleb(5), name("configure"), bytes(0, 2), name("enqueue"), bytes(0, 3),
      name("drain"), bytes(0, 4), name("memory"), bytes(2, 0), name("pending"), bytes(3, 0))),
    section(9, bytes(1, 0, 0x41, 0, 0x0b, 1, 1)),
    section(10, encodeCode([whisperConfigure(0, 1, 2), whisperEnqueue(0, 1, 2, { hookGlobal: 3, dispatchType: 4 }),
      concat(uleb(0), whisperDrain(0, 1, 2, 0, { hookGlobal: 3, dispatchType: 4 }), bytes(0x0b))])),
  );
  const sent: string[] = [];
  const policy = { allowed: true };
  const module = await WebAssembly.compile(Uint8Array.from(wasm).buffer);
  const instance = await WebAssembly.instantiate(module, { game: { send(pointer: number, agent: number) {
    assert.equal(agent, 0);
    const units = new Uint16Array(memory.buffer, pointer, 140);
    const end = units.indexOf(0);
    assert.ok(end > 0);
    sent.push(String.fromCharCode(...units.subarray(0, end)));
  }, gate(kind: number, pointer: number) {
    assert.equal(kind, 5);
    new DataView(memory.buffer).setUint32(pointer + M.status, policy.allowed ? 4 : 3, true);
  } } });
  const memory = instance.exports.memory as WebAssembly.Memory;
  const pointer = 1024;
  return {
    configure: instance.exports.configure as (pointer: number, enabled: number) => number,
    enqueue: instance.exports.enqueue as () => number,
    drain: instance.exports.drain as () => void,
    pending: instance.exports.pending as WebAssembly.Global,
    pointer, sent, policy,
    write(line: string) {
      const view = new DataView(memory.buffer);
      view.setUint32(pointer + M.length, line.length, true);
      for (let i = 0; i < line.length; i++) view.setUint16(pointer + M.source + i * 2, line.charCodeAt(i), true);
    },
  };
}

test("whispers submit once through native chat, snapshot input, and cancel without replay", async () => {
  const f = await fixture();
  f.write(whisperLine("Romi", "Ready?"));
  assert.equal(f.enqueue(), 0);
  assert.equal(f.configure(f.pointer, 1), 1);
  assert.equal(f.enqueue(), 1);
  assert.equal(f.enqueue(), 0);
  assert.deepEqual(f.sent, []);
  f.write(whisperLine("Kai", "Different draft"));
  f.drain(); f.drain();
  assert.deepEqual(f.sent, ['"Romi,Ready?']);
  assert.equal(f.enqueue(), 1);
  f.configure(0, 0); f.drain();
  f.configure(f.pointer, 1); f.drain();
  assert.equal(f.sent.length, 1);
  f.pending.value = -2;
  assert.equal(f.enqueue(), 0);
  f.configure(0, 0);
  assert.equal(f.pending.value, -2);
});

test("native whisper boundary refuses invalid pointers, commands, names and lengths", async () => {
  const f = await fixture();
  for (const pointer of [0, 1, 65_532, 0xffff_fffc]) assert.equal(f.configure(pointer, 1), 0);
  assert.equal(f.configure(f.pointer, 1), 1);
  for (const line of ['/resign', '"Romi,', '",hello', '"Romi\n,hello', '"Romi,hello\n/resign', '"A'.padEnd(25, 'a') + ',Hi', '"Romi,' + 'x'.repeat(121), '"Romi,\ud800', '"Romi,\udfff']) {
    f.write(line);
    assert.equal(f.enqueue(), 0, JSON.stringify(line));
    f.drain();
  }
  assert.deepEqual(f.sent, []);
  f.write(whisperLine("Romi", "Grüße 🌿, ready?"));
  assert.equal(f.enqueue(), 1); f.drain();
  assert.deepEqual(f.sent, ['"Romi,Grüße 🌿, ready?']);
});

test("typed whisper entry rejects delimiters and malformed Unicode without truncation", () => {
  for (const recipient of ['', 'Romi,Kai', 'Romi\n', '\ud800']) {
    assert.throws(() => whisperLine(recipient, 'hello'));
  }
  for (const message of ['', '\n', '\udfff', 'x'.repeat(121)]) {
    assert.throws(() => whisperLine('Romi', message));
  }
  assert.throws(() => whisperLine('A'.repeat(20), 'x'.repeat(120)));
});


test("native whisper drain rechecks policy and never replays a withdrawn request", async () => {
  const f = await fixture();
  f.configure(f.pointer, 1); f.write(whisperLine("Romi", "Hello"));
  f.policy.allowed = false;
  assert.equal(f.enqueue(), 0);
  f.policy.allowed = true;
  assert.equal(f.enqueue(), 1);
  f.policy.allowed = false;
  f.drain();
  f.policy.allowed = true;
  f.drain();
  assert.deepEqual(f.sent, []);
});


test("native sender accepts its exact UTF-16 capacity and refuses one extra unit", async () => {
  const f = await fixture();
  f.configure(f.pointer, 1);
  const recipient = 'A'.repeat(20);
  const line = whisperLine(recipient, 'x'.repeat(115));
  assert.equal(line.length, 137);
  f.write(line);
  assert.equal(f.enqueue(), 1);
  f.drain();
  assert.deepEqual(f.sent, [line]);
  assert.throws(() => whisperLine(recipient, 'x'.repeat(116)));
  f.write(line + 'x');
  assert.equal(f.enqueue(), 0);
  f.drain();
  assert.deepEqual(f.sent, [line]);
});
