/**
 * Owns the disposable whisper view derived from this game's observed chat log.
 * Unread and recent contacts are derived from these records; nothing is stored.
 */
import { whisperLine, type ObservedWhisper } from "./whispers.js";
import type { TravelFriends } from "./friends.js";

export type WhisperSound = "off" | "background" | "every";
export type WhisperConversation = Readonly<{
  key: string; name: string; messages: readonly ObservedWhisper[];
  draft: string; readThrough: number; muted: boolean; sent: boolean;
  sending: boolean; error: string; activity: number; trimmed: boolean;
}>;
type RecentPerson = Readonly<{ key: string; name: string; activity: number }>;
export type WhisperSessionState = Readonly<{
  conversations: readonly WhisperConversation[]; recent: readonly RecentPerson[];
  friends: TravelFriends; selected: string | null; visible: boolean;
  available: boolean; sound: WhisperSound; missed: number;
}>;
export const whisperPersonKey = (name: string) => name.trim().toLocaleLowerCase("en-US");
export const whisperUnread = (conversation: WhisperConversation) => conversation.messages
  .filter(message => message.direction === "incoming" && message.id > conversation.readThrough).length;
const initial = (): WhisperSessionState => ({ conversations: [], recent: [],
  friends: { status: "waiting", reason: "unavailable" }, selected: null,
  visible: false, available: false, sound: "background", missed: 0 });
const MAX_CONVERSATIONS = 32;
const MAX_MESSAGES = 200;

export function createWhisperSession(send: (recipient: string, message: string) => Promise<void>) {
  let state = initial();
  let generation = 0;
  const listeners = new Set<(state: WhisperSessionState) => void>();
  const publish = (patch: Partial<WhisperSessionState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const friendKeys = () => new Set(state.friends.status === "ready"
    ? state.friends.friends.map(friend => whisperPersonKey(friend.character || friend.alias)) : []);
  const update = (key: string, patch: Partial<WhisperConversation>) => publish({
    conversations: state.conversations.map(c => c.key === key ? { ...c, ...patch } : c),
  });
  const ensure = (name: string): WhisperConversation | null => {
    const key = whisperPersonKey(name);
    const existing = state.conversations.find(c => c.key === key);
    if (existing) return existing;
    if (state.conversations.length >= MAX_CONVERSATIONS) return null;
    const conversation: WhisperConversation = { key, name: name.trim(), messages: [], draft: "",
      readThrough: 0, muted: false, sent: false, sending: false, error: "", activity: 0, trimmed: false };
    publish({ conversations: [...state.conversations, conversation], recent: state.recent.filter(p => p.key !== key) });
    return conversation;
  };
  const api = {
    get state() { return state; },
    subscribe(listener: (state: WhisperSessionState) => void) {
      listeners.add(listener); listener(state);
      return () => { listeners.delete(listener); };
    },
    setAvailable(available: boolean) { if (available !== state.available) publish({ available }); },
    setVisible(visible: boolean) { publish({ visible }); },
    setSound(sound: WhisperSound) { publish({ sound }); },
    updateFriends(friends: TravelFriends) {
      // The shared observer pauses outside the picker. Retain this session's last
      // observed friends so closing a conversation does not misclassify a friend.
      if (friends.status !== "ready" && state.friends.status === "ready") return;
      publish({ friends });
      const keys = friendKeys();
      if (state.recent.some(p => keys.has(p.key))) publish({ recent: state.recent.filter(p => !keys.has(p.key)) });
    },
    open(name: string) {
      whisperLine(name.trim(), "x");
      const conversation = ensure(name);
      if (!conversation) throw new Error("Close a conversation before starting another (32 open).");
      publish({ selected: conversation.key, visible: true });
    },
    showPicker() { publish({ selected: null, visible: true }); },
    observe(messages: readonly ObservedWhisper[], missed = 0) {
      let overflow = missed;
      const audible: ObservedWhisper[] = [];
      for (const message of messages) {
        const conversation = ensure(message.sender);
        if (!conversation) { overflow++; continue; }
        if (conversation.messages.some(m => m.id === message.id)) continue;
        update(conversation.key, {
          messages: [...conversation.messages, message].slice(-MAX_MESSAGES),
          trimmed: conversation.trimmed || conversation.messages.length >= MAX_MESSAGES,
          sent: conversation.sent || message.direction === "outgoing", activity: message.id,
        });
        if (message.direction === "incoming" && !conversation.muted) audible.push(message);
      }
      if (overflow) publish({ missed: state.missed + overflow });
      return audible;
    },
    setDraft(key: string, draft: string) { update(key, { draft, error: "" }); },
    markRead(key: string, through: number) {
      const c = state.conversations.find(c => c.key === key);
      if (c && through > c.readThrough) update(key, { readThrough: through });
    },
    mute(key: string) {
      const c = state.conversations.find(c => c.key === key);
      if (c) update(key, { muted: !c.muted });
    },
    close(key: string, discardDraft = false): boolean {
      const c = state.conversations.find(c => c.key === key);
      if (!c || c.sending || (c.draft.trim() && !discardDraft)) return false;
      const recent = state.recent.filter(p => p.key !== key);
      if (c.sent && !friendKeys().has(key)) recent.push({ key, name: c.name, activity: c.activity });
      publish({ conversations: state.conversations.filter(c => c.key !== key),
        recent: recent.sort((a, b) => b.activity - a.activity).slice(0, 10),
        selected: state.selected === key ? null : state.selected });
      return true;
    },
    closeRead() {
      for (const c of state.conversations) if (!whisperUnread(c) && !c.draft.trim() && !c.sending) api.close(c.key);
    },
    removeRecent(key: string) { publish({ recent: state.recent.filter(p => p.key !== key) }); },
    clearRecent() { publish({ recent: [] }); },
    async send(key: string) {
      const c = state.conversations.find(c => c.key === key);
      if (!c || c.sending || !state.available) return;
      const requestGeneration = generation;
      try {
        whisperLine(c.name, c.draft);
        update(key, { sending: true, error: "" });
        await send(c.name, c.draft);
        if (generation !== requestGeneration) return;
        const current = state.conversations.find(c => c.key === key);
        update(key, { sending: false, ...(current?.draft === c.draft ? { draft: "" } : {}) });
      } catch (error) {
        if (generation === requestGeneration) update(key, { sending: false,
          error: error instanceof Error ? error.message : "Whisper could not be submitted. Your draft is kept." });
      }
    },
    reset() { generation++; publish(initial()); },
    dispose() { generation++; state = initial(); listeners.clear(); },
  };
  return api;
}
export type WhisperSession = ReturnType<typeof createWhisperSession>;
