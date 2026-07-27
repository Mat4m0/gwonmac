# Client tables

Status: **implemented; found by shape**

## Skill records

`src/main/core/skill-table.ts` reads the client-owned `Skill` array from the
static data segments of `Gw.jspi.wasm`.

The record is 164 bytes (`0xA4`) and indexed by skill ID. Fields currently
consumed by the catalogue are:

| Offset | Field |
| --- | --- |
| `0x00` | skill ID |
| `0x08` | campaign |
| `0x0C` | skill type |
| `0x10` | flags, including elite/PvE/PvP/playable |
| `0x28` | profession byte |
| `0x29` | attribute byte |
| `0x2A` | title requirement |
| `0x2C` | PvP replacement ID |
| `0x33` | equip type |
| `0x34` | overcast |
| `0x35` | encoded energy cost |
| `0x36` | health cost |
| `0x38` | adrenaline cost |
| `0x3C` | activation |
| `0x40` | aftercast |
| `0x44`, `0x48` | duration range |
| `0x4C` | recharge |
| `0x5C`, `0x60` | primary scale range |
| `0x64`, `0x68` | bonus scale range |
| `0x8C` | normal icon file ID |
| `0x94` | high-resolution icon file ID |
| `0x98` | name string ID |
| `0x9C` | concise description string ID |
| `0xA0` | full description string ID |

Energy values 11 and 12 are compact sentinels for 15 and 25 energy. Normalize
them at this boundary; consumers see the displayed cost.

### Why the address is not pinned

The table moves between client builds. `findSkillTable` searches static WASM
data for the complete record shape:

- IDs form the expected ascending sequence;
- campaigns and professions stay in their bounded domains;
- attributes are valid or use the no-attribute sentinel;
- the candidate run is thousands of records long.

No single field is distinctive enough. The initial icon-ID-only scan produced
2,559 plausible false windows.

## Language-file table

`src/main/core/skill-strings.ts` independently finds the static
`wchar_t *languageFiles[18][99]` table.

Each non-null pointer targets a six-byte encoded Guild Wars file ID:

```text
u16 low + 0x100
u16 high + 0x100
u16 0
```

The reconstructed archive file ID is:

```text
low + high × 0xFF00 + 1
```

after subtracting `0x100` from both words.

The locator validates the full 18 × 99 pointer table. The English row must be
complete. Other language rows may contain nulls because those holes exist in
the client table. GWonMac currently consumes the English row only.

## Names

Displayed names currently come from the vendored GWCA `SkillID` enum, parsed by
`parseSkillNames` in `src/main/core/skill-assets.ts`. Explicit enum jumps are
honored; source line position is never treated as an ID.

This is the one catalogue field not yet localized from the ArenaNet language
assets. It remains a deliberate, documented dependency rather than a silent
second ID table.

## Eligibility

The client flags distinguish PvP, player-only PvE, and non-playable records.
Normal PvE equippability additionally uses the audited Toolbox++ bitset in
`src/main/core/equippable-skills.ts`. Unknown future IDs fail closed.

The source and its mandatory attribution live together under
`src/native/skill-icons/vendor/`. Do not move or copy the derived material
without its notice.
