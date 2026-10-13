/** The chat-print queue hands lines to the game thread one at a time, in order, and never grows without bound. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChatPrintInstallation } from "../../src/renderer/chat-print-installation.ts";
import { CHAT_PRINT_MAILBOX as M, CHAT_PRINT_STATUS } from "../../src/shared/chat-print.ts";

const POINTER = 64;
function setup(enqueueResults: number[] = []) {
  const memory = { buffer: new ArrayBuffer(1024) } as WebAssembly.Memory;
  const view = new DataView(memory.buffer);
  const written: string[] = [];
  const configured: [number, number][] = [];
  let enqueueCalls = 0;
  const exports = {
    enhancement_configure_chat_print: (pointer: number, on: number) => { configured.push([pointer, on]); return 1; },
    enhancement_print_chat: () => {
      enqueueCalls++;
      const result = enqueueResults.shift() ?? 1;
      if (result === 1) {
        const length = view.getUint32(POINTER + M.length, true);
        written.push(String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint16(POINTER + M.source + i * 2, true))));
      }
      return result;
    },
  } as unknown as WebAssembly.Exports;
  const chat = createChatPrintInstallation(exports, true);
  chat.allocate(() => POINTER);
  chat.initialize(memory);
  chat.setEnabled(true);
  const printed = () => view.setUint32(POINTER + M.status, CHAT_PRINT_STATUS.printed, true);
  const drain = () => { const before = written.length; for (let i = 0; i < 20; i++) { chat.poll(); printed(); } return written.slice(before); };
  return { chat, written, printed, drain, calls: () => enqueueCalls };
}

test("lines reach the game thread in order, one at a time", () => {
  const { chat, written, printed, calls } = setup();
  for (const line of ["a", "bb", "ccc"]) assert.equal(chat.print(line), true);
  chat.poll();
  assert.deepEqual(written, ["a"]);
  chat.poll(); chat.poll();
  assert.equal(calls(), 1, "no second write until the first line is printed");
  printed(); chat.poll();
  assert.deepEqual(written, ["a", "bb"]);
  printed(); chat.poll();
  assert.deepEqual(written, ["a", "bb", "ccc"]);
});

test("a refused enqueue is retried on the next frame without losing the line", () => {
  const { chat, written, calls } = setup([0, 0]);
  chat.print("hello");
  chat.poll(); chat.poll();
  assert.deepEqual([written.length, calls()], [0, 2]);
  chat.poll();
  assert.deepEqual(written, ["hello"]);
});

test("a backlog keeps only the newest eight lines", () => {
  const { chat, drain } = setup();
  for (let i = 1; i <= 12; i++) chat.print(`line ${i}`);
  assert.deepEqual(drain(), Array.from({ length: 8 }, (_, i) => `line ${i + 5}`));
});

test("turning chat print off drops queued lines and refuses new ones", () => {
  const { chat, written, drain } = setup();
  chat.print("one"); chat.print("two");
  chat.setEnabled(false);
  assert.equal(chat.print("three"), false);
  chat.setEnabled(true);
  assert.deepEqual(drain(), []);
  assert.deepEqual(written, []);
  assert.equal(chat.print("four"), true);
  assert.deepEqual(drain(), ["four"]);
});
