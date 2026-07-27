# Language assets and skill descriptions

Status: **1,483 of 1,483 eligible descriptions resolved**

## Safe architecture

Descriptions are decoded from installed files before the Vue catalogue is
served. The implementation never invokes a client function:

1. Find the English language-file IDs in static WASM data.
2. Map a skill's description string ID to a shard and record.
3. Read that shard from `Gw.snapshot`.
4. Use the native helper's bounded `--raw` mode to remove outer GWDat
   compression.
5. Walk the 1,024 record headers in TypeScript.
6. Decode the referenced raw UTF-16 record.
7. Substitute the skill record's three numeric ranges.

## String-ID addressing

Each language shard owns 1,024 string records:

```text
shard  = floor(stringId / 1024)
record = stringId % 1024
```

`stringShardIndex` rejects negative and non-integer IDs.

## Record framing

One decoded language shard contains 1,024 back-to-back records followed by
unrelated trailer data. Each record starts with:

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 2 | total record bytes, including header |
| `0x02` | 2 | base character / compact-text context |
| `0x04` | 1 | bits per compact symbol; 16 for raw UTF-16 |
| `0x05` | 1 | zero padding |
| `0x06` | variable | payload |

A context-free record has base character 0 and range bits 16. Its payload is
UTF-16LE. `parseStringShard` validates every record boundary, decodes these
records, and represents other records as `null`.

That nullable result is intentional. The same shard contains unrelated
compact/context-keyed records. They must not be guessed at, and they must not
invalidate valid skill-description records elsewhere in the shard.

The measured invariant is stronger and narrower: every eligible PvE skill's
full-description ID points to a context-free UTF-16 record. On 2026-07-27 this
was 1,483 of 1,483.

## Numeric interpolation

ArenaNet description text uses:

- `%str1%` for `scale0`–`scale15`;
- `%str2%` for `bonusScale0`–`bonusScale15`;
- `%str3%` for `duration0`–`duration15`;
- `%%` for a literal percent;
- `[s]` for conditional plural suffixes.

`formatSkillDescription` uses the exact endpoints stored on the skill record.
Equal endpoints render as one number; differing endpoints use an en dash.
Text is inserted into Vue with ordinary interpolation, never `v-html`.

The verified corpus has no unresolved placeholders or control characters.
The longest current eligible description is 293 characters.

## The failed live resolver

Do not reintroduce a JavaScript-triggered call to ArenaNet's text decoder.

The experimental resolver called the client after control returned to
JavaScript. The client asserted:

```text
ASSERTION FAILED: s_propContext
Base/Os/Emscripten/Exe/EmscriptenExeProp.cpp:32
```

and aborted the entire game runtime. Binary inspection confirmed the target
function requires a transient property context owned by client event dispatch.
Certification of the client build does not make that context available.

This is a lifecycle violation, not a callback-pointer, timing, or UI problem.
The safe boundary is offline file decoding.

## Failure behavior

- A missing or unrecognized language table yields `description: null`.
- A missing shard, invalid archive stream, helper failure, malformed record, or
  non-context-free target yields `description: null`.
- Names, mechanics, eligibility, and icons remain available.
- The Vue inspector explains the explicit unavailable state.

One shard failure must never abort Guild Wars or take down the rest of the
catalogue.
