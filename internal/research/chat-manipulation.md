# Chat manipulation: feasibility and first feature boundary

> **Status: implemented and statically certified; live category QA pending.**
> Investigation started on 2026-09-04 from `origin/main` commit
> `57182d1f` on branch `feat/chat-filtering`.

## Recommendation

Build **Chat Filters** first, with three independent settings:

- Hide item-drop messages for other party members.
- Hide Hall of Heroes winner announcements.
- Hide player title-achievement announcements.

The feature switch defaults to off and its category choices default to on, so
opting in has an immediate, predictable effect. Filtering happens inside the
certified game module before Guild Wars handles the relevant UI event. The renderer may
configure a fixed bit mask, but it must not receive chat text, encoded message
buffers, pointers, or a general message-blocking API.

Treat WTB/WTS highlighting as a separate second feature. It is possible in
principle, but it changes player-authored encoded text instead of making a
yes/no decision about a known system message. Prove that rewriting preserves
sender links, item links, timestamps, channel routing, and the original chat
log before shipping it.

Do not start with arbitrary words or regular expressions. They require moving
user text into the client module, decoding or normalizing Guild Wars text, and
defining what happens to links and every language. The three fixed categories
give the requested value with a much smaller and more reliable boundary.

## What the request means

“Ignore items dropped for other team members” is interpreted as hiding the
**chat notice** that reports the drop. The item remains on the ground and the
game state is unchanged. Suppressing the actual ground item is a separate item
rendering feature and is outside this work.

“Ignoring won HoH messages and title updates” means preventing those global
system announcements from entering the visible chat window and its retained
chat history. It does not block network packets or change the server.

“Color WTB and WTS” means recognizing buy/sell intent in player-authored trade
messages. A useful first version would color the complete message according to
a whole-word prefix. Coloring only the matching letters adds more encoded-text
rewriting and is not required for the first version.

## How GWToolbox++ does filtering

GWToolbox++ registers callbacks for four chat-related events:

- the native player-chat event `0x10000082`;
- the native write-to-chat-log event `0x1000007f`;
- GWCA's “print chat message” event `0x3000001f`; and
- GWCA's “log chat message” event `0x3000001d`.

Its callback receives a channel and a pointer to Guild Wars' encoded UTF-16
message. `ShouldIgnore` examines the encoded message template, and the callback
sets `status->blocked = true` when a selected category matches. This prevents
the next handler from printing or logging the message. Toolbox registers at an
early callback priority so the decision happens before ordinary consumers.

The requested categories already have precise Toolbox matches:

| Category | Encoded match used by Toolbox |
| --- | --- |
| Drop assigned to self or ally | top-level template `0x7f1`; the recipient is identified by numeric segment `0x10f`, with a player-name fallback |
| Hall of Heroes winner | `0x8102`, nested template `0x223b` |
| Player title achievement | `0x8102`, nested templates `0x1443`, `0x23e2`, `0x23e5`, and `0x23e6` |

These values are identifiers in Guild Wars' encoded text, not English text.
That is why Toolbox can use the same filter in different game languages. It
also means we should not match rendered sentences such as “has achieved”.

Toolbox's custom keyword and regular-expression filters are a later layer. It
decodes and normalizes text for those rules and allows channel scoping. We do
not need that machinery for the first three categories.

Sources:

- [GWToolbox++ Chat Filter implementation](https://github.com/gwdevhub/GWToolboxpp/blob/master/GWToolboxdll/Modules/ChatFilter.cpp)
- [GWToolbox++ Chat Filter documentation](https://github.com/gwdevhub/GWToolboxpp/blob/master/site/src/content/docs/chatfilter.mdx)
- [GWCA UI messages and chat packet layouts](https://github.com/gwdevhub/GWToolboxpp/blob/master/Dependencies/GWCA/include/GWCA/Constants/UIMessages.h)

## What transfers to GWonMac

The official WebAssembly client uses the same three native chat UI message
identifiers around the existing certified dispatcher:

- `0x1000007f`: write to chat log;
- `0x10000080`: write to chat log with sender; and
- `0x10000082`: player chat message.

GWonMac already proves one unique `(i32, i32, i32) -> void` dispatcher through
the exact player-chat producer and the two nearby producers. That proof is used
by Party observation and local actions. The installed client certificate binds
the dispatcher and its exact body before transformation.

The `0x3000001d` and `0x3000001f` callbacks are GWCA conveniences created by
its native hooks. We cannot copy those callback IDs into GWonMac and assume the
browser client emits them. We must prove the WebAssembly client's own
write/print path and the packet layout that reaches `0x1000007f`.

The current GWonMac dispatcher wrapper always calls the original game function
first and then invokes the optional companion observer. That order is correct
for observation, but too late for filtering. Chat Filters therefore needs a
new feature-owned gate in the transformed game module:

```text
Guild Wars produces UI event
  -> certified chat gate reads event ID and bounded packet fields
  -> known category enabled and exact template matches?
       yes: return without calling the original dispatcher
       no:  call the original dispatcher unchanged
  -> existing passive companion observation runs as it does today
```

This gate should be local to the chat feature. Do not change the shared
dispatcher wrapper into a general interceptor and do not let the side companion
decide whether game code runs. Normal game execution must not depend on a call
across modules.

## Implemented proof

The local verifier now establishes:

1. The exact native UI event that carries system announcements before they are
   committed to the visible and retained chat log.
2. Its packet's channel and encoded-message pointer fields in the current
   WebAssembly build.
3. The bounded UTF-16 representation and terminator rules needed to read the
   first two encoded identifiers.
4. The recipient segment used by `0x7f1`, and a certified source for the local
   player number or identity needed to distinguish self from another member.
5. Every call path that must be gated so a blocked message cannot reappear
   through a second print or log route.
6. A unique semantic locator for those roles on a rebuilt ArenaNet client.

Toolbox and GWCA are evidence about the native Windows client. They tell us
what to look for; they do not prove WebAssembly offsets, pointer layouts, or
control flow.

## Implementation

Add one capability named `chatFiltering`. Its certificate should own only:

- the proved event IDs;
- the exact dispatcher or feature-local producer/consumer functions;
- packet field offsets with typed witnesses;
- the encoded-message read rules;
- the local-player identity witness needed for ally-drop filtering; and
- the transformed-body hashes.

The transform adds a private `i32` settings mask and one fixed export such as
`enhancement_configure_chat_filters(mask) -> i32`. Only the three reviewed bits
are accepted. Configuration is cleared on module installation and disposal.
There is no arbitrary pointer, pattern, message ID, or replacement text in the
export.

The filter must default to pass-through. Invalid pointers, unterminated text,
unknown templates, unknown recipients, disabled settings, or failed
certification all call the original game handler. A classification problem may
show an unwanted message; it must never hide an unrelated one.

The settings UI should describe the visible outcome:

- **Other party members' item drops**
- **Hall of Heroes winner announcements**
- **Player title achievements**

The capability is independently optional. When its proof fails after an
ArenaNet update, Guild Wars remains playable and all chat appears normally.
The settings can remain saved while the controls show that filtering is
temporarily unavailable.

### Browser-client recipient identity

Live testing confirmed that this client emits `0x7f1` reservations with the
name token `0xba9 0x107` rather than the numeric `0x10f` segment. The current
character name is the fixed 20-unit UTF-16 field at `CharContext + 0x74`.

Function 9195 must not be used as a name reader. Its disassembly walks the
Player array, compares its input name with each decoded player name, and
returns the matching player number. In other words, it implements
`name -> player number`; passing a player number as its input returns zero.

## WTB/WTS highlighting

GWCA can change sender and message colors for an entire channel. Toolbox uses
that for its Chat Colors settings. It also proves that Guild Wars markup accepts
color tags such as `<c=#RRGGBB>…</c>`. Neither fact proves that an incoming
player message can be modified in place safely in the WebAssembly client.

A reliable highlighter needs a separate certificate and transform that can:

1. identify a player-authored trade-channel message;
2. scan bounded UTF-16 text without entering encoded links;
3. match case-insensitive whole words at the intended position;
4. allocate or use game-owned lifetime-safe replacement storage;
5. wrap the message with valid encoded color markup; and
6. preserve the original channel, sender link, item links, timestamp, log, and
   click behavior.

Changing the whole Trade channel color is easy but does not satisfy the idea:
WTB and WTS would still look the same. Changing the packet's channel to obtain
a color is also wrong because channel controls determine routing and visibility.

For that reason, the first branch should ship the fixed system-message filters.
WTB/WTS highlighting should follow after a live, link-bearing trade message has
proved the replacement-text route.

## Acceptance criteria

- With all settings off, transformed and official chat behavior is identical.
- Each setting hides only its named category.
- “Other party members' item drops” never hides a drop assigned to the local
  player and never removes an item from the world.
- Filtering removes a matched message from both the visible window and retained
  chat history.
- Player messages, whispers, links, party messages, errors, and unrelated
  announcements remain unchanged.
- Corrupt or ambiguous input passes through.
- A changed or ambiguous ArenaNet client disables only Chat Filters.
- No chat content, sender, encoded buffer, or pointer crosses into Electron or
  appears in diagnostics.
- One live test demonstrates each category and one nearby non-matching message.

## Remaining live QA

The current official client proves all three filters and produces a valid
`features-1fff` transformed module. In-game QA must still trigger each rare
server message, confirm it is absent from the visible and retained chat log,
and compare one nearby non-matching message. The ally-drop case must also prove
that the local player's own assigned drop remains visible.
