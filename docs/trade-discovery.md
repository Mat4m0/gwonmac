# Trade chat discovery

Status: Accepted

This document owns the product and interaction specification for the separate
Trade Chat window in GWonMac.

## Product decision

Trade helps a player find a recent, relevant Kamadan or Pre-Searing Ascalon
Trade message and contact its author without leaving Guild Wars. It also shows
observed Kamadan NPC trader quotes and quote history for commonly traded items.

It is a read-only discovery tool. It is not a marketplace, listing manager, or
chat client. A player creates a listing by posting to Trade chat in Guild Wars,
exactly as they do today.

The feature has two primary outcomes:

1. Find a player who is selling an item that you want to buy.
2. Find a player who wants to buy an item that you want to sell.

Success means the player can move from an item name to a useful character name
and message with little effort. Message volume, engagement, and time spent in
the Trade window are not success measures.

## Product boundary

The first release includes:

- the latest public Kamadan and Pre-Searing Ascalon Trade messages;
- a visible **Kamadan** and **Pre-Searing** source switch;
- text search over the selected source's public history;
- simple **All**, **Selling**, and **Buying** filters;
- a readable message detail view;
- relative and exact message times;
- an explicit action to copy the character name;
- a searchable catalogue of common materials, rare materials, runes, and dyes;
- observed NPC trader buy and sell quotes with bounded price history;
- connection, stale-data, empty, and failure states; and
- a link and attribution to the selected public source.

The first release does not include:

- creating, editing, saving, scheduling, or posting listings;
- sending, repeating, or automating chat messages;
- automatic whispers or trade actions;
- a GWonMac marketplace, account, database, or backend;
- player-market price estimation, item recognition from game state, or inventory
  integration;
- saved searches, notifications, alerts, notes, tags, or ignored players;
- regular expressions or a query language;
- importing remote messages into the Guild Wars chat panel.

These exclusions are deliberate. They keep the first release focused on the
observed problem: finding the other side of a trade.

`PRODUCT.md` uses the narrower boundary established here: no automated trading,
trade execution, listing publication, price manipulation, inventory automation,
or chat automation.

## What to learn from Toolbox++

Keep these parts of the Toolbox++ model:

- use the public Kamadan and Ascalon feeds instead of building another data
  source;
- show recent messages immediately;
- let one search cover message text and sender names when the upstream service
  supports it;
- keep the full original message visible; and
- make contacting the sender the end of the flow.

Improve these parts:

- use the existing GWonMac interface system and master-detail layout;
- distinguish players who sell from players who buy;
- preserve the reader's position when new messages arrive;
- show clear connection and stale-data states;
- handle upstream replacement messages instead of showing obsolete copies;
- share source connections across Trade Chat windows;
- keep the renderer isolated from network and game-client capabilities; and
- use normal TLS certificate validation and bounded network input.

Do not copy these Toolbox++ implementation choices:

- one WebSocket connection per window;
- disabled TLS certificate validation;
- polling global worker state from the interface;
- unbounded fragment or message accumulation; or
- direct game-memory actions from the trade view.

## Core user stories

| Priority | As a player, I want to... | So that I can... |
| --- | --- | --- |
| P0 | see recent messages from either supported source | notice current offers without visiting a website |
| P0 | switch between Kamadan and Pre-Searing | browse each economy without mixing their messages |
| P0 | search for an item or player name | reduce a fast feed to relevant messages |
| P0 | open a character's recent listings | compare everything that character posted |
| P0 | show only `WTS` messages | find someone selling an item I want |
| P0 | show only `WTB` messages | find someone buying an item I own |
| P0 | compare the full message and its age | judge whether contacting the player is worthwhile |
| P0 | copy the exact character name | contact the correct player in Guild Wars |
| P0 | keep reading while new messages arrive | avoid losing my position in the feed |
| P0 | keep useful results during a connection failure | continue my current search and recover clearly |
| P0 | use Trade at narrow and wide window sizes | keep it useful beside the game |
| P0 | use the complete flow with a keyboard | avoid switching repeatedly between input methods |
| P0 | save an offer or follow a player | keep useful leads and recognize their new listings |
| P0 | inspect current NPC trader quotes and history | compare buy and sell movement without leaving the game |
| Later | prepare an empty whisper to the selected character | shorten contact after the client action is certified |
| Later | save a useful search | repeat a proven search when actual use justifies persistence |

## Window and entry point

Trade Chat is a separate non-modal window. It does not share a window,
workspace switch, navigation, or content area with Builds and teams. The player
opens it directly from the GWonMac tool entry point.

The window title is **Kamadan Trade** or **Pre-Searing Trade**, matching the
selected source. Closing it does not close Builds and teams or Guild Wars.
Opening Builds and teams does not open or embed Trade.

The accepted ledger uses the existing component language without copying the
Builds window structure:

| Area | Purpose |
| --- | --- |
| Title bar | Active source title, window controls, status, and drag behavior |
| Toolbar | Source, search, intent filter, status, and result count |
| Ledger | One semantic list of recent or matching messages |
| Bottom inspector | Full selected message, time, and contact actions |

```text
┌─ Kamadan Trade ─────────────────────────────────────────────┐
│ [Kamadan][Pre-Searing] [ Search messages… ] [All][WTS][WTB]│
├─────────┬──────────────────┬───────────────────────────┬─────┤
│ Intent  │ Character        │ Message                   │ Age │
│ WTS     │ Character A      │ WTS q9 ...                │ 2m  │
│ WTB     │ Character B      │ WTB ...                   │ 5m  │
├─────────┴──────────────────┴───────────────────────────┴─────┤
│ Character A · exact time                                    │
│ WTS q9 ...                                                  │
│ [Copy character] [Copy message]               [Open source] │
└──────────────────────────────────────────────────────────────┘
```

At wide widths, the ledger and bottom inspector remain visible together. At
narrow widths, the same list DOM becomes stacked cards and selecting a result
opens an in-window detail sheet.
**Back to results** returns without losing the query or scroll position.

## Toolbar and ledger

The rail contains, in order:

1. A **Kamadan** and **Pre-Searing** source switch.
2. The selected source and a compact connection status.
3. One search field with a clear button.
4. An **All**, **Selling**, and **Buying** segmented filter.
5. The current result count or live-feed label.
6. The bounded result list.

The two source choices are distinct feeds and economies. **Pre-Searing** maps
to the public Ascalon service, which archives Pre-Searing Ascalon City,
America English district 1. There is no separate post-Searing Ascalon source.
The first release does not merge the sources into a **Both** view.

Switching source replaces the live feed, history results, status, and source
link as one operation. It may preserve the entered query and intent filter so
the player can compare the same item, but messages from the two sources never
appear in one result set.

An empty search field shows the live feed. Submitting non-empty text shows
history results. Clearing the field returns to the preserved live feed. Search
runs on explicit submit, not on every keystroke.

Each result row shows:

- the character name;
- a compact relative time such as `2m` or `1h`;
- enough original message text to identify the trade; and
- restrained **WTS** and **WTB** markers when the message contains those terms.

Search shows every matching message. It does not group different messages from
one character into one row. Duplicate upstream timestamps still produce one
row because the timestamp identifies one canonical message.

The character name is a separate control from the message. Selecting the name
opens that character's recent listings from the active source. **Back to
results** or **Back to offers** restores the prior query, intent filter,
selection, progressive reveal count, and scroll position. The player view uses
the same bounded ledger and does not create or persist a player profile.

The original wording is canonical. GWonMac does not rewrite a message into a
structured listing.

Matching search text is highlighted visually without changing copyable text.
Sender names use bidirectional text isolation so mixed writing systems do not
reorder the row.

Live results are newest first. When the player is at the top, new messages may
appear immediately. When the player has scrolled away from the top, the list
must not jump or show a repeating arrival notice. New messages merge silently
when the player scrolls fully back to the top.

## Trade intent filter

The intent filter is a local convenience, not a claim that GWonMac understands
the item or offer.

- **Selling** includes messages with a case-insensitive, whole-word `WTS`.
- **Buying** includes messages with a case-insensitive, whole-word `WTB`.
- **All** includes every result.
- A message that contains both terms appears in both filtered views.
- `WTT` and messages without either term remain available in **All**.

The initial filter is **All**. The chosen filter stays active while the player
moves between live and search results during the window session. It is not
persisted to disk.

## Message detail

The detail pane is calm and sparse. It shows:

- the complete original message with selectable text;
- the character name;
- the relative time and an exact local timestamp;
- **Copy character name** as the primary first-release action;
- **Save offer** and **Follow player** as explicit local actions;
- **Copy message** as a secondary action; and
- source attribution with **Open Kamadan** or **Open Ascalon** as a secondary
  link.

Copy feedback appears beside the action and does not hide the copied value.
Selecting another row replaces the detail in place.

The detail view does not show guessed item fields, prices, availability, or
online status. A recent message is evidence that the character posted recently;
it is not evidence that the trade remains available.

### Optional certified whisper action

Toolbox++ can prepare a whisper to the selected character. GWonMac may add
**Whisper** later only when the official client host provides a separately
certified, explicit capability for the active game window.

That action may focus or prepare an empty whisper to the selected character. It
must never insert an offer, send a message, repeat input, or choose a different
game window. **Copy character name** remains the fallback when the capability
is unavailable or uncertified.

The core Trade feature must not depend on this enhancement.

## Primary user flows

### Browse current offers

1. The player opens the **Trade Chat** window.
2. Cached messages appear immediately when available.
3. The source connects and adds newer messages.
4. The player selects a message and reads the complete text.
5. The player copies the character name and contacts that character in game.

### Find an item to buy

1. The player enters an item name and submits the search.
2. Search results appear newest first.
3. The player chooses **Selling** to focus on `WTS` messages.
4. The player selects a useful result and checks its exact age.
5. The player copies the seller's character name.

### Find a buyer for an item

1. The player enters an item name and submits the search.
2. The player chooses **Buying** to focus on `WTB` messages.
3. The player compares recent messages without losing the result list.
4. The player copies the buyer's character name.

### Return to current activity

1. The player clears the query.
2. The preserved live feed returns at its previous position.
3. Newer messages merge silently when the player returns fully to the top.

### Compare one character's listings

1. The player selects a character name in a result row or message detail.
2. Trade Chat shows that character's recent messages from the active source.
3. The player compares the individual messages or opens one message detail.
4. The player selects **Back to results** or **Back to offers**.
5. The prior ledger returns at its previous position.

### Inspect trader prices

1. The player selects **Trader prices** in the Trade Chat toolbar.
2. The player browses Common, Rare, Runes, or Dyes, or searches the complete
   catalogue.
3. The player selects an item to compare the current buy and sell quotes.
4. The player changes the chart range or moves to the previous or next item.
5. The player selects **Back to listings** and returns to the preserved ledger.

## States and recovery

| State | Required behavior |
| --- | --- |
| Initial connection | Show a small progress state without replacing the window |
| Live | Show the latest bounded feed and connection status |
| Searching | Keep the submitted query visible and show progress in the result area |
| No results | State that no recent messages matched; keep query and filters editable |
| Reconnecting | Keep existing rows visible, mark them as possibly stale, and retry |
| Offline | Keep existing rows visible with their real times and offer **Retry** |
| Source failure | Explain which source is unavailable; other GWonMac windows remain usable |
| Invalid response | Ignore the unsafe response, preserve valid rows, and retry safely |
| No selection | Prompt the player to select a message; do not fill the pane with help text |
| Narrow detail | Show **Back to results** and preserve list state |
| Player listings | Keep Back available during loading, empty, and failure states |
| Trader prices | Preserve the ledger, show quote freshness, and keep Back available |
| Price history failure | Keep current quotes visible and offer **Retry** for the chart |

The feed does not use an empty-state illustration. The interface should feel
like a compact working tool, consistent with Hero/Build management.

## Keyboard and accessibility

- Tab enters the active Trade Chat window and follows visual reading order.
- The search field, intent filter, results, and actions have visible focus.
- Up and Down move through results when the result list has focus.
- Enter selects the focused result.
- `/` focuses Trade search when focus is not in an input.
- Escape closes the topmost GWonMac surface. Trade must not override it to
  clear search.
- Live arrivals are not announced one by one to assistive technology.
- Connection changes and submitted-search result counts use one polite status
  announcement.
- Message and sender text remains selectable and uses bidirectional isolation.
- Reduced-motion mode removes nonessential arrival and selection motion.
- Both interface styles and all supported opacity values meet the contrast
  rules in `apps/tools/DESIGN.md`.

The Trade Chat window must receive input only inside its controls. Guild Wars
keeps normal pointer and keyboard input everywhere else.

## Data and architecture

The public Kamadan and Ascalon services remain the only sources of truth for
trade messages. Kamadan remains the source of truth for NPC trader quotes and
quote history. GWonMac does not persist public feed or price history. It stores
only offers the player explicitly saves and player names the player explicitly
follows.

Main owns one `TradeChatService` for the app process:

- it lazily owns at most one shared connection per source;
- a source connection exists only while at least one Trade Chat window
  subscribes to that source;
- a bounded in-memory ring per source keeps at most 100 valid live messages;
- the renderer receives typed snapshots, result pages, status, and live events
  through narrow IPC;
- the renderer never opens the WebSocket or chooses an arbitrary network host;
- Kamadan uses the exact `kamadan.gwtoolbox.com` host;
- Pre-Searing uses the exact `ascalon.gwtoolbox.com` host;
- live messages, history, pending arrivals, replacements, and searches remain
  separate by source;
- the canonical message key contains the source and upstream timestamp;
- trader quote and price-history requests use fixed Kamadan routes, bounded
  responses, short-lived in-memory caches, and the same renderer isolation;
- TLS certificate validation remains enabled;
- response size, message size, fragment count, queue length, and timeouts are
  bounded;
- reconnect uses exponential backoff with jitter;
- a replacement reference removes the referenced older message before the new
  message is inserted; and
- duplicate message timestamps do not create duplicate rows.

Each source connection may stop after its final subscriber leaves that source.
The service does not run as a permanent background service and does not notify
the player while every Trade Chat window is closed.

Search responses belong to the submitted request that produced them. A late
response from an older query cannot replace newer results. The renderer reveals
the bounded response 25 messages at a time and reveals the next 25 when the
reader reaches the bottom, up to 200. This is local progressive reveal: the
upstream WebSocket protocol has no cursor pagination and GWonMac makes no extra
network request while scrolling.

Multiple game accounts share the same public network connection and in-memory
feeds. Selection, query, filter, source, and scroll state stay with each Trade
Chat window. No account identity or profile data is sent to either source.

Saved offers and followed players live in one bounded, owner-only local JSON
document. The Saved drawer separates Offers and Players. A saved offer keeps
its exact source, timestamp, sender, message, and saved time. Following a player
highlights matching current and future rows without sending anything upstream.

## Privacy, safety, and external dependency

Trade messages are public but can still contain player identifiers and free
text. Diagnostics must not record:

- message text;
- character names;
- search queries;
- copied values; or
- WebSocket payloads.

Diagnostics may record bounded technical outcomes such as connected,
reconnecting, response rejected, duration, and result count.

Before release, maintainers must confirm that the public Kamadan and Ascalon
operator permits this client use and document required attribution, rate
limits, and protocol expectations. GWonMac must identify itself honestly where
the protocol permits it. The app must degrade safely when either unofficial
service changes or becomes unavailable.

Automated tests use recorded, anonymous fixtures. They must not depend on the
live public service.

## First-release acceptance criteria

The feature is ready when all of these statements are true:

- Opening the separate Trade Chat window shows recent valid messages without
  opening or changing Builds and teams.
- Switching between Kamadan and Pre-Searing replaces the complete source view
  and never mixes their messages.
- A player can submit a plain-text search and return to the live feed.
- Search keeps every distinct matching message, including messages from the
  same character.
- Selecting a character shows that character's recent listings and returns to
  the preserved ledger.
- Trader prices shows the four supported categories, current buy and sell
  quotes, and selectable history ranges without discarding the ledger.
- **Selling** and **Buying** apply the defined `WTS` and `WTB` rules.
- Results remain readable and stable while new live messages arrive.
- Selecting a result shows the complete original message and exact age.
- Copying a character name and message gives persistent, accessible feedback.
- Replacement and duplicate messages do not leave obsolete duplicate rows.
- Two Trade Chat windows on the same source share one upstream live connection.
- Two windows on different sources use one lazy connection per active source.
- Disconnection preserves existing rows, marks them stale, and reconnects with
  bounded backoff.
- A malformed or oversized response cannot grow memory without a bound or
  crash the renderer.
- Search queries, character names, and message text never enter diagnostics.
- The interface works at narrow, wide, short, transparent, and opaque sizes in
  both visual styles.
- The complete flow works with keyboard only, without stealing Guild Wars input
  outside the Trade window.
- The core feature works without game-memory access or the optional whisper
  capability.

## Deliberate follow-ups

Do not add these until first-release use shows a concrete need:

1. A certified **Whisper** action can shorten the final contact step without
   sending text.
2. Saved searches and foreground-only alerts can help repeated item hunts, but
   they add persistence, notification rules, and noise.
Each follow-up needs its own acceptance criterion. None should delay the core
find-and-contact experience.
