# Reminders

Reminders print a short `[gwonmac]` line into your own chat log:

- one minute before a con, pcon or your alcohol runs out;
- once more when it has run out.

The lines appear only in your chat. Nothing is sent to the server or to other
players.

## What is tracked

| Group | Effects |
|---|---|
| Cons | Essence of Celerity, Grail of Might, Armor of Salvation |
| Pcons | Birthday Cupcake, War Supplies, Golden Egg, Candy Apple, Candy Corn, Slice of Pumpkin Pie, Drake Kabob, Bowl of Skalefin Soup, Pahnai Salad, Blue, Green and Red Rock Candy, and Lunar Blessing (+1 attributes only) |
| Alcohol | The Alcohol Timer's estimate |

The list lives in `src/shared/reminders.ts`, keyed by the GWCA effect IDs.

- **Con and pcon times are exact.** They come from the game's own effect
  record, the same player-effects snapshot that Effect Timers read.
- **Alcohol is an estimate:** about one minute per alcohol level (see
  [Effect Timers](effect-timers.md#alcohol-timer)). Its lines therefore say
  "about".

## Rules

- **Refreshing starts over.** Using a con again, or drinking again above the
  last minute, re-arms its reminders.
- **Removed early means no "has run out" line.** This covers death, entering an
  outpost and a character change.
- **Loading screens and PvP add or repeat nothing.** The observation is
  withdrawn there.
- **Reminders are PvE only.** The feature's region policy is `pve`.
- **One line at a time.** The game thread takes one line per frame. A burst
  keeps at most eight lines waiting; older ones are dropped first.
- **The chime is off by default.** It plays at most once per second, so a burst
  of reminders sounds once.

## Settings

Open **Settings → Tools → Reminders**. The same options are in the Hub under
Settings → Tools.

| Setting | Default |
|---|---|
| Reminders | off |
| Remind me about: Cons, Pcons, Alcohol | all on |
| When: 1 minute before it runs out, When it has run out | both on |
| Play a sound | off |

## Native boundary

The certified `chatPrint` capability prints through the chat-log producer that
Chat Filters already prove (function 7884 in client build `b5f10d50…`).

Before that producer runs, the drain calls the producer's own encoded-text
validator, `TextValidateCoded`. The producer asserts on any line the validator
rejects, so a rejected line is skipped instead of reaching that assertion.

The renderer can submit only bounded text:

- 1–120 printable ASCII units;
- no `<` or `>`, so no game markup.

The enqueue export checks those limits a second time. It then wraps the text
as a literal encoded string: `0x108 0x107`, the text, `0x1`.

The producer builds a local write-to-chat-log UI message (`0x1000007F`). Its
direct call graph does not reach the network sender. That the UI handlers send
nothing is inferred: the live check below confirms it.

The channel is `10`, the channel the game's own notices use. Its colour still
needs the live check.

## Live check (Developer Build)

1. Enable Reminders, then use a Birthday Cupcake.
2. Wait for the reminder one minute before the end and for the "has run out"
   line. Check that both lines are readable.
3. Have a second account in the same party or district confirm that it sees
   nothing.
4. Drink until the Alcohol Timer shows a time. Wait for its two lines.
5. Zone during the last minute of a pcon. The "has run out" line must not appear.
