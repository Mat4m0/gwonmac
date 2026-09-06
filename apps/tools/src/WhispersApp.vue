<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { whisperPersonKey, whisperUnread, type WhisperSession, type WhisperSound } from "../../../src/shared/whisper-session";
import { WHISPER_LINE_UNITS, WHISPER_MESSAGE_UNITS } from "../../../src/shared/whispers";
import type { FriendPresence, TravelFriend } from "../../../src/shared/friends";
import { useFloatingWindow } from "./use-floating-window";
import {
  restoreFloatingPosition,
  serializeFloatingPosition,
} from "./floating-window-placement";

const props = defineProps<{ session: WhisperSession }>();
const WINDOW_PLACEMENT_KEY = "gwonmac.whispers-window-placement";
const ICON_PLACEMENT_KEY = "gwonmac.whispers-icon-placement";
const ICON_SIZE = 36;
const VIEWPORT_MARGIN = 8;
const state = shallowRef(props.session.state);
const unsubscribe = props.session.subscribe(value => { state.value = value; });
const visible = computed(() => state.value.visible);
const { panel, resizeGrip, panelStyle, startDrag } = useFloatingWindow({
  mode: "embedded", visible, initialPosition: { left: 72, top: 80 },
  minWidth: 288, minHeight: 300, viewportMargin: VIEWPORT_MARGIN,
  placementStorageKey: WINDOW_PLACEMENT_KEY,
});
const selected = computed(() => state.value.conversations.find(c => c.key === state.value.selected));
const unread = computed(() => state.value.conversations.reduce((total, c) => total + whisperUnread(c), 0));
const windowStyle = computed(() => ({
  ...(panelStyle.value ?? {}),
  "--whisper-background-percent": `${state.value.backgroundOpacity}%`,
}));
const search = ref("");
const suggestionIndex = ref(-1);
const suggestFriends = ref(true);
const suggestChat = ref(true);
const pickerError = ref("");
const closing = ref<string | null>(null);
const optionsMenu = ref<HTMLDetailsElement | null>(null);
function dismissOptions(event: Event) {
  if (optionsMenu.value?.open && !optionsMenu.value.contains(event.target as Node)) optionsMenu.value.open = false;
}
function escapeOptions(event: KeyboardEvent) {
  if (event.key === "Escape" && optionsMenu.value?.open) {
    event.stopPropagation(); optionsMenu.value.open = false;
    optionsMenu.value.querySelector("summary")?.focus();
  }
}
function showPicker() {
  if (optionsMenu.value) optionsMenu.value.open = false;
  props.session.showPicker();
  void nextTick(() => document.getElementById("whisper-person")?.focus());
}
const iconViewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
  margin: VIEWPORT_MARGIN,
});
function restoredIconPosition() {
  let serialized: string | null = null;
  try { serialized = window.localStorage.getItem(ICON_PLACEMENT_KEY); }
  catch { /* Browser storage refusal leaves the icon at its ordinary default. */ }
  const restored = restoreFloatingPosition(
    serialized,
    iconViewport(),
    { width: ICON_SIZE, height: ICON_SIZE },
  );
  return restored ? { left: restored.left, top: restored.top } : { left: 20, top: 160 };
}
const icon = ref(restoredIconPosition());
const iconButton = ref<HTMLButtonElement | null>(null);
const atBottom = ref(true);
const initializedTranscripts = new Set<string>();
const firstUnreadByConversation = new Map<string, number | null>();
const scrollPositions = new Map<string, number>();
const liveEdgeByConversation = new Map<string, boolean>();
const historyNavigation = new Map<string, { index: number; originalDraft: string }>();
const activeLog = () => panel.value?.querySelector<HTMLElement>('[data-transcript]:not([hidden])') ?? null;
const transcriptFor = (key: string) => [...(panel.value?.querySelectorAll<HTMLElement>("[data-transcript-key]") ?? [])]
  .find(log => log.dataset.transcriptKey === key) ?? null;
const openKeys = computed(() => new Set(state.value.conversations.map(c => c.key)));
const observedFriends = computed(() => state.value.friends.status === "ready" ? state.value.friends.friends : []);
function friendFor(name: string): TravelFriend | undefined {
  const key = whisperPersonKey(name);
  return observedFriends.value.find(friend => whisperPersonKey(friend.character) === key || whisperPersonKey(friend.alias) === key);
}
const selectedFriend = computed(() => selected.value ? friendFor(selected.value.name) : undefined);
const presenceLabel = (status: FriendPresence) => ({
  online: "Online", away: "Away", "do-not-disturb": "Do not disturb",
  offline: "Offline", unknown: "Status unknown",
})[status];
const firstUnreadFor = (key: string) => firstUnreadByConversation.get(key) ?? null;
watch(() => state.value.conversations.map(conversation => conversation.key), keys => {
  const active = new Set(keys);
  for (const key of initializedTranscripts) if (!active.has(key)) initializedTranscripts.delete(key);
  for (const store of [firstUnreadByConversation, scrollPositions, liveEdgeByConversation, historyNavigation]) {
    for (const key of store.keys()) if (!active.has(key)) store.delete(key);
  }
});
const friends = computed(() => state.value.friends.status === "ready"
  ? state.value.friends.friends.filter(f => (f.status === "online" || f.status === "away" || f.status === "do-not-disturb") && !openKeys.value.has(whisperPersonKey(f.character || f.alias))
    && `${f.character} ${f.alias}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())) : []);
const recent = computed(() => state.value.recent.filter(p => p.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())));
type Suggestion = Readonly<{ key: string; name: string; source: "friend" | "chat"; detail: string; searchable: string; priority: number; activity: number }>;
const suggestions = computed(() => {
  const query = search.value.trim().toLocaleLowerCase("en-US");
  if (!query) return [];
  const people = new Map<string, Suggestion>();
  const add = (person: Suggestion) => { if (!people.has(person.key)) people.set(person.key, person); };
  if (suggestFriends.value) {
    for (const friend of observedFriends.value) {
      const name = friend.character || friend.alias;
      add({ key: whisperPersonKey(name), name, source: "friend", detail: `Friend · ${presenceLabel(friend.status)}`,
        searchable: `${name} ${friend.alias}`, priority: 0, activity: 0 });
    }
  }
  if (suggestChat.value) {
    for (const person of state.value.participants) add({
      ...person, source: "chat", detail: "Chat", searchable: person.name, priority: 1,
    });
  }
  const matchRank = (person: Suggestion) => {
    const value = person.searchable.toLocaleLowerCase("en-US");
    if (value === query) return 0;
    if (value.startsWith(query)) return 1;
    if (value.split(/\s+/u).some(word => word.startsWith(query))) return 2;
    return value.includes(query) ? 3 : 4;
  };
  return [...people.values()].filter(person => matchRank(person) < 4)
    .sort((a, b) => matchRank(a) - matchRank(b) || a.priority - b.priority
      || b.activity - a.activity || a.name.localeCompare(b.name))
    .slice(0, 8);
});
const maxLength = computed(() => Math.min(WHISPER_MESSAGE_UNITS, WHISPER_LINE_UNITS - (selected.value?.name.length ?? 0) - 2));
function open(name: string) {
  try {
    props.session.open(name); pickerError.value = ""; closing.value = null;
    void nextTick(() => document.getElementById(`draft-${state.value.selected}`)?.focus());
  }
  catch (error) { pickerError.value = error instanceof Error ? error.message : "Enter a character name."; }
}
function searchInput() {
  suggestionIndex.value = -1;
  pickerError.value = "";
}
function searchKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape" && search.value) {
    event.preventDefault(); search.value = ""; suggestionIndex.value = -1; return;
  }
  if (event.key === "Tab" && suggestions.value.length) {
    event.preventDefault(); search.value = suggestions.value[0]!.name; suggestionIndex.value = 0; return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (!suggestions.value.length) return;
  event.preventDefault();
  suggestionIndex.value = event.key === "ArrowDown"
    ? (suggestionIndex.value + 1) % suggestions.value.length
    : (suggestionIndex.value <= 0 ? suggestions.value.length : suggestionIndex.value) - 1;
  void nextTick(() => document.getElementById(`whisper-suggestion-${suggestionIndex.value}`)
    ?.scrollIntoView({ block: "nearest" }));
}
function submitSearch() {
  open(suggestions.value[suggestionIndex.value]?.name ?? search.value);
}
function draftInput(key: string, event: Event) {
  historyNavigation.delete(key);
  props.session.setDraft(key, (event.target as HTMLInputElement).value);
}
function cycleHistory(key: string, event: KeyboardEvent) {
  if (event.isComposing || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  const conversation = state.value.conversations.find(item => item.key === key);
  if (!conversation) return;
  const history = conversation.messages.filter(message => message.direction === "outgoing").map(message => message.message);
  const current = historyNavigation.get(key);
  if (!history.length || (event.key === "ArrowDown" && !current)) return;
  event.preventDefault();
  if (event.key === "ArrowUp") {
    const next = current ? Math.max(0, current.index - 1) : history.length - 1;
    historyNavigation.set(key, { index: next, originalDraft: current?.originalDraft ?? conversation.draft });
    props.session.setDraft(key, history[next]!);
  } else if (current && current.index < history.length - 1) {
    const next = current.index + 1;
    historyNavigation.set(key, { ...current, index: next });
    props.session.setDraft(key, history[next]!);
  } else if (current) {
    historyNavigation.delete(key);
    props.session.setDraft(key, current.originalDraft);
  }
  const input = event.currentTarget as HTMLInputElement;
  void nextTick(() => {
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
function submit(key: string) {
  historyNavigation.delete(key);
  void props.session.send(key);
}
function close(key: string, discard = false) {
  const restoreKeyboard = panel.value?.contains(document.activeElement);
  if (optionsMenu.value) optionsMenu.value.open = false;
  if (!props.session.close(key, discard)) { closing.value = key; return; }
  closing.value = null;
  if (optionsMenu.value) optionsMenu.value.open = false;
  if (restoreKeyboard) void nextTick(() => {
    const id = state.value.selected ? `draft-${state.value.selected}` : "whisper-person";
    document.getElementById(id)?.focus({ preventScroll: true });
  });
}
function markVisibleRead() {
  const log = activeLog();
  if (!log || !selected.value || !visible.value) return;
  scrollPositions.set(selected.value.key, log.scrollTop);
  atBottom.value = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  liveEdgeByConversation.set(selected.value.key, atBottom.value);
  if (atBottom.value && document.hasFocus()) {
    const last = selected.value.messages.at(-1);
    if (last) props.session.markRead(selected.value.key, last.id);
  }
}
async function latest() {
  await nextTick();
  const log = activeLog();
  if (log) log.scrollTop = log.scrollHeight;
  markVisibleRead();
}
watch(() => state.value.selected, async (key, previousKey) => {
  closing.value = null;
  if (previousKey) {
    const previousLog = transcriptFor(previousKey);
    if (previousLog) scrollPositions.set(previousKey, previousLog.scrollTop);
  }
  const conversation = selected.value;
  if (!conversation) return;
  const firstVisit = !initializedTranscripts.has(conversation.key);
  if (firstVisit) {
    initializedTranscripts.add(conversation.key);
    firstUnreadByConversation.set(conversation.key,
      conversation.messages.find(m => m.direction === "incoming" && m.id > conversation.readThrough)?.id ?? null);
  }
  await nextTick();
  const log = activeLog();
  if (firstVisit && log) {
    const marker = log.querySelector<HTMLElement>('[data-first-unread]');
    log.scrollTop = marker ? marker.offsetTop - 12 : log.scrollHeight;
  } else if (log) {
    log.scrollTop = scrollPositions.get(key!) ?? log.scrollTop;
  }
  markVisibleRead();
});
watch(() => [state.value.selected, selected.value?.messages.at(-1)?.id] as const, async (next, previous) => {
  const follow = next[0] === previous?.[0] && visible.value
    && (next[0] ? (liveEdgeByConversation.get(next[0]) ?? atBottom.value) : false);
  await nextTick();
  if (follow) await latest();
  else markVisibleRead();
});
watch(visible, async value => {
  if (!value) {
    const log = activeLog();
    if (log && selected.value) scrollPositions.set(selected.value.key, log.scrollTop);
    return;
  }
  await nextTick();
  const log = activeLog();
  if (log && selected.value) log.scrollTop = scrollPositions.get(selected.value.key) ?? log.scrollTop;
  markVisibleRead();
});

let audio: AudioContext | null = null;
let lastSoundId = Math.max(0, ...state.value.conversations.flatMap(c => c.messages.map(m => m.id)));
function enableAudio() {
  if (state.value.sound === "off" || typeof AudioContext === "undefined") return;
  audio ??= new AudioContext();
  void audio.resume().catch(() => {});
}
watch(() => state.value.conversations, conversations => {
  const fresh = conversations.flatMap(c => c.messages.filter(m => m.id > lastSoundId)
    .map(m => ({ message: m, muted: c.muted })));
  lastSoundId = Math.max(lastSoundId, ...fresh.map(m => m.message.id));
  const background = !document.hasFocus() || !visible.value || !panel.value?.contains(document.activeElement);
  if (!fresh.some(m => m.message.direction === "incoming" && !m.muted)
    || state.value.sound === "off" || (state.value.sound === "background" && !background)
    || !audio || audio.state !== "running") return;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.frequency.value = 660;
  volume.gain.setValueAtTime(0.08, audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
  oscillator.connect(volume); volume.connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + 0.18);
  oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
});
function soundChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as WhisperSound;
  props.session.setSound(value);
  if (value !== "off") enableAudio();
}
function opacityChange(event: Event) {
  props.session.setBackgroundOpacity(Number((event.target as HTMLInputElement).value));
}
function persistIconPosition() {
  const serialized = serializeFloatingPosition(
    icon.value,
    iconViewport(),
    { width: ICON_SIZE, height: ICON_SIZE },
  );
  if (serialized === null) return;
  try { window.localStorage.setItem(ICON_PLACEMENT_KEY, serialized); }
  catch { /* A UI preference must not make the surface unusable when storage fails. */ }
}
function fitIcon() {
  const fitted = {
    left: Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - ICON_SIZE - VIEWPORT_MARGIN, icon.value.left)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - ICON_SIZE - VIEWPORT_MARGIN, icon.value.top)),
  };
  const changed = fitted.left !== icon.value.left || fitted.top !== icon.value.top;
  icon.value = fitted;
  if (changed) persistIconPosition();
}
let dragged = false;
function dragIcon(event: PointerEvent) {
  if (event.button !== 0) return;
  const button = iconButton.value;
  if (!button) return;
  dragged = false;
  const start = { x: event.clientX, y: event.clientY, ...icon.value };
  button.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4 && !dragged) return;
    dragged = true;
    icon.value = { left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y }; fitIcon();
  };
  const finish = () => {
    if (dragged) persistIconPosition();
    button.removeEventListener("pointermove", move);
    button.removeEventListener("pointerup", finish);
    button.removeEventListener("pointercancel", cancel);
    button.removeEventListener("lostpointercapture", finish);
  };
  const cancel = () => { dragged = true; finish(); };
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", finish);
}
function toggle() {
  if (dragged) { dragged = false; return; }
  enableAudio(); props.session.setVisible(!visible.value);
}
function moveIcon(event: KeyboardEvent) {
  if (!event.altKey || !event.key.startsWith("Arrow")) return;
  event.preventDefault();
  icon.value = { left: icon.value.left + (event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0),
    top: icon.value.top + (event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0) }; fitIcon();
  persistIconPosition();
}
onMounted(() => {
  document.addEventListener("pointerdown", dismissOptions);
  window.addEventListener("resize", fitIcon); window.addEventListener("focus", markVisibleRead);
  window.addEventListener("pagehide", persistIconPosition);
  // Game interaction unlocks sound too; opening this panel is not required.
  document.addEventListener("pointerdown", enableAudio, { once: true });
  document.addEventListener("keydown", enableAudio, { once: true });
  enableAudio(); fitIcon();
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", dismissOptions);
  unsubscribe(); window.removeEventListener("resize", fitIcon); window.removeEventListener("focus", markVisibleRead);
  window.removeEventListener("pagehide", persistIconPosition); persistIconPosition();
  document.removeEventListener("pointerdown", enableAudio); document.removeEventListener("keydown", enableAudio);
  void audio?.close();
});
</script>

<template>
  <button ref="iconButton" class="ui-button ui-reading-surface whisper-launcher" :style="{ left: `${icon.left}px`, top: `${icon.top}px` }"
    :aria-label="`Whispers, ${unread} unread. Drag to move, or use Alt and arrow keys.`" :aria-expanded="visible" aria-controls="whisper-window"
    title="Whispers · drag to move" @pointerdown="dragIcon" @keydown="moveIcon" @click="toggle">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.49 3 2 6.59 2 11c0 2.91 1.9 5.51 5 6.93V21c0 .38.21.73.55.89c.14.07.29.11.45.11c.21 0 .42-.07.6-.2l3.74-2.8c5.36-.14 9.66-3.68 9.66-8s-4.49-8-10-8"/></svg>
    <span v-if="unread" class="whisper-badge" aria-hidden="true">{{ unread > 99 ? '99+' : unread }}</span>
  </button>
  <section v-show="visible" id="whisper-window" ref="panel" class="ui-frame ui-reading-surface whisper-window" data-variant="quiet" :style="windowStyle" aria-label="Whispers" @keydown="escapeOptions">
    <header class="whisper-head" @pointerdown="startDrag">
      <button v-if="selected" data-variant="quiet" class="ui-button whisper-control whisper-icon" aria-label="Conversations" title="Conversations" @click="showPicker">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        <span v-if="unread" class="whisper-back-count">{{ unread > 99 ? '99+' : unread }}</span>
      </button>
      <div class="whisper-heading" :data-conversation="selected ? '' : undefined">
        <h2>{{ selected?.name ?? 'Whispers' }}</h2>
        <small v-if="selectedFriend" class="whisper-presence-label"><span class="whisper-presence" :data-presence="selectedFriend.status" />{{ presenceLabel(selectedFriend.status) }}</small>
      </div>
      <details ref="optionsMenu" class="whisper-options">
        <summary data-variant="quiet" class="ui-button whisper-control whisper-icon" aria-label="Chat options" title="Chat options"><svg viewBox="0 0 24 24" aria-hidden="true"><circle class="whisper-icon-dot" cx="5" cy="12" r="1.5"/><circle class="whisper-icon-dot" cx="12" cy="12" r="1.5"/><circle class="whisper-icon-dot" cx="19" cy="12" r="1.5"/></svg></summary>
        <div class="ui-raised ui-scroll whisper-menu">
          <label for="whisper-sound">Sound alerts</label>
          <select id="whisper-sound" class="ui-select" :value="state.sound" @change="soundChange"><option value="off">Off</option><option value="background">When chat is in background</option><option value="every">Every incoming whisper</option></select>
          <label class="ui-range-field whisper-opacity" for="whisper-opacity"><span><span>Background</span><output>{{ state.backgroundOpacity }}%</output></span><input id="whisper-opacity" class="ui-range" type="range" min="15" max="100" step="5" :value="state.backgroundOpacity" @input="opacityChange"/></label>
          <button v-if="selected" data-variant="quiet" class="ui-button whisper-control" :aria-pressed="selected.muted" @click="session.mute(selected.key)">{{ selected.muted ? 'Unmute this conversation' : 'Mute this conversation' }}</button>
          <button v-if="selected" data-variant="quiet" class="ui-button whisper-control whisper-danger" :disabled="selected.sending" :aria-label="`Close conversation with ${selected.name}`" @click="close(selected.key)">Close conversation</button>
          <div class="whisper-menu-divider" />
          <button data-variant="quiet" class="ui-button whisper-control" @click="session.closeRead()">Close read conversations</button>
          <small>Keeps unread chats and drafts.</small>
          <button v-if="state.recent.length" data-variant="quiet" class="ui-button whisper-control" @click="session.clearRecent()">Clear recent people</button>
        </div>
      </details>
      <button data-variant="quiet" class="ui-button whisper-control whisper-icon" aria-label="Collapse whispers" title="Minimize" @click="session.setVisible(false)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
    </header>
    <p v-if="!state.available" class="whisper-notice" role="status">Unavailable here. Use original chat.</p>
    <p v-if="state.missed" class="whisper-notice" role="status">{{ state.missed }} messages could not be kept. Check original chat.</p>
    <div v-if="closing" class="whisper-notice" role="alert"><p>Discard the unsent draft and close this conversation?</p><div class="whisper-inline"><button data-variant="quiet" class="ui-button whisper-control whisper-danger" @click="close(closing, true)">Discard and close</button><button data-variant="quiet" class="ui-button whisper-control" @click="closing = null">Keep chatting</button></div></div>
    <div v-show="!selected" class="ui-scroll whisper-picker">
      <form class="ui-input-group whisper-search" @submit.prevent="submitSearch"><label class="whisper-sr-only" for="whisper-person">Character name</label><input id="whisper-person" v-model="search" maxlength="20" placeholder="Find a friend or enter a name" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="whisper-suggestions" :aria-expanded="Boolean(search.trim() && suggestions.length)" :aria-activedescendant="suggestionIndex >= 0 ? `whisper-suggestion-${suggestionIndex}` : undefined" @input="searchInput" @keydown="searchKeydown"/><button data-variant="primary" class="ui-button whisper-control" type="submit" :disabled="!search.trim()">Chat</button></form>
      <p v-if="pickerError" class="whisper-notice" role="alert">{{ pickerError }}</p>
      <div class="whisper-source-filters" role="group" aria-label="Suggestion sources">
        <span>Suggest from</span>
        <button data-variant="quiet" class="ui-button whisper-control whisper-source-toggle" type="button" :aria-pressed="suggestFriends" @click="suggestFriends = !suggestFriends; suggestionIndex = -1">Friends</button>
        <button data-variant="quiet" class="ui-button whisper-control whisper-source-toggle" type="button" :aria-pressed="suggestChat" @click="suggestChat = !suggestChat; suggestionIndex = -1">Chat</button>
      </div>
      <template v-if="search.trim()">
        <div v-if="suggestions.length" id="whisper-suggestions" role="listbox" aria-label="Character suggestions">
          <button v-for="(person, index) in suggestions" :id="`whisper-suggestion-${index}`" :key="person.key" data-variant="quiet" class="ui-button whisper-control whisper-person-open whisper-suggestion" role="option" :aria-selected="suggestionIndex === index" @click="open(person.name)"><span class="whisper-person-main"><span v-if="person.source === 'friend' && friendFor(person.name)" class="whisper-presence" :data-presence="friendFor(person.name)!.status"/><strong>{{ person.name }}</strong></span><small>{{ person.detail }}</small></button>
        </div>
        <p v-else class="whisper-empty">{{ !suggestFriends && !suggestChat ? 'Suggestions are off.' : 'No matching friends or chat names.' }} Press Chat to use this exact name.</p>
        <p v-if="suggestions.length" class="whisper-completion-hint">↑↓ choose · Tab completes</p>
      </template>
      <template v-else>
      <p v-if="!state.conversations.length" class="whisper-empty whisper-onboarding">Start a conversation with a friend, or enter any character name above.</p>
      <template v-if="state.conversations.length">
        <h3>Conversations</h3>
        <div v-for="conversation in state.conversations.filter(c => c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))" :key="conversation.key" class="whisper-person" :data-unread="whisperUnread(conversation) ? '' : undefined">
          <button data-variant="quiet" class="ui-button whisper-control whisper-person-open" @click="open(conversation.name)"><span class="whisper-person-main"><span v-if="friendFor(conversation.name)" class="whisper-presence" :data-presence="friendFor(conversation.name)!.status" /><span class="whisper-person-copy"><strong>{{ conversation.name }}</strong><small>{{ conversation.draft ? 'Draft: ' + conversation.draft : conversation.messages.at(-1)?.message || 'No messages yet' }}</small></span></span><span v-if="whisperUnread(conversation)" class="whisper-count">{{ whisperUnread(conversation) }}</span></button>
          <button data-variant="quiet" class="ui-button whisper-control whisper-icon" :aria-label="`Close conversation with ${conversation.name}`" :disabled="conversation.sending" @click="close(conversation.key)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
        </div>
      </template>
      <h3>Available friends</h3>
      <p v-if="state.friends.status !== 'ready'" class="whisper-empty">Friends are unavailable. You can still message any character above.</p>
      <p v-else-if="!friends.length" class="whisper-empty">Friends who are online appear here. You can still message any character above.</p>
      <button v-for="friend in friends" :key="friend.key" data-variant="quiet" class="ui-button whisper-control whisper-person-open" @click="open(friend.character || friend.alias)"><span class="whisper-person-main"><span class="whisper-presence" :data-presence="friend.status" /><span class="whisper-person-copy"><strong>{{ friend.character || friend.alias }}</strong><small v-if="friend.character && friend.alias !== friend.character">{{ friend.alias }}</small></span></span><small class="whisper-status-copy">{{ presenceLabel(friend.status) }}</small></button>
      <template v-if="recent.length">
        <h3>Recent people</h3>
        <div v-for="person in recent" :key="person.key" class="whisper-person"><button data-variant="quiet" class="ui-button whisper-control whisper-person-open" @click="open(person.name)">{{ person.name }}</button><button data-variant="quiet" class="ui-button whisper-control whisper-icon" :aria-label="`Remove ${person.name} from recent people`" @click="session.removeRecent(person.key)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>
      </template>
      </template>
    </div>
    <template v-for="conversation in state.conversations" :key="conversation.key">
      <div v-show="state.selected === conversation.key" class="whisper-conversation">
        <div class="ui-scroll whisper-transcript" data-transcript :data-transcript-key="conversation.key" :hidden="state.selected !== conversation.key" tabindex="0" :aria-label="`Messages with ${conversation.name}`" @scroll="markVisibleRead" @focus="markVisibleRead">
          <p v-if="conversation.trimmed" class="whisper-empty">Earlier messages remain in original chat.</p>
          <p v-if="!conversation.messages.length" class="whisper-empty">Say hello to {{ conversation.name }}.</p>
          <article v-for="(message, index) in conversation.messages" :key="message.id" class="whisper-message" :data-direction="message.direction" :data-grouped="index > 0 && conversation.messages[index - 1]?.direction === message.direction && message.id !== firstUnreadFor(conversation.key) ? '' : undefined" :data-first-unread="message.id === firstUnreadFor(conversation.key) ? '' : undefined">
            <small v-if="message.id === firstUnreadFor(conversation.key)" class="whisper-unread-marker">New messages</small>
            <div class="ui-chat-bubble whisper-bubble" :data-direction="message.direction"><span class="whisper-sr-only">{{ message.direction === 'outgoing' ? 'You' : conversation.name }}: </span>{{ message.message }}</div>
          </article>
        </div>
        <button v-if="!atBottom && whisperUnread(conversation)" data-variant="quiet" class="ui-button whisper-control whisper-latest" @click="latest">{{ whisperUnread(conversation) }} new · Show latest</button>
        <p v-if="conversation.error" class="whisper-notice" role="alert">{{ conversation.error }}</p>
        <form class="whisper-compose" @submit.prevent="submit(conversation.key)">
          <label class="whisper-sr-only" :for="`draft-${conversation.key}`">Message {{ conversation.name }}</label>
          <div class="ui-input-group whisper-input-row"><input :id="`draft-${conversation.key}`" :value="conversation.draft" placeholder="Message…" autocomplete="off" @input="draftInput(conversation.key, $event)" @keydown="cycleHistory(conversation.key, $event)"/><button data-variant="primary" class="ui-button whisper-control whisper-send" :disabled="!state.available || conversation.sending || !conversation.draft.trim() || conversation.draft.length > maxLength" type="submit" :aria-label="conversation.sending ? 'Submitting…' : 'Send'" :title="conversation.sending ? 'Submitting…' : 'Send'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg><span class="whisper-sr-only">{{ conversation.sending ? 'Submitting…' : 'Send' }}</span></button></div>
          <small v-if="conversation.draft.length > maxLength - 20" :class="{ 'whisper-danger': conversation.draft.length > maxLength }">{{ conversation.draft.length }}/{{ maxLength }}{{ conversation.draft.length > maxLength ? ' · Shorten your message to send.' : '' }}</small>
        </form>
      </div>
    </template>
    <button ref="resizeGrip" class="whisper-resize" aria-label="Resize whispers"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19 7-7m-1 7 1-1"/></svg></button>
  </section>
</template>

<style scoped>
.ui-reading-surface { color: var(--ui-text); font: 14px/1.5 var(--ui-font-reading); font-synthesis: none; text-shadow: none; color-scheme: dark; }
.ui-reading-surface *, .ui-reading-surface *::before, .ui-reading-surface *::after { box-sizing: border-box; text-shadow: none; }
.ui-reading-surface svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.ui-reading-surface :focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.ui-reading-surface ::selection { background: var(--ui-accent); color: var(--ui-accent-ink); }
.ui-reading-surface small { color: var(--ui-text-muted); font: 12px/1.5 var(--ui-font-reading); }
.ui-reading-surface input, .ui-reading-surface select { min-width: 0; width: 100%; color: var(--ui-text); caret-color: var(--ui-focus); font: inherit; }
.ui-reading-surface input::placeholder { color: var(--ui-text-muted); opacity: 1; }
.whisper-window { --whisper-background-percent: 100%; --whisper-panel-fill: color-mix(in srgb, var(--ui-panel-fill) var(--whisper-background-percent), transparent); --whisper-well-fill: color-mix(in srgb, var(--ui-well) var(--whisper-background-percent), transparent); --whisper-incoming-fill: color-mix(in srgb, color-mix(in srgb, var(--ui-info) 12%, var(--ui-well)) var(--whisper-background-percent), transparent); --whisper-outgoing-fill: color-mix(in srgb, color-mix(in srgb, var(--ui-success) 16%, var(--ui-well)) var(--whisper-background-percent), transparent); --whisper-edge: color-mix(in srgb, var(--ui-outline) var(--whisper-background-percent), transparent); --whisper-line: color-mix(in srgb, var(--ui-line-soft) var(--whisper-background-percent), transparent); position: fixed; width: 340px; height: 360px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); display: flex; flex-direction: column; pointer-events: auto; isolation: isolate; background: transparent; box-shadow: 0 0 0 1px var(--whisper-edge); }
.whisper-window::before { background: color-mix(in srgb, var(--ui-text-muted) var(--whisper-background-percent), transparent); }
.whisper-head { display: flex; align-items: center; gap: 2px; min-height: 42px; padding: 4px 8px; border-bottom: 1px solid var(--whisper-line); background: var(--whisper-panel-fill); border-radius: var(--ui-radius) var(--ui-radius) 0 0; cursor: grab; }
.whisper-heading { flex: 1; min-width: 0; margin: 0 6px; display: flex; align-items: baseline; gap: 8px; }
.whisper-head h2 { min-width: 0; font: var(--ui-font-weight-semibold) 15px/1.3 var(--ui-font-interface); color: var(--ui-text-bright); margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.whisper-heading[data-conversation] h2 { color: var(--ui-chat-incoming-accent); }
.whisper-presence-label { display: flex; align-items: center; gap: 5px; line-height: 1.25 !important; flex: 0 0 auto; }
.whisper-icon { width: 30px; height: 30px; min-height: 30px; padding: 0; flex-shrink: 0; position: relative; line-height: 0; }
.ui-reading-surface .whisper-icon svg { display: block; width: 18px; height: 18px; }
.ui-reading-surface .whisper-icon-dot { fill: currentColor; stroke: none; }
.whisper-launcher { position: fixed; width: 36px; height: 36px; min-height: 36px; border-radius: var(--ui-radius-pill); pointer-events: auto; touch-action: none; padding: 8px; }
.ui-reading-surface.whisper-launcher svg { width: 19px; height: 19px; fill: currentColor; stroke: none; }
.whisper-badge, .whisper-count { min-width: 20px; padding: 1px 5px; border-radius: var(--ui-radius-lg); background: var(--ui-chat-incoming-accent); color: var(--ui-accent-ink); font: 600 12px/18px var(--ui-font-reading); text-align: center; box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-chat-incoming-accent) 36%, var(--ui-outline)); }
.whisper-badge { position: absolute; top: -5px; right: -6px; min-width: 18px; padding: 0 4px; font-size: 10px; line-height: 17px; }
.whisper-back-count { position: absolute; right: -2px; bottom: -2px; min-width: 15px; padding: 0 3px; border-radius: var(--ui-radius-pill); background: var(--ui-chat-incoming-accent); color: var(--ui-accent-ink); font: 600 9px/15px var(--ui-font-reading); text-align: center; box-shadow: 0 0 0 1px var(--ui-well-fill); }
.whisper-bubble { max-width: 80%; padding: 6px 10px; font-size: 13px; line-height: 1.4; background: var(--whisper-incoming-fill); box-shadow: inset 0 0 0 1px color-mix(in srgb, color-mix(in srgb, var(--ui-chat-incoming-accent) 18%, transparent) var(--whisper-background-percent), transparent); }
.whisper-bubble[data-direction="outgoing"] { background: var(--whisper-outgoing-fill); box-shadow: inset 0 0 0 1px color-mix(in srgb, color-mix(in srgb, var(--ui-chat-outgoing-accent) 24%, transparent) var(--whisper-background-percent), transparent); }
.whisper-picker, .whisper-transcript { overflow: auto; }
.whisper-picker { padding: 10px 10px 12px; flex: 1; min-height: 0; background: var(--whisper-panel-fill); }
.whisper-search, .whisper-inline { display: flex; gap: 8px; }
.whisper-search { padding: 4px; border-color: var(--whisper-edge); border-radius: var(--ui-radius); background: var(--whisper-well-fill); box-shadow: inset 0 0 0 1px var(--whisper-line); }
.whisper-search input { flex: 1; padding: 4px 8px; }
.whisper-search button { min-height: 30px; padding-inline: 12px; border-radius: var(--ui-radius-sm); }
.whisper-search button:disabled, .whisper-send:disabled { opacity: .45; }
.whisper-picker h3 { font: 600 11px/1.5 var(--ui-font-reading); color: color-mix(in srgb, var(--ui-accent) 74%, var(--ui-text-muted)); margin: 16px 6px 5px; letter-spacing: .01em; }
.whisper-person { position: relative; display: flex; align-items: center; gap: 2px; border-radius: var(--ui-radius-sm); }
.whisper-person[data-unread] { background: color-mix(in srgb, var(--ui-chat-incoming-accent) 8%, transparent); }
.whisper-person-open { display: flex; align-items: center; justify-content: space-between; width: 100%; min-width: 0; min-height: 36px; padding: 4px 6px; text-align: left; }
.whisper-person-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.whisper-person-copy { min-width: 0; }
.whisper-person-open strong { color: var(--ui-text-bright); font-weight: 500; }
.whisper-person-open small { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 240px; color: var(--ui-text-faint); }
.whisper-person-open > small { flex-shrink: 0; }
.whisper-presence { width: 8px; height: 8px; border-radius: var(--ui-radius-pill); flex: 0 0 auto; background: var(--ui-text-faint); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-text-faint) 15%, transparent); }
.whisper-presence[data-presence="online"] { background: var(--ui-success); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-success) 16%, transparent); }
.whisper-presence[data-presence="away"] { background: var(--ui-warning); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-warning) 16%, transparent); }
.whisper-presence[data-presence="do-not-disturb"] { background: var(--ui-danger); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-danger) 16%, transparent); }
.whisper-presence[data-presence="offline"] { background: var(--ui-text-faint); }
.whisper-status-copy { margin-left: 10px; color: var(--ui-text-muted) !important; }
.whisper-conversation { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.whisper-transcript { flex: 1; min-height: 40px; padding: 12px 10px; overscroll-behavior: contain; scroll-padding-block: 12px; background: var(--whisper-panel-fill); box-shadow: inset 0 1px 0 var(--whisper-line), inset 0 -1px 0 var(--whisper-line); }
.whisper-message { display: flex; flex-direction: column; align-items: flex-start; margin-top: 10px; }
.whisper-message:first-of-type { margin-top: 0; }
.whisper-message[data-grouped] { margin-top: 4px; }
.whisper-message[data-direction="outgoing"] { align-items: flex-end; }
.whisper-unread-marker { align-self: stretch; display: flex; align-items: center; gap: 12px; margin: 0 0 16px; color: var(--ui-chat-incoming-accent) !important; text-align: center; }
.whisper-unread-marker::before, .whisper-unread-marker::after { content: ''; height: 1px; background: color-mix(in srgb, var(--ui-chat-incoming-accent) 42%, transparent); flex: 1; }
.whisper-compose { padding: 8px 10px 10px; background: var(--whisper-panel-fill); }
.whisper-input-row { display: flex; align-items: center; gap: 6px; padding: 4px; border-color: var(--whisper-edge); border-radius: var(--ui-radius-pill); background: var(--whisper-well-fill); box-shadow: inset 0 0 0 1px var(--whisper-line); }
.whisper-input-row input { padding: 4px 8px; flex: 1; border-radius: var(--ui-radius-swell); }
.whisper-input-row:has(input:focus-visible) { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.ui-reading-surface .whisper-input-row input:focus-visible { outline: none; box-shadow: none; }
.whisper-send { border-radius: var(--ui-radius-pill); min-height: 32px; width: 32px; height: 32px; padding: 6px; flex-shrink: 0; background: var(--whisper-outgoing-fill) !important; }
.whisper-compose > small { display: block; text-align: right; margin-top: 4px; }
.whisper-latest { align-self: center; color: var(--ui-chat-incoming-accent); }
.whisper-empty { max-width: 32ch; color: var(--ui-text-muted); margin: 8px 6px; font-size: 12px; line-height: 1.45; text-wrap: pretty; }
.whisper-onboarding { margin-top: 10px; }
.whisper-completion-hint { margin: 8px 6px 0; color: var(--ui-text-faint); font-size: 11px; }
.whisper-suggestion[aria-selected="true"] { background: var(--whisper-incoming-fill); color: var(--ui-selection-ink); }
.whisper-source-filters { display: flex; align-items: center; gap: 4px; min-width: 0; margin: 8px 6px 10px; color: var(--ui-text-muted); }
.whisper-source-filters > span { margin-right: auto; font-size: 11px; }
.whisper-source-toggle { min-height: 24px; padding: 2px 8px; font-size: 11px; }
.whisper-source-toggle[aria-pressed="true"] { background: var(--whisper-incoming-fill); color: var(--ui-selection-ink); box-shadow: inset 0 0 0 1px var(--whisper-line); }
.whisper-notice { margin: 0; padding: 6px 12px; font-size: 12px; background: var(--whisper-well-fill); }
.whisper-notice p { margin: 0 0 8px; }
.whisper-danger { color: var(--ui-danger) !important; }
.whisper-options { position: relative; cursor: default; }
.whisper-options summary { list-style: none; }
.whisper-options summary::-webkit-details-marker { display: none; }
.whisper-menu { position: absolute; top: 34px; right: 0; width: 238px; max-height: min(330px, calc(100vh - 120px)); overflow: auto; padding: 10px; z-index: 2; border-color: var(--whisper-edge); background: var(--whisper-panel-fill); box-shadow: 0 0 0 1px var(--whisper-edge); }
.whisper-menu > label { display: block; margin-bottom: 6px; font-weight: 500; }
.whisper-menu select { font-size: 12px; margin-bottom: 8px; }
.whisper-menu .whisper-opacity { margin: 6px 2px 10px; }
.whisper-menu button { width: 100%; justify-content: flex-start; text-align: left; }
.whisper-menu small { display: block; padding: 0 12px 8px; }
.whisper-menu-divider { height: 1px; background: var(--whisper-line); margin: 8px 0; }
.whisper-window .whisper-control[data-variant="primary"] { border-color: var(--whisper-edge); background: var(--whisper-outgoing-fill); box-shadow: 0 0 0 1px var(--whisper-edge); }
.whisper-window .whisper-control[data-variant="quiet"]:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-hover) var(--whisper-background-percent), transparent); }
.whisper-window .whisper-control[data-variant="quiet"]:active:not(:disabled) { background: color-mix(in srgb, var(--ui-pressed-layer) var(--whisper-background-percent), transparent); }
.whisper-resize { position: absolute; bottom: 1px; right: 1px; width: 16px; height: 16px; padding: 0; border: 0; background: transparent; color: var(--ui-text-muted); cursor: nwse-resize; }
.whisper-resize svg { width: 16px; height: 16px; }
.whisper-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
