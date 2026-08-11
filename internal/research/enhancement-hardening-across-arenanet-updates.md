# ArenaNet update hardening: research archive

> **Status: historical and non-normative.** This file records the research from
> 2026-08-04. It does not define current behavior. Read
> [WASM host](../../docs/wasm-host.md) for runtime authority and
> [Enhancement development](../../docs/enhancement-development.md) for the
> current patch-day procedure.

## Conclusion

Do not add a remote certificate feed. Do not build a general GWCA-compatible
WebAssembly library.

Keep runtime authority in the application:

- Use compiled facts for exact client builds.
- Use the isolated local verifier only for facts that it can prove from client
  structure.
- Let scheduled recertification propose repository changes. It must not grant
  runtime authority.
- Ship new Enhancement facts in a signed gwonmac application release.
- Use the untouched official ArenaNet module when a proof fails. Optional Tools
  must become unavailable without blocking the game.

This decision replaces the rejected idea of a signed remote certificate feed.
An older application cannot safely learn new Enhancement memory facts from a
second update authority.

## The three evidence classes

Client-facing features use one of three evidence classes.

| Class | Example | Update behavior |
| --- | --- | --- |
| Host-side | input policy or filesystem presentation | Survives an ArenaNet rebuild because it does not use client addresses. |
| Structural | template-save caller shapes | A bounded verifier can re-derive the fact and compare complete affected bodies. |
| Exact-build | memory addresses, function indices, table slots, and message IDs | A tool can propose a candidate. A maintainer must measure and certify it for the exact build. |

A number found by a tool is not a proof. The tool selected the number that it
then checked. Use structural proof where possible. Use live measurement for the
remaining exact-build facts.

## Evidence from other Guild Wars projects

This research inspected GWCA, GWToolbox++, and GWCAjs. Their module shapes are
not a design template for gwonmac. The useful lessons are narrower.

### GWCA and GWToolbox++

- Assert strings and source paths are more stable anchors than raw byte
  signatures.
- A failed anchor disables one feature. It does not authorize a guessed
  address.
- Patch-day tools enumerate failed anchors and guide a short human review.
- Function indices and enum values move more often than structure offsets.
- Structure offsets can fail silently. A successful scan is not enough; a live
  invariant must confirm the resulting data.
- Their history still contains groups of manual signature updates after one
  ArenaNet build. Tooling made the human loop faster. It did not remove it.

### GWCAjs cross-build mapping

GWCAjs mapped functions from a named build to a later stripped build with
several ranked heuristics. Its recorded result for build 38615 was:

- 17,302 of 17,739 functions mapped automatically;
- 8,637 exact matches;
- 8,665 high-confidence matches;
- 433 functions marked for review; and
- 4 functions not mapped.

This is useful candidate evidence. It is not enough to authorize a transform.
The important rule from that work is: do not infer one function-index delta for
an entire build. Map and verify each required fact.

## What gwonmac already proved

The template-save verifier is stronger than a pattern scan. It identifies the
required sites and compares the complete affected caller bodies. It normalizes
only the selected call-index operands. A semantic change causes refusal.

Exact Enhancement layouts need a different standard. A shared relocation delta
cannot prove that several hooks and structure fields still mean the same thing.
The build 38,797 investigation disproved uniform relocation. Exact-build facts
therefore stay in compiled certification tables.

The scheduled client watcher is an operations aid. It can detect a new
generation, download code artifacts, run bounded analysis, and open a pull
request or issue. Its output has no runtime authority until normal review,
verification, and application release are complete.

## Rejected general-purpose library

A general GWCA-style WebAssembly library would add the most expensive class of
state: more addresses, indices, signatures, and update work.

The research measured the mismatch:

- GWCA exposes about 480 API methods backed by about 150 scanned symbols.
- GWCAjs had implemented 95 of those methods and still used exact-build gates.
- gwonmac needed only a small certified surface for its product features.

A broad library would duplicate the companion's client facts and create a
second source of truth. It would also turn best-effort scans into a dependency
of a fail-closed product.

Keep each client capability narrow. Add it only for a current player feature.
Give it its own exact requirement, refusal behavior, and live acceptance check.

## Durable patch-day lessons

1. First test whether ArenaNet fixed the upstream defect. Delete the workaround
   when the official client no longer needs it.
2. Prefer host-side behavior when it can meet the requirement.
3. Prefer structural proof over exact addresses.
4. Use cross-build mapping only to propose candidates.
5. Confirm every exact-build fact with a bounded live check.
6. Keep the official client playable when optional certification fails.
7. Ship new runtime authority through the normal signed application release.
8. Keep the certified surface small. Patch-day cost grows with every fact.

## Upstream changes that would delete local work

The reports in [the upstream evidence directory](../upstream/README.md) describe
the measured defects. The highest-value upstream changes remain:

- implement the missing Emscripten template file operations;
- correct `Path::RemoveExtension`;
- remove `O_CREAT` from the existing-file open mode;
- pass the native mouse double-click value through the existing client path;
- refresh cursor hit-testing after the server confirms a mode change; and
- correct printable keyboard labels.

ArenaNet can also reduce future recertification cost by keeping the `build_id`
section, assert strings, and source-path strings. A published per-build function
name map would make function carry-forward more reliable, but it would still not
prove runtime memory layouts.

## Do not repeat these proposals

- Do not restore a remote certificate publication path.
- Do not treat scheduled automation as a runtime authority.
- Do not infer one relocation delta for all facts in a new build.
- Do not import another repository's public API or module structure by analogy.
- Do not build a generic client bridge before two product features need the
  same proven capability.
- Do not make the official client depend on optional Tools.
