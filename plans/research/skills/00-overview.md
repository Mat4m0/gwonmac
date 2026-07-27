# Client-owned skill catalogue

Status: **working and shipped from one offline pipeline**

Last verified: 2026-07-27

This directory is the living technical record for Guild Wars skill facts,
names, descriptions, and artwork in GWonMac Tools. Update it when the client
layout, archive reader, decoder, catalogue contract, or authoring UI changes.

## Current result

The installed ArenaNet client is the source of truth for:

- skill IDs, profession, attribute, elite state, mechanics, and localized
  description string IDs;
- the English description text and its skill-specific numeric ranges;
- icon file IDs and icon pixels.

The resulting catalogue is produced without starting Guild Wars and without
calling a live WebAssembly function. On the client installed during the last
verification:

| Measurement | Result |
| --- | ---: |
| Client skill records | 3,443 |
| Skills with non-zero icon IDs | 3,439 |
| Icon IDs resolving in the archive | 3,439 |
| Eligible PvE/player-only catalogue entries | 1,483 |
| Eligible entries with descriptions | 1,483 |
| Missing eligible descriptions | 0 |
| Elite records in the full client table | 391 |

These numbers are evidence for the measured build, not constants the code
trusts. Shape checks and bounds checks are the actual compatibility boundary.

## One data path

```text
installed Gw.jspi.wasm
  ├─ static Skill[3443] table ───────────────┐
  └─ wchar_t *languageFiles[18][99] table ─┐ │
                                           │ │
installed Gw.snapshot (.dat)               │ │
  ├─ English language shards ── GWDat ─────┘ │
  └─ icon streams ───────────── GWDat/ATEX ──┘

SkillAssets ── validated skill-catalog.json ── Vue host ── authoring UI
```

There is no second description endpoint, renderer cache, bundled skill
database, wiki request, or live-client text resolver.

## Documents

- [Client tables](01-client-tables.md) records the static WASM layouts and how
  they are found.
- [Language assets](02-language-assets.md) records language-file addressing,
  string records, interpolation, and the safety boundary.
- [Icons](03-icons.md) records archive addressing and the pixel pipeline.
- [Runtime architecture](04-runtime-architecture.md) maps ownership and failure
  behavior from native helper to Vue.
- [Verification and recertification](05-verification.md) is the checklist for
  changes and new ArenaNet builds.

The earlier
[archive investigation](../../tools/hero-builds/evidence/skill-icons-archive.md)
is historical evidence. This directory owns the current implementation.

## Code map

| Concern | Canonical implementation |
| --- | --- |
| Guild Wars archive and MFT | `src/main/core/gw-archive.ts` |
| Static skill table | `src/main/core/skill-table.ts` |
| Language-file table and shard records | `src/main/core/skill-strings.ts` |
| Eligibility allowlist | `src/main/core/equippable-skills.ts` |
| Catalogue and asset orchestration | `src/main/core/skill-assets.ts` |
| GWDat, ATEX, and BC decoding helper | `src/native/skill-icons/` |
| `gw://app` catalogue/icon routes | `src/main/protocol.ts` |
| Browser-side catalogue contract | `apps/tools/src/skill-catalog.ts` |
| Native response validation | `apps/tools/src/host.ts` |
| Inline catalogue and inspector | `apps/tools/src/components/SkillCatalogue.vue` |
| Skill-slot and elite-frame primitives | `src/shared/ui/components.css` |

## Non-goals

- We do not claim account-specific unlock state.
- We do not fetch or bundle wiki descriptions.
- We do not equip skills or manipulate a party.
- We do not expose raw client string IDs to Vue.
- We do not call ArenaNet's text service after JavaScript regains control.
