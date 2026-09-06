# Whispers

Status: implemented locally; live gameplay validation remains with Matthias.

Whispers is an optional, session-only companion to the original Guild Wars
chat. Original chat remains authoritative and fully usable. The companion
observes incoming and outgoing whisper log events and submits one explicit
reply through the certified native chat sender. It does not simulate typing,
replace chat handlers, block messages, or maintain a second delivery history.

## Implementation layers

1. `feat/whisper-integration`: bounded certified observation, named one-message
   submission, original-call preservation, refusal and integration tests.
2. `feat/whisper-messenger`: Vue presentation, session model, unread state,
   friends, cleanup, sound, and combined interactive verification.

Both layers include their own tests and documentation. Publication is separate.

Enable **Whispers** in launcher Tools settings (off by default). The panel is
available in PvE while Tools is enabled. `pnpm tools:dev` with `?whispers` opens
the same Vue surface with local scenario controls; those controls never send
game messages.

## Acceptance criteria

- Incoming and outgoing whispers appear once in the companion, including
  replies written in original chat. Identical repeated messages stay distinct.
- Original chat receives all normal events unchanged. No renderer inserts a
  message into original chat history.
- Each Send gesture requests at most one native whisper on the game thread.
  Busy, unavailable, malformed, stale-session and policy-refused requests
  preserve the draft and never replay automatically.
- Native observation owns displayed outgoing messages. Queue acceptance is
  not a delivery receipt. Guild Wars does not expose remote read receipts.
- Messages, drafts, recent contacts, and chat-participant suggestions remain in renderer memory and
  clear when the client session ends. They never enter IPC, files or diagnostics.
- A movable person icon shows unread messages without stealing focus. Collapse
  restores the same recipient and keeps drafts. Close discards a conversation,
  with an inline guard for an unsent draft.
- A conversation opens at its first unread message once. Its exact reading
  position and keyboard focus then survive updates, conversation switches and
  collapse/reopen. A jump-to-latest control appears without pulling a reader
  away from older messages.
- Up and Down in the companion composer cycle observed outgoing messages and
  return to the unfinished draft. Original chat keeps its native message
  history because the host continues forwarding its arrow-key events unchanged.
- Friends reuse the existing certified observer. Recent people contains at most
  ten closed non-friend conversations in which the player sent a message.
  Remove and Clear recent affect contact suggestions only.
- The bounded chat observer reads whispers and the certified write-with-sender
  event used by public player chat. It observes names from Alliance, Allies,
  All, Guild, Group, Trade, and Whisper chat. Non-whisper message bodies are
  discarded in the native ring; the picker retains only the 50 most recent valid
  character names for session-only prefix and word completion. Friends and Chat
  are the only completion sources and either can be switched off in the picker.
- Sound offers Off, Background and Every incoming whisper. Muting a person
  suppresses sound while retaining unread badges. There are no notification cards.
- Unsupported client facts withdraw the optional feature. Original Guild Wars
  remains playable. Existing Tools region policy remains in force.

## Reuse and evidence

The older `gwonmac-whispers` worktree contains incoming-event research and a
bounded companion ring. Its persistence, main-process message transport and
native notifications do not fit this contract and are not adopted.

GWCA `ChatMgr` submits a UTF-16 line beginning with a quote, followed by
recipient, comma and message, with agent id zero. Current gwonmac Resign already
certifies the native sender and game-thread command queue. Reuse that proven
boundary without widening the argument-free Resign command.

GWToolbox++ `ChatSettings` identifies outgoing whispers in the global channel
by encoded template `0x76e`; incoming-only channel observation is insufficient.
External native-client facts are research leads, not WebAssembly authority.
The current outgoing producer supplies a numeric argument before recipient and
message. The parser consumes that bounded u32 prefix before reading either
string. Certification binds this producer, its template mapping and the native
encoder; integration tests cover echo confirmation and clearing the draft.

## Presentation and limits

Incoming bubbles align left; replies align right. Both use bright text and follow the selected Tools
UI theme and wrap long text. The header names the person; each message retains
an accessible author label. Back opens the people list. Sound and cleanup are
in the options menu. A local Background slider reduces only this messenger's
broad panel and transcript paint to 15% of the selected global panel opacity;
text, controls, bubbles, and the raised menu stay legible. The multiplier is
session-only and does not replace the saved appearance preference. There are no invented delivery or
read receipts. Original game links remain available in original chat.

The native sender accepts at most 137 UTF-16 units for the whole encoded line,
including recipient and separators. The composer displays the resulting body
limit (up to 120 units) and refuses excess text without truncation.

The view holds at most 32 open conversations and 200 messages per conversation.
Overflow is disclosed in the panel. Close read conversations keeps unread chats,
drafts and pending submissions. The picker shows online, away and do-not-disturb
friends with explicit presence; offline friends are hidden. An existing
conversation shows a friend's offline state when known. Friends use the latest
observed snapshot for this session; pausing the observer does not add friends
to recent people.
Temporary loading or PvP hides the surface and disables sending. Leaving the
game, changing character, or turning the feature off clears its session data.

## Verification boundary

Offline generated-WASM and companion tests prove bounds, refusal, ordering,
original-call preservation and lifecycle. The Tools fixture exercises the real
Vue surface with synthetic messages. The repository check suite, production build, complete integration suite,
compiled-kernel contract check, and current official-client whisper
certification/mutation tests passed. Browser exploration covered sending,
original-chat echo, focus, drafts, close guards, dragging and bubble wrapping.
A narrow live two-account check is still
required to establish current-game semantics; automated fixtures cannot claim
that check passed. Do not send a live test message to an unspecified person.
