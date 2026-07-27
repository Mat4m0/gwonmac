# Verification and client recertification

Status: **repeat for every skill-pipeline or ArenaNet client change**

## Fast invariant tests

```bash
node --import ./scripts/ts-hook.mjs --experimental-strip-types \
  --test tests/unit/skill-strings.test.ts tests/unit/skill-assets.test.ts
pnpm tools:test
pnpm typecheck
```

The tests cover:

- full-shape language table discovery;
- 1,024-record shard boundaries and trailer exclusion;
- raw UTF-16 decoding while unrelated compact records remain opaque;
- string-ID shard boundaries;
- numeric range substitution;
- bounded native-helper framing;
- RGB565/BMP channel order;
- native catalogue validation and Vue inspector behavior.

## Repository gates

```bash
pnpm check
pnpm build
pnpm test:integration
pnpm tools:test:e2e
pnpm test:electron
pnpm test:release
```

Build before suites that consume `build/`; those suites do not build for you.

## Offline installed-client coverage

The acceptance criterion for descriptions is not “four sample skills work.”
For the installed client:

1. Construct `ChunkStore` from the installed snapshot metadata and chunk
   directory.
2. Construct `SkillAssets` with the installed `Gw.jspi.wasm`, vendored
   `Skills.h`, and built native decoder.
3. Call `catalogue()`.
4. Filter availability to `pve` and `player-only-pve`.
5. Require every resulting record to have a non-empty description.
6. Scan for unresolved `%str1%`, `%str2%`, `%str3%`, `[s]`, or C0 control
   characters.

Last measured result:

```text
total skill records:       3443
eligible descriptions:    1483
resolved descriptions:    1483
missing:                      0
unresolved/control issues:    0
maximum description length: 293
```

The transformed WASM measured in that session had SHA-256
`b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483`.
This hash is evidence only; the catalogue locators do not trust it.

## Live confirmation

Run one deliberate session after offline gates:

```bash
pnpm dev
```

Checklist:

1. Log in normally and open Tools with Command-B.
2. Open Builds, select a bar, and choose several skills from different
   professions and campaigns.
3. Confirm each inspector shows the correct name, mechanics, icon colors,
   elite treatment, and a grammatical description.
4. Check Word of Healing (282), Dwayna's Kiss (283), Holy Veil (309), and Draw
   Conditions (311) as stable smoke examples.
5. Confirm clicking and searching skills produces no WASM abort or client
   property-context error.
6. Save a local draft, write its template, and load it through Guild Wars.
7. Restart and confirm the build library persists.

The fresh account and one available hero are sufficient. Eight-member team
coverage remains fixture-driven.

## ArenaNet client change

On a new client build:

1. Run the normal client certification and enhancement doctor procedures.
2. Run the offline coverage check above.
3. If the skill table is not found, inspect the 164-byte record shape before
   changing offsets.
4. If the language table is not found, verify the complete 18 × 99 pointer
   shape and file-ID encoding.
5. If descriptions are missing, identify whether the referenced target record
   stopped being context-free. Do not broaden compact-record decoding from a
   handful of samples.
6. If icons fail, test the archive mapping, outer GWDat output, ATEX decode, and
   BMP conversion as separate boundaries.
7. Update the measured counts and date in this directory only after the full
   corpus passes.

Never respond to a new client by pinning one observed table address or by
restoring the live text resolver.
