import assert from "node:assert/strict";
import test from "node:test";
import { ADDRESSES, createKernel, installGameGraph, kernelExports } from "../fixtures/enhancements.ts";
import { COMPANION_ABI, COMPANION_DISPATCH_KINDS, COMPANION_FEATURE_BITS } from "../../src/shared/companion-abi.ts";
import { readCompanionWhispers } from "../../src/renderer/companion-whisper-snapshot.ts";

import { createWhisperInstallation } from "../../src/renderer/whisper-installation.ts";
import { createWhisperSession } from "../../src/shared/whisper-session.ts";
import { WHISPER_MAILBOX } from "../../src/shared/whispers.ts";

const flags = COMPANION_FEATURE_BITS.whisperObservation | COMPANION_FEATURE_BITS.playRegionObservation;
const packet = 0x64000;
const text = 0x64100;
async function fixture() {
  const k = await createKernel();
  installGameGraph(k.view);
  assert.equal(k.init({ features: flags }), 1);
  const observe = (channel = 14, body = "hello", sender = "Test Friend", template = 1, metadata = "\u0101\u0100") => {
    k.view.setUint32(packet, channel, true);
    k.view.setUint32(packet + 4, text, true);
    const line = String.fromCharCode(template) + (channel === 10 ? metadata : "") + "\u0107" + sender + "\x01\u0108" + body + "\x01\0";
    for (let i = 0; i < line.length; i++) k.view.setUint16(text + i * 2, line.charCodeAt(i), true);
    k.uiEvent(0x1000007f, packet, 0);
  };
  const read = (cursor = 0) => {
    const state = readCompanionWhispers(k.memory.buffer, ADDRESSES.whispers, cursor);
    assert.equal(state.status, "ready");
    return state;
  };
  return { ...k, observe, read };
}

test("whisper observer keeps native directions, identical messages and bounded overflow", async () => {
  const k = await fixture();
  k.observe(); k.observe(); k.observe(10, "reply", "Test Friend", 0x76e);
  k.observe(10, "unrelated"); k.observe(0, "local chat");
  assert.deepEqual(k.read().messages.map(m => [m.id, m.direction, m.message]), [
    [1, "incoming", "hello"], [2, "incoming", "hello"], [3, "outgoing", "reply"],
  ]);
  assert.equal(k.read(3).messages.length, 0);
  for (let i = 0; i < 35; i++) k.observe(14, String(i));
  assert.equal(k.read(3).dropped, 3);
  assert.equal(k.read(3).messages[0]?.message, "3");
  assert.equal(k.read(3).messages.length, 32);
});

test("whisper observer refuses malformed, disabled and unsupported-region events", async () => {
  const k = await fixture();
  k.observe(14, "a".repeat(121));
  k.observe(14, "hello", "a".repeat(21));
  assert.equal(k.read().writeCount, 0);
  assert.equal(k.read().rejectedCount, 2);
  k.observe(14, "\ud800");
  k.observe(14, "hello", "\udfff");
  assert.equal(k.read().rejectedCount, 4);
  k.observe(14, "Grüße 🌿");
  assert.equal(k.read().messages[0]?.message, "Grüße 🌿");
  k.activeFeatures(COMPANION_FEATURE_BITS.playRegionObservation);
  k.observe();
  assert.equal(k.read().writeCount, 1);
  k.activeFeatures(flags);
  k.view.setUint32(ADDRESSES.contextRoot, 0, true);
  k.observe();
  assert.equal(k.read().writeCount, 1);
});

test("native send authorization is scoped to its mailbox, character, map and active policy", async () => {
  const k = await fixture();
  const mailbox = ADDRESSES.whispers + COMPANION_ABI.whispers.snapshotBytes;
  const dispatch = kernelExports(k.instance.exports).dispatch;
  const gate = (phase: number, pointer = mailbox) => {
    dispatch(COMPANION_DISPATCH_KINDS.whisperSendGate, pointer, phase, 0, 0, 0);
    return k.view.getUint32(mailbox, true);
  };
  assert.equal(gate(0), 4);
  assert.equal(gate(1), 4);
  k.view.setUint32(ADDRESSES.character + 0x64, 42, true);
  assert.equal(gate(1), 3);
  assert.equal(gate(0), 4);
  k.view.setUint32(ADDRESSES.character + 0x198, 0, true);
  assert.equal(gate(1), 3);
  installGameGraph(k.view);
  assert.equal(gate(0), 4);
  k.activeFeatures(COMPANION_FEATURE_BITS.playRegionObservation);
  assert.equal(gate(1), 3);
  k.view.setUint32(mailbox, 7, true);
  assert.equal(gate(0, mailbox + 4), 7, "an arbitrary mailbox is never written");
});


test("outgoing native numeric metadata stays separate from recipient and body", async () => {
  const k = await fixture();
  for (const metadata of ["\u0101\u0100", "\u0101\u7fff", "\u0101\u8101\u0100", "\u0101\u8104\u8893\u04ff"]) {
    k.observe(10, "A reply 🌿", "Test Friend", 0x76e, metadata);
  }
  assert.equal(k.read().rejectedCount, 0);
  assert.equal(k.read().messages.length, 4);
  assert.ok(k.read().messages.every(m => m.sender === "Test Friend" && m.message === "A reply 🌿" && m.direction === "outgoing"));
  for (const metadata of ["", "\u0102\u0100", "\u0101\u00ff", "\u0101\u8101\u8101\u8101", "\u0101\uffff\uffff\u7fff"]) {
    k.observe(10, "No", "Test Friend", 0x76e, metadata);
  }
  assert.equal(k.read().rejectedCount, 5);
  assert.equal(k.read().messages.length, 4);
});


test("native outgoing echo completes submission, clears the draft, and adds one bubble", async () => {
  const k = await fixture();
  const adapter = createWhisperInstallation({
    enhancement_configure_whispers: () => 1,
    enhancement_send_whisper: () => {
      k.view.setUint32(ADDRESSES.whispers + COMPANION_ABI.whispers.snapshotBytes + WHISPER_MAILBOX.status, 2, true);
      return 1;
    },
  }, true);
  adapter.allocate(() => ADDRESSES.whispers);
  adapter.initialize(k.memory);
  adapter.setEnabled(true);
  const session = createWhisperSession(adapter.send);
  adapter.subscribe((messages, missed) => session.observe(messages, missed));
  session.setAvailable(true); session.open("Test Friend");
  session.setDraft("test friend", "A reply");
  try {
    const submission = session.send("test friend");
    assert.equal(session.state.conversations[0]?.sending, true);
    k.observe(10, "A reply", "Test Friend", 0x76e);
    adapter.poll();
    await submission;
    assert.equal(session.state.conversations[0]?.draft, "");
    assert.equal(session.state.conversations[0]?.error, "");
    assert.equal(session.state.conversations[0]?.messages.length, 1);
    assert.equal(session.state.missed, 0);
    adapter.poll();
    assert.equal(session.state.conversations[0]?.messages.length, 1);
  } finally { adapter.dispose(() => {}); session.dispose(); }
});
