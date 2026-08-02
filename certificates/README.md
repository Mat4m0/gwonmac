# Certificates

Two files: the key that decides whether a fetched certificate feed may be
believed, and the record of which ArenaNet client generation this repository has
already certified.

## The feed's pinned key

`public-key.txt` is the one place this application decides whether a certificate
feed fetched from anywhere may be believed. Its committed content is the
placeholder

```text
PLACEHOLDER-NO-REMOTE-FEED-TRUST
```

which is not a weaker kind of trust — it is none. While the placeholder is
there, `certificateFeedTrust` answers `remote: false`, every fetched feed is
refused with `certificate_feed_signature`, and the snapshot bundled inside the
application governs. That is the state every clone of this repository is in, and
the application is complete in it.

The feed itself carries no instructions: every field is a hash, an address, an
index or a message identifier. And a feed only ever *proposes*. Its template-save
facts are re-derived by the transform already in the application against the
client bytes on the machine, so a signature alone establishes none of them. Its
enhancement facts cannot be re-derived that way — the layout words are addresses
with no structural anchor — so they are accepted only as an exact restatement of
the table compiled into this application. So the worst a stolen key achieves is
withholding a certificate. It cannot mint one.

### What the file holds

One line, and nothing else: the placeholder, or the base64 of a raw 32-byte
Ed25519 public key — 43 base64 characters and one `=`. The algorithm is not
written in the file; `src/main/certification/certificate-feed-trust.ts` pins
Ed25519 and wraps the raw key in its SPKI header. Anything that is neither the
placeholder nor a canonical key line is a refusal, not a fall back to the
placeholder: a mistyped key must be visible as a mistake.

### The one-time key ceremony

Run once, on a machine that is offline and stays offline for the duration. The
private half must never exist in this repository, in a test, in a fixture, or on
a machine that builds anything.

1. Generate the keypair offline:

   ```sh
   openssl genpkey -algorithm ed25519 -out feed-signing.key
   openssl pkey -in feed-signing.key -pubout -outform DER \
     | tail -c 32 | base64
   ```

   The 12 bytes `tail` drops are the fixed SPKI header the application supplies
   itself. What is printed is exactly the line the file wants.

2. Put the private half into the signing environment and nowhere else: an
   environment secret on a protected, manually approved deployment environment,
   restricted to the workflow that publishes a feed. It is never a repository
   secret, never checked out, and never printed.

3. Replace the placeholder line in `public-key.txt` with the printed public key
   and commit that change on its own. The pin can only change by shipping a
   release, which is the whole of what pinning buys.

4. Destroy every copy of the private half outside the signing environment,
   including the file written in step 1 and the machine's shell history.

### What a signed feed is published as

Two assets on the release the application resolves as current:

| Asset                       | Content                                          |
| --------------------------- | ------------------------------------------------ |
| `certificate-feed.json`     | the exact canonical document the signature covers |
| `certificate-feed.json.sig` | base64 of the 64-byte detached Ed25519 signature  |

`pnpm build` writes the document the shipped tables derive to
`build/certificates/feed.json`; a published feed is that document with a
`sequence` higher than both any feed already released and the snapshot compiled
into the application. Both floors bind, so what a candidate must beat is the
higher of them: a feed that does not beat the released one is a replay every
installation holding it refuses, and one that does not beat the compiled-in
snapshot is adopted by nobody, because `governingCertificateFeed` keeps the
newer of the two. Sign the bytes, not a re-serialised copy of them — the parser
accepts exactly one spelling, and a signature that covers a different one
verifies against nothing.

Replacing those two assets on an existing release is the whole of what it takes
to reach installations. No application release is involved, which is the point:
recovery arrives as data.

## Publication

`.github/workflows/certificate-feed-publication.yml` is the only path from the
tables on `main` to those two assets, and it runs on a push that changes a
certification table or this pin.

It derives the candidate twice, on two runners, from the tree and a Node and
nothing else — the generator's whole import graph is this repository plus Node
builtins, so there is no dependency tree for two machines to disagree about. The
two answers must be byte-identical. A disagreement publishes nothing and opens
an issue carrying both hashes, because a derivation that is not reproducible is
a fact about this repository that a person has to read.

The candidate's `sequence` is one past the higher of the two floors above — the
feed in force and the bundled snapshot — resolved in the one job that can see
both, so the two rules can never contradict. That job asks the release list
which release carries a feed rather than probing each one with a download,
because a download that failed and a release that never had the asset are the
same exit code, and reading the first as the second names a sequence
installations have already passed.

The job that signs holds the private key and checks nothing out: a working tree
beside a signing key is every script in it running beside a signing key. It
receives the reproduced bytes as data, re-hashes them against what the two
runners agreed on, restates the spelling and ordering rules a signature must not
cover blindly, and refuses a candidate the published feed has caught up with —
resolved again at that moment rather than before the approval, so a feed
published while a person was deciding blocks this one instead of being
overwritten.

The tier is read out of the candidate. An entry that only moves template-save
facts reaches the approval gate on the push that produced it, because every
installation re-derives those facts from its own client bytes. An entry carrying
Enhancement facts reaches it only on a run someone dispatched with
`enhancement_facts` set: nothing on the receiving machine re-derives a layout
address, so a person says that is what they meant.

## The go-live checklist

Four things this repository cannot do for itself. Each one is a setting or a
secret in an account, and scripting around any of them would mean holding the
credentials that can change it — a larger blast radius than the thing being
automated. Until all four are done the publication workflow refuses in its first
job, which is the intended state of every clone.

1. In **Settings → Actions → General**, allow GitHub Actions to create and
   approve pull requests. Without it the recertification workflow pushes its
   branch and files its issue but cannot open the proposal.
2. Create the **`certificate-publishing`** environment with required reviewers
   and a deployment branch rule limiting it to `main`. This is the one-click
   human approval every publication passes through.
3. Run the key ceremony above on an offline machine, and add the private half as
   the environment secret **`CERTIFICATE_FEED_SIGNING_KEY`** — on that
   environment, never as a repository secret. It is the PEM `openssl genpkey`
   wrote, pasted whole.
4. Replace the placeholder line in `public-key.txt` with the printed public key,
   commit that on its own, and ship a release carrying it. Until that release is
   what installations run, they trust no feed at all.

### Rotation and loss

There is no revocation list and no second pinned key, deliberately: a second key
is a second thing that can be stolen, and the failure it would cover — a lost
key — is already survivable. A lost or suspected key is handled by running the
ceremony again and shipping a release carrying the new pin. Until that release
lands, feeds signed by the old key keep verifying, and the local proof keeps
being what decides whether any of them enables anything.

A feed's `sequence` only ever increases. A captured older feed replayed at an
application that already holds a newer one is refused, so a replay cannot
withdraw a certificate.

## The certified client generation

`certified-client.json` records one digest: the identity of the ArenaNet JSPI
code artifacts — `Gw.jspi.js` and `Gw.jspi.wasm` — whose certificate is on
`main`. `Gw.snapshot` and `version.json` are deliberately outside it, because
game content is republished on schedules that have nothing to do with the WASM.

It carries no authority whatsoever. Nothing reads it at run time; it decides
only whether the scheduled recertification workflow does any work this quarter
hour. A wrong digest costs a redundant derivation or a late one, and what a
build may actually be transformed for is still decided by the tables compiled
into the application and by the local structural proof.

```json
{ "formatVersion": 1, "codeGeneration": "<64 hex characters>" }
```

`pnpm client:official` prints what is published now beside what is recorded, and
`pnpm client:official --record <digest>` writes the generation it is handed.
The digest is an argument and not a fresh fetch on purpose: a derivation is
several minutes of downloading and certifying, ArenaNet may republish inside
that window, and a record naming a generation nothing certified would leave the
detector reading published == recorded and hiding the new build until the patch
after it. A record this file's parser cannot read is a failure rather than a
mismatch — reporting it as changed would chase a client that may already be
certified, and reporting it as unchanged would hide a patch forever.
