# Client certification record

This directory contains `certified-client.json`, the ArenaNet JSPI code
generation already reviewed by this repository. It is a detector heartbeat,
not runtime authority.

Runtime authorization stays in the compiled certification tables and isolated
local structural proof. There is no remote certification authority. Newly
measured Enhancement facts require a signed application release, and verified
official ArenaNet bytes remain the fallback when optional transforms refuse.

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
