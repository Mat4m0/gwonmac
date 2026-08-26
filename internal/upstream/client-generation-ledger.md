# ArenaNet client generation ledger

> **Status: historical seed and process definition.** GitHub issues and signed
> attestations are the canonical automated generation ledger. This file keeps
> pre-automation observations and defines the safe schema. It cannot grant a
> runtime capability. The isolated verifier remains the only launch authority.

## Why this ledger exists

ArenaNet can replace the public JS/WASM pair before an investigation finishes.
Without an exact generation identity, later results cannot be compared and a
maintainer can easily repeat an old wrong turn.

The automated record uses only privacy-safe facts:

- code-generation SHA-256;
- exact JS and WASM SHA-256 and byte length;
- verifier ABI and source commit;
- closed per-feature verdicts, failed invariant names, and candidate counts;
- exact transform-output SHA-256 values; and
- the workflow, issue, or private investigation reference.

Never put client bytes, local paths, function indices, offsets, addresses,
account data, credentials, or raw diagnostic output in this file or a public
workflow artifact.

## Durable evidence model

For automated recertification, a closed proved issue or open refusal issue is
the permanent index and deduplication record. A GitHub attestation binds the
bounded `generation.json` predicate to the exact official WASM digest. The
ordinary Actions artifact retains only `generation.json` and
`carry-forward.md` for 90 days so reviewers can inspect them conveniently.

Detailed locator reports and the official JS/WASM pair remain runner-temporary.
When a generation refuses, a maintainer must preserve the complete private
investigation bundle before ArenaNet replaces it. Follow
[recertify.md](recertify.md). The bundle is evidence, never an exact-build
allowlist or a second source of runtime authority.

## Bootstrap observations

These rows predate the deployed automated ledger or preserve facts that cannot
be reconstructed from it. Do not copy future automated results into this
table; search the `client-recertification-proved` and `client-recertification`
issues instead.

| Date | Code generation | Official artifacts | Verifier | Outcome and retained evidence |
| --- | --- | --- | --- | --- |
| Historical | AEC predecessor | Private retained pair | Current structural replay | Retained regression generation; all current feature proofs and supported 4 GB profiles passed with exact shortcuts disabled. |
| Historical | `fc931…` | Pair not retained | Evidence-only workflow | Relationship evidence exists, but no retrospective binary-pass claim is valid. |
| Before 2026-08-26 | `e017ae15a4b46743a8a1a57bcd7c28a14894dbeeaf7a1c1775473f32c8df369e` | WASM `b8cc509714b82b69fdfd79a26ba257aa4c9ef23d90bca9dfcbbd044e371cfb17`, 8,196,932 bytes; JS `653efb3634c8a94e4ea7727a877392f2f3fd6217db0ef1a05c89d9821e9558b1`, 469,906 bytes | ABI 7 | Previous recorded generation. Private bundle reference `pre-2026-08-26-e017ae15`; current verifier, native double-click, and 4 GB qualification pass. Exact-client adversarial replay retained with the bundle. |
| 2026-08-26 | `9fbfcb1cbb8d77b191bd5510022a4f0c0c5e7515b5a6918a55acdd65b6718f61` | WASM `a3644a2a18bbfa237e578f2eb21d277e645b6b201f65034e00b3dcf021cae7a3`, 8,206,211 bytes; JS `e5fd0f1233243d7ba0dfb8432cf4a45f157af6632fad6ea39442428f5280070f`, 469,906 bytes | ABI 7; local source `1ad40fa8` | **Pre-deployment refusal / release blocker.** File proof: `template-shape-changed`; cursor: `cursor.event-owner`; every requested Core/Tools memory capability refused at a named anchor; complete double-click route refused; 4 GB qualification and all four exact-client adversarial tests consequently refused. Private bundle reference `2026-08-26-9fbfcb1c`. Attach the eventual signed refusal/proof record before release. |

Do not edit an old bootstrap outcome when a newer verifier ABI rechecks the
same code generation. The canonical issue and signed record preserve the new
result.

## Comparison questions

Compare generations by semantic evidence, not by a global numeric delta:

1. Which feature changed from `proved` to `changed` or `ambiguous`?
2. Which named invariant refused, and how many candidates remained?
3. Did the effective dependency closure disable anything else?
4. Did each selected transform reproduce its recorded output digest?
5. Did native double-click and every supported memory profile prove on the
   exact selected predecessor?
6. Which live QA result cannot be established from offline evidence?

If a new relationship is learned, add it to the relevant exact-build evidence
file or investigation log. Keep this ledger as an index, not a dump of locator
internals.
