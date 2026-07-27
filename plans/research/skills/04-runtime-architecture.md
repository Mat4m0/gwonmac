# Runtime architecture

Status: **one catalogue, independently testable**

## Ownership

### Main process

`SkillAssets` owns the installed-client projection:

- initialize the static tables and archive index once;
- decode English description shards once per active client;
- serve immutable catalogue facts;
- decode icons on demand with a bounded in-memory LRU.

`src/main/protocol.ts` owns the `gw://app` routes:

- `skill-catalog.json` returns the canonical facts;
- `skill-icons/<id>.bmp` returns one decoded icon.

Changing the active client replaces the `SkillAssets` instance. Nothing is
persisted as a second skill database.

### Vue host

`apps/tools/src/host.ts` validates every catalogue record crossing the native
boundary. Invalid records are rejected instead of partially trusted.

`apps/tools/src/skill-catalog.ts` provides the in-memory lookup used by
authoring, validation, search, the bar, and the inspector. Unknown skill IDs
remain representable with explicit fallback facts so imported invalid builds
can be repaired.

### Vue components

`SkillCatalogue.vue` owns only presentation orchestration:

- eligibility/context filters;
- search and deterministic ordering;
- the active inspection result;
- keyboard navigation;
- selection, duplicate prevention, and elite replacement requests.

Profession rules, assignment validation, attribute costs, template codecs, and
library mutation remain in shared pure TypeScript.

## Description request sequence

```text
Tools mount
  -> host fetches gw://app/skill-catalog.json
  -> SkillAssets initializes static tables and archive index
  -> relevant English shards are decoded offline
  -> catalogue JSON includes description or explicit null
  -> host validates and replaces the one browser catalogue
  -> inspector renders the selected record
```

No description request occurs when a user clicks a skill. Selection is fast and
cannot call into Guild Wars.

## Debugging

In the embedded Tools DevTools console:

```js
const catalogue = await fetch("gw://app/skill-catalog.json").then(r => r.json());
const skill = catalogue.find(item => item.id === 311);
({ name: skill.name, description: skill.description, hasIcon: skill.hasIcon });
```

Expected for Draw Conditions is a non-empty description and `hasIcon: true`.

To check coverage without starting Electron, use the procedure in
[verification](05-verification.md). Do not debug descriptions by calling an
exported WASM function.

## Performance and bounds

- Static WASM tables are read once per active client.
- Only description shards referenced by eligible skills are opened.
- Each shard is decompressed once and retained only as parsed strings for the
  lifetime of the `SkillAssets` instance.
- Icon pixels are decoded on demand and capped at 256 entries.
- Child-process input, output, duration, and decoded dimensions are bounded.

## User-facing fallback

If a description cannot be produced, the inspector says:

> Description is unavailable from this installed client.

It must not say the application is out of date, because compatibility and
release availability are separate facts.
