# The certificate feed's pinned key

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

## What the file holds

One line, and nothing else: the placeholder, or the base64 of a raw 32-byte
Ed25519 public key — 43 base64 characters and one `=`. The algorithm is not
written in the file; `src/main/certification/certificate-feed-trust.ts` pins
Ed25519 and wraps the raw key in its SPKI header. Anything that is neither the
placeholder nor a canonical key line is a refusal, not a fall back to the
placeholder: a mistyped key must be visible as a mistake.

## The one-time key ceremony

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

## Rotation and loss

There is no revocation list and no second pinned key, deliberately: a second key
is a second thing that can be stolen, and the failure it would cover — a lost
key — is already survivable. A lost or suspected key is handled by running the
ceremony again and shipping a release carrying the new pin. Until that release
lands, feeds signed by the old key keep verifying, and the local proof keeps
being what decides whether any of them enables anything.

A feed's `sequence` only ever increases. A captured older feed replayed at an
application that already holds a newer one is refused, so a replay cannot
withdraw a certificate.
