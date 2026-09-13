# Hub title calculators

Hub provides exact offline planning from entered quantities. It does not read,
change, or persist title progress. It does not consume items or open chests.

## Supported flows

- `titles` opens editable examples. Enter on an example fills the search field.
- `sweet tooth from 7350` calculates the points remaining to maximum rank.
  Enter opens `2650 sweet points`, showing whole-item shopping alternatives.
- `sweet tooth next from 500` targets the next rank. `rank 1` and `rank 2`
  target a specific rank. Drunkard and Party Animal support the same syntax.
- `250 cupcakes in sweet points` calculates base points. Attached quantities,
  `in` / `to`, named aliases, and whole stacks of 250 are accepted.
- `2651 sweet points` rounds each alternative up to whole items and shows excess
  points, full stacks, and loose items. Alternatives are not a combined basket.
- `250 sweet points for 3e` compares an entered offer by price per point. Its
  extrapolated maximum-title cost assumes the same rate for the entire purchase.
  It is labelled **Your entered offer**, never a fetched market estimate.
- `zaishen rank 3 from 500` shows remaining points and required keys. An omitted
  starting point means zero and is explicitly displayed. Entered Zaishen progress
  must be a multiple of five. Rank 1 through rank 12 are supported.

The catalogue includes Birthday Cupcake, Crème Brûlée, Red Bean Cake, Hunter's Ale,
Bottle of Grog, Spiked Eggnog, Snowman Summoner, Frosty Tonic, and Zaishen Key.
All calculations use normal base points. Item restrictions and bonus events are
not inferred. Unknown items, generic `sweets` or `tonics`, and everlasting variants
are not assigned a value. A known item queried against the wrong title produces
an inline correction. Invalid progress never becomes zero silently.

Inputs are bounded to 160 characters and entered counts to one million. Counts
must be whole numbers; correctly grouped thousands such as `7,350` are supported.
Negative counts and decimal item quantities are refused. Money uses the existing
exact decimal arithmetic; division by zero is refused. Only display values round.
These calculations remain available when the Trade tool is disabled.

## Canonical data and sources

`src/shared/title-calculator.ts` owns the title thresholds, item point values,
exact aliases, and parser. The renderer only presents its results. Data was checked
against these Guild Wars Wiki pages on 2026-09-07:

- [Sweet Tooth](https://wiki.guildwars.com/wiki/Sweet_Tooth)
- [Drunkard](https://wiki.guildwars.com/wiki/Drunkard)
- [Party Animal](https://wiki.guildwars.com/wiki/Party_Animal)
- [Zaishen rank](https://wiki.guildwars.com/wiki/Zaishen_rank)
- [Birthday Cupcake and sweets table](https://wiki.guildwars.com/wiki/Birthday_Cupcake)
- [Hunter's Ale](https://wiki.guildwars.com/wiki/Hunter%27s_Ale)
- [Bottle of Grog](https://wiki.guildwars.com/wiki/Bottle_of_Grog)
- [Event consumables](https://wiki.guildwars.com/wiki/List_of_consumables/Events)

A source update requires reviewing the affected point values and fixtures. Do not
fetch wiki pages during typing or infer values from similarly named items.
Progress tracking, mission completion, title prices inferred from advertisements,
bonus calendars, and probabilistic chest budgets are outside this implementation.

## Verification

Unit tests cover exact points, incorrect tracks, unknown and everlasting items,
rank targets, rounding, excess points, invalid counts, explicit offer prices,
and offline operation. Browser journeys cover editable examples, the progress-to-
shopping flow, Zaishen requirements, and inline corrections without modal views.
