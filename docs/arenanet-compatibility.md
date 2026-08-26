# ArenaNet client compatibility

This document defines how `gwonmac` proves that its client-side repairs and
Tools remain safe after ArenaNet rebuilds the official WebAssembly client.

Audience: contributors who change client certification, deterministic
transforms, patch-day automation, diagnostics, or release qualification.

This document owns proof authority, feature refusal boundaries, retained
evidence, and the patch-day playbook. Code and tests own exact signatures,
message identifiers, offsets, hashes, ABI numbers, and time limits.

Read [WASM host and client certification](wasm-host.md) for the wider hosting
architecture and [Core and Tools development](enhancement-development.md) for
feature-development rules.

## Product guarantee

An ArenaNet rebuild can change file hashes, function indices, table positions,
and static addresses without changing game behavior. `gwonmac` must recover
from those routine changes locally and keep every independently proved feature
available. This must not require a source change, pull request, or application
release.

No verifier can safely promise compatibility with an arbitrary future semantic
change. When a protected behavior genuinely changes, only the feature whose
proof fails must refuse. The untouched official client remains playable. If the
4 GB transform cannot be proved, the normal 2 GB mode remains playable.

Synthetic touch input is not a fallback for native double-click. Exact historic
hashes are regression fixtures, not launch authority.

## One runtime authority

The isolated local semantic verifier is the only component that can grant a
client capability. It runs in the existing bounded utility process and receives
the exact official bytes selected for one immutable client generation.

These inputs can provide evidence but cannot grant authority:

- compiled exact-build tables;
- CI results and workflow summaries;
- generated reports, attestations, caches, or diagnostics;
- GitHub issues and pull requests;
- a successful result from an older client generation.

The verifier binds every verdict to the official input SHA-256 and verifier ABI.
Main validates that boundary before it accepts a result. Production performs
each transform again, checks every transform invariant, validates the resulting
WASM, and requires the locally computed output hash.

The runtime chain is:

```text
official JS/WASM generation
  -> isolated template semantic proof and transform
  -> isolated per-feature semantic proofs
  -> typed manifest containing only proved capabilities
  -> Main repeats transforms and checks output hashes
  -> renderer validates the instantiated manifest
```

Derived modules and reports are rebuildable caches. Corruption or an ABI change
discards them without changing player settings, saved files, accounts, Builds,
or Teams.

## Per-feature verdicts

Each requested feature returns one of these results:

- `proved`: one unique candidate satisfies every required invariant;
- `changed`: no candidate satisfies the required semantics;
- `ambiguous`: more than one candidate satisfies the locator, so selection is
  unsafe.

A refusal includes the feature-local invariant and, for ambiguity, the candidate
count. A top-level successful verification means that at least one safe module
can be built. It does not mean every requested feature proved.

Capability manifests compare every field in both directions. A requested
capability that is missing from an otherwise valid exact regression record must
still trigger local proof.

## Evidence rules

Relocation is accepted only when the new value is independently derived:

- A function index can move when one unique signature, call relation, or table
  role identifies it.
- An immutable-data pointer can move when the uniquely referenced content is
  unchanged.
- A mutable or static address needs a complete feature-local occurrence ledger
  with one consistent derived value.
- A structure offset must be extracted from an independently identified reader
  or writer. It is never ignored or copied from a baseline.

Proof normalization must preserve control flow, branches, signatures, call
order, cardinality, table relationships, message semantics, packet opcodes,
payload order, pointer expressions, structure offsets, and unexplained
constants. A common relocation delta is not evidence by itself.

Every memory-layout word in a certificate needs a typed witness. Adding an
unwitnessed field must fail TypeScript compilation or boundary validation.

## Feature boundaries

| Feature | Required proof | Refusal behavior |
| --- | --- | --- |
| Template saving | Unique bridge stubs, all 11 call sites, signatures, argument modes, control flow, and independently derived static storage | Serve the untouched official module; do not claim persistent template repair |
| Native double-click | Unique callback plus the complete enqueue, pump, translator, mouse-dispatch, click-consumer, and flag-lift route, then the exact frame insertion and output | Keep ordinary client input; report it unavailable; never synthesize touch events |
| Guild Wars cursor | Unique loop/callback/table/neighbour graph, both producers, and independently derived globals, buffer, and layout | Use the normal macOS pointer |
| Target Distance | Complete observation base, target-field ledger, precedence, and bounded finite snapshot behavior | Disable Target Distance only |
| Party capture | Complete roster, ownership, profession, unlock, flag, skill, attribute, dirty-message, and transition lifecycle | Disable party observation and dependent Team Apply |
| Travel | Exact four-field producer, unique current-region resolver with complete call/content witnesses, Travel message role, dispatcher, reviewed-map allowlist, bounded mailbox/drain, and transition confirmation | Disable Travel; aliases may retain only independently available Xunlai commands |
| Xunlai | Three readers, player/area layouts, fixed DataWindow action, handler, bounded drain, and fresh tri-state lifecycle | Disable Xunlai; aliases may retain only independently available Travel commands |
| Chat aliases | Exact parser relation, bounded comparisons, handled result, original-parser preservation, and at least one proved local action | Rewrite only aliases for proved actions; otherwise preserve the original parser |
| Team Apply | Seven named builders, exact opcodes/payloads, sender, bounded drain, fresh complete Party proof, and runtime confirmations | Disable Team Apply only; Builds and Teams remain editable |
| 4 GB mode | Manifest-bound JS/WASM pair, normalized Emscripten glue, every audited pointer-conversion site, one memory shape, and memory-only rewrite | Retain safe 2 GB mode |

Chat aliases never own a dispatcher or mailbox. The transform specializes the
parser to the effective Travel and Xunlai capabilities. It must not read or
write an official client global when an action is absent.

Team Apply depends on complete fresh Party proof. Travel and Xunlai do not
depend on Party. Host-owned authoring, accounts, settings, updater behavior, and
other non-memory features remain available regardless of client verdicts.

Raw function-body digests bind a derived transform to the candidate bytes; they
are not compared with a historic digest at the process boundary. The isolated
verifier must first prove the signature, normalized role, call relationships,
and field witnesses. The boundary then checks the derived digest shape and the
typed evidence, while production rechecks that exact digest against the
candidate function before rewriting it. This distinction permits routine
function-index and static-data relocation without weakening input binding.

## Patch-day playbook

The scheduled recertification workflow detects a changed ArenaNet code
generation and runs the same non-authoritative evidence tools used locally.
It never uploads ArenaNet binaries and cannot publish source authority.

For an equivalent rebuild:

1. Verify the official manifest and exact JS/WASM pair.
2. Run the isolated verifier with exact regression shortcuts disabled.
3. Record each feature verdict, invariant, input hash, verifier ABI, and derived
   output hash.
4. Transform every effective capability profile and validate each output.
5. Run native double-click and 4 GB pair qualification independently.
6. Store the signed machine-readable report and mark the generation as already
   processed. The report remains evidence only.
7. Open no source PR. Players use the locally proved features immediately.

For a refusal:

1. Keep the official client playable and disable only the refusing feature and
   its explicit dependants.
2. Open or update one tracking issue naming the failed invariant and candidate
   count when applicable.
3. Preserve the preceding and current artifacts locally. Never commit or upload
   them.
4. Reproduce with the exact shortcut tables disabled.
5. Classify every changed operand. Do not approve a common delta, copied
   address, unexplained constant, or partial occurrence ledger.
6. Add positive equivalent-relocation tests and adversarial change, duplicate,
   ambiguity, timeout, malformed-boundary, and output-mismatch tests.
7. Run the complete acceptance chain before publishing a verifier change.

The workflow's durable success ledger prevents repeated expensive derivation.
It is bound to the verifier ABI and generation hash and cannot grant runtime
authority.

## Retained evidence and lessons

| Generation | Available evidence | Valid claim |
| --- | --- | --- |
| AEC predecessor | Retained official JS/WASM pair and full structural/mutation replay | All current feature proofs and all supported 4 GB profiles pass structurally |
| fc931 | Non-binary workflow evidence only | Useful relationship evidence; no retrospective binary-pass claim |
| e017 current | Retained official JS/WASM pair and full structural/mutation replay | All current feature proofs and all supported 4 GB profiles pass structurally |

The retained generations taught these rules:

- Whole-body hashes fail safe but cannot survive routine function-index or
  static-address relocation. Relocatable operands need explicit relationships.
- A shared movement of mutable addresses is not ownership proof. Complete
  occurrence ledgers and independent content anchors are required.
- A locator that collapses zero and multiple candidates hides the difference
  between changed and ambiguous behavior. Candidate counts belong in reports.
- A capability can be proved yet ineffective because a dependency refused.
  Status, manifest, parser generation, and runtime exports must all use the same
  effective capability set.
- Exact-known clients are the most important place to disable exact shortcuts;
  otherwise regression fixtures can hide a missing structural witness.
- Parse once and share an input-bound proof context. This keeps all-feature
  verification comfortably within the utility-process timeout without weakening
  evidence.
- Preparation and production are separate trust boundaries. Preparation may
  derive a candidate once; production must repeat the transform and validate
  the exact output.

## Acceptance before merge or release

The stack is mergeable only when:

- full repository verification and exact-head CI pass for every layer;
- retained AEC and e017 artifacts pass with exact shortcuts disabled;
- every proof-anchor mutation disables only its owning capability;
- clicks, double-clicks, bursts, and drags emit no synthetic touch events;
- all supported 4 GB profiles allocate above 3 GB, reject mixed generations and
  corrupt caches, and prove that only the WASM memory maximum changes;
- an exact-SHA ad-hoc developer build passes packaged smoke and the feature QA
  checklist in [Release verification](release-verification.md) without claiming
  release signing or saved-login authority.

Stable publication remains a human product decision. Automation cannot decide
whether the game looks and behaves correctly.
