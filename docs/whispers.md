# Whispers

Status: implementation in progress on the whisper integration stack.

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
- Messages, drafts and recent contact metadata remain in renderer memory and
  clear when the client session ends. They never enter IPC, files or diagnostics.
- A movable person icon shows unread messages without stealing focus. Collapse
  restores the same recipient and keeps drafts. Close discards a conversation,
  with an inline guard for an unsent draft.
- Unread conversations open at the first unread message. Reading position and
  keyboard focus survive updates and conversation switches.
- Friends reuse the existing certified observer. Recent people contains at most
  ten closed non-friend conversations in which the player sent a message.
  Remove and Clear recent affect contact suggestions only.
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
Current-client certification and executable tests must establish the exact
packet layout, text grammar and producer before enabling either direction.

## Verification boundary

Offline generated-WASM and companion tests prove bounds, refusal, ordering,
original-call preservation and lifecycle. The Tools fixture exercises the real
Vue surface with synthetic messages. A narrow live two-account check is still
required to establish current-game semantics; automated fixtures cannot claim
that check passed. Do not send a live test message to an unspecified person.
