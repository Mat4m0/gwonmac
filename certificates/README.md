# Client certification records

This directory currently contains:

- certified-client.json: the ArenaNet JSPI code generation already reviewed by
  this repository; and
- public-key.txt: the real Ed25519 pin used by the transitional remote
  certificate-feed implementation.

The two files have different authority. certified-client.json is a detector
heartbeat and is not read at runtime. public-key.txt currently enables remote
signature verification, but the remote-feed path is scheduled for hard-cut
deletion by plans/full-refactor-optimization.md.

## Current remote-feed status

The committed public-key.txt is a canonical raw Ed25519 public key encoded as
base64. It is not the historical PLACEHOLDER-NO-REMOTE-FEED-TRUST sentinel.
Consequently, an update-capable release may request:

~~~text
certificate-feed.json
certificate-feed.json.sig
~~~

from the fixed current-release asset URLs whenever the ordinary
application-update trigger permits it.

At the 2026-08-10 evidence baseline, recent public Gwonmac releases published
neither asset. The code and pin therefore exist, but the feed is not an
operational ArenaNet patch-recovery guarantee.

Even with correctly signed assets, the feed has a deliberately narrow effect:

- template-save facts are proposals and must be re-derived against the exact
  local official client bytes;
- Enhancement facts have no independent structural proof and are accepted only
  when they exactly restate ENHANCEMENT_BUILDS already compiled into that
  application; and
- official ArenaNet bytes remain the fallback whenever proof refuses.

An older app therefore cannot gain newly measured Enhancement layouts or
commands from the feed. Those facts still require a signed application release.
The only distinct potential benefit is rare template-only recovery when the
isolated local structural verifier cannot derive the fact itself.

That remaining benefit does not currently justify the signer, publication
workflow, runtime delivery, persisted derived record, diagnostics vocabulary,
and test hierarchy. The accepted refactor plan removes the remote feed and
keeps:

- compiled certification tables;
- the isolated local verifier;
- the existing certification CLI;
- the scheduled recertification workflow; and
- official-client fallback.

Until that deletion lands:

- do not expand the feed schema;
- do not add another consumer or scheduler;
- do not treat feed availability as a release or patch-day promise;
- do not allow a signature to replace local proof; and
- do not publish newly measured Enhancement facts as though an old app could
  establish them.

The existing publication workflow is transitional code, not the supported
maintainer path. Do not invest in restoring it unless a concrete incident first
satisfies the evidence trigger in the accepted refactor plan.

## The certified client generation

certified-client.json records one digest: the identity of the ArenaNet JSPI code
artifacts, Gw.jspi.js and Gw.jspi.wasm, whose current certificate has been
reviewed on main.

Gw.snapshot and version.json are deliberately outside this identity because
game content can be republished independently of executable client code.

The file carries no runtime authority. It decides only whether the scheduled
recertification workflow needs to run its more expensive derivation:

~~~json
{ "formatVersion": 1, "codeGeneration": "<64 hex characters>" }
~~~

pnpm client:official prints the published generation beside the recorded one.
pnpm client:official --record <digest> writes the exact digest it is handed.
Recording an explicit digest rather than fetching again prevents a second
ArenaNet publication during derivation from marking unreviewed bytes as
reviewed.

The scheduled detector:

1. fetches the bounded official manifest;
2. compares the published JSPI generation with this record;
3. exits quickly when they match;
4. downloads only the code artifacts when they differ;
5. runs the same local certification implementation;
6. opens a proposal or a named investigation issue; and
7. records a new generation only with the reviewed certification change.

A wrong digest costs an unnecessary or delayed derivation. It cannot authorize
a transform. Runtime authorization remains in the compiled tables and isolated
local structural proof.
