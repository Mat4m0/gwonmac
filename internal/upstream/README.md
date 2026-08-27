# Upstream client evidence

> **Status: historical and non-normative.** These files preserve measurements,
> failed hypotheses, and exact-build facts from investigations of ArenaNet's
> WebAssembly client. They do not define current gwonmac behavior. Read
> [WASM host](../../docs/wasm-host.md) for runtime ownership and
> [Enhancement development](../../docs/enhancement-development.md) for the
> current certification procedure.

## Why this archive exists

Several ArenaNet client defects need host-side workarounds. The expensive part
was not writing the workaround. It was learning the client contract without
symbols and rejecting plausible but incorrect explanations.

Keep this evidence so that a future client update does not repeat those wrong
turns. Exact addresses, indices, hashes, and offsets apply only to the build
named in the file that contains them.

## Current map

| File | Purpose | Current conclusion |
| --- | --- | --- |
| [upstream-defects.md](upstream-defects.md) | Self-contained ArenaNet report | Eight measured template, cursor, and subdirectory defects exist in the examined builds. |
| [mouse-double-click.md](mouse-double-click.md) | Self-contained ArenaNet report and local evidence | The client has a complete mouse double-click channel, but its Emscripten input path never feeds the flag. gwonmac proves and patches the native callback structurally. |
| [upstream-keyboard-labels.md](upstream-keyboard-labels.md) | Self-contained ArenaNet report and local investigation | Printable key labels render one character too high. Input remains correct. No local transform is justified. |
| [client-internals.md](client-internals.md) | Exact-build reference | Template layouts, call sites, and costly Enhancement foundation measurements. |
| [host-bridge.md](host-bridge.md) | Implemented workaround record | The template transform and renderer bridge fail closed and keep the official module canonical. |
| [client-generation-ledger.md](client-generation-ledger.md) | Generation and evidence index | Records examined generations, exact content identities, outcomes, and durable/private evidence boundaries without granting runtime authority. |
| [recertify.md](recertify.md) | Maintainer recovery procedure | First test whether the workaround can be deleted. Re-derive semantics when automated proof refuses. |
| [investigation-log.md](investigation-log.md) | Wrong-turn archive | Real input shapes and live measurements resolved the template, cursor, modifier, and timer failures. |
| [memory-exhaustion-log.md](memory-exhaustion-log.md) | Long-session memory evidence | The examined client has a 2 GiB WebAssembly maximum and can exhaust it during normal long runs. A larger maximum buys time but does not fix growth. |
| [controller-prompt-atlas.md](controller-prompt-atlas.md) | Content-certified texture evidence | The PlayStation prompt option replaces one uniquely observed 256×512 RGBA controller atlas and fails closed when its content changes. |
| [investigation-template.md](investigation-template.md) | Investigation format | Record one hypothesis, one measurement, and one lesson per round. |

The retired hero-panel observer has a separate
[archive note](../archive/hero-panel/README.md).

## Evidence standard

Static disassembly creates hypotheses. It does not prove runtime meaning.

The template investigation became reliable when it appended export entries to
ArenaNet's module, instantiated the module with stub imports, and called pure
client functions directly. This measured path conventions and exposed an
off-by-one error that static reading missed.

Use the least expensive proof that can answer the question:

1. Decode the module to identify a candidate.
2. Call a pure function in isolation when possible.
3. Run the derived module with the real bridge and an offline filesystem.
4. Use one bounded live run only for state that needs an initialized client.

Do not infer a global function-index or address delta between client builds.
Do not treat a tool-selected candidate as independent proof.

## Delete before re-certifying

When ArenaNet publishes a new client, first test the official behavior. If the
upstream defect is fixed, delete the local workaround. If a proof refuses, use
[recertify.md](recertify.md). Until the new facts are proven, serve the untouched
official client and disable only the optional capability.
