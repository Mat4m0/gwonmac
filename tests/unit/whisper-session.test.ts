import assert from "node:assert/strict";
import test from "node:test";
import { createWhisperSession, whisperUnread } from "../../src/shared/whisper-session.ts";

test("original log owns messages, duplicate text stays distinct, collapse preserves draft", async () => {
  const requests: string[] = [];
  const session = createWhisperSession(async (name, message) => { requests.push(`${name}:${message}`); });
  session.setAvailable(true); session.open("Romi Ranger");
  session.observe([1, 2].map(id => ({ id, sender: "Romi Ranger", message: "Hi", direction: "incoming" })));
  const key = "romi ranger";
  session.setDraft(key, "Hello"); session.setVisible(false); session.setVisible(true);
  assert.equal(session.state.selected, key);
  assert.equal(session.state.conversations[0]?.draft, "Hello");
  await session.send(key);
  assert.deepEqual(requests, ["Romi Ranger:Hello"]);
  assert.equal(session.state.conversations[0]?.messages.length, 2, "sending does not invent a log entry");
  assert.equal(whisperUnread(session.state.conversations[0]!), 2);
  session.markRead(key, 1);
  assert.equal(whisperUnread(session.state.conversations[0]!), 1);
});

test("cleanup keeps unread and drafts; recents hold only ten closed replied-to non-friends", () => {
  const session = createWhisperSession(async () => {});
  let id = 0;
  const receive = (name: string, direction: "incoming" | "outgoing") => session.observe([{ id: ++id, sender: name, message: "Hi", direction }]);
  receive("Unanswered Trader", "incoming"); session.close("unanswered trader");
  assert.equal(session.state.recent.length, 0);
  for (let i = 0; i < 12; i++) { receive(`Trader ${i}`, "outgoing"); session.close(`trader ${i}`); }
  assert.equal(session.state.recent.length, 10);
  assert.equal(session.state.recent[0]?.name, "Trader 11");
  session.open("Trader 11");
  assert.equal(session.state.recent.length, 9, "open conversations do not duplicate recents");
  session.setDraft("trader 11", "Keep this");
  receive("Unread Person", "incoming");
  session.closeRead();
  assert.equal(session.state.conversations.length, 2);
  assert.equal(session.close("trader 11"), false);
  assert.equal(session.close("trader 11", true), true);
  session.clearRecent();
  assert.equal(session.state.conversations[0]?.name, "Unread Person");
  receive("Friend", "outgoing");
  session.updateFriends({ status: "ready", sequence: 1, generation: 1, friends: [{ key: "f", character: "Friend", alias: "Friend", status: "online", mapId: 133 }] });
  session.updateFriends({ status: "waiting", reason: "unavailable" });
  session.close("friend");
  assert.equal(session.state.recent.length, 0, "pausing the friends observer does not pollute recents");
  session.reset();
  assert.equal(session.state.friends.status, "waiting", "the last friends snapshot never crosses sessions");
});

test("send failures retain drafts, concurrent sends do not duplicate, session reset invalidates completion", async () => {
  let reject: (error: Error) => void = () => {};
  let calls = 0;
  const session = createWhisperSession(() => { calls++; return new Promise<void>((_, fail) => { reject = fail; }); });
  session.setAvailable(true); session.open("Friend"); session.setDraft("friend", "A draft");
  const first = session.send("friend");
  await session.send("friend");
  assert.equal(calls, 1);
  assert.equal(session.close("friend", true), false, "a pending submission cannot be silently closed");
  reject(new Error("Busy")); await first;
  assert.equal(session.state.conversations[0]?.draft, "A draft");
  assert.equal(session.state.conversations[0]?.error, "Busy");
  const pending = session.send("friend"); session.reset(); reject(new Error("Ended")); await pending;
  assert.equal(session.state.conversations.length, 0);
  assert.equal(session.state.recent.length, 0);
});

test("muted incoming still increments unread and session bounds are explicit", () => {
  const session = createWhisperSession(async () => {});
  session.open("Friend"); session.mute("friend");
  const audible = session.observe([{ id: 1, sender: "Friend", message: "Hi", direction: "incoming" }]);
  assert.equal(audible.length, 0);
  assert.equal(whisperUnread(session.state.conversations[0]!), 1);
  for (let i = 0; i < 40; i++) session.observe([{ id: i + 2, sender: `Trader ${i}`, message: "Hi", direction: "incoming" }]);
  assert.equal(session.state.conversations.length, 32);
  assert.equal(session.state.missed, 9);
});

test("chat participants become bounded session-only suggestions without conversations", () => {
  const session = createWhisperSession(async () => {});
  for (let index = 0; index < 55; index++) {
    session.observe([{ id: index + 1, sender: `Person ${index}`, direction: "participant" }]);
  }
  session.observe([{ id: 60, sender: "Person 20", direction: "participant" }]);
  session.observe([{ id: 61, sender: "Not,A Character", direction: "participant" }]);
  assert.equal(session.state.conversations.length, 0);
  assert.equal(session.state.participants.length, 50);
  assert.equal(session.state.participants[0]?.name, "Person 20");
  assert.equal(session.state.participants.some(person => person.name === "Person 0"), false);
  assert.equal(session.state.participants.some(person => person.name === "Not,A Character"), false);
  session.setBackgroundOpacity(15);
  assert.equal(session.state.backgroundOpacity, 15);
  session.setBackgroundOpacity(14);
  assert.equal(session.state.backgroundOpacity, 15);
  session.reset();
  assert.equal(session.state.participants.length, 0);
  assert.equal(session.state.backgroundOpacity, 100);
});
