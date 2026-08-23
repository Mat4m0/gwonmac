# Project news and service status

This document owns the signed, presentation-only feed used by **Updates &
Status**. It does not own ArenaNet game data or application installation.

## Authority boundary

The main process fetches one static document from
`https://mat4m0.github.io/gwonmac/content/v1/feed.json`. The renderer never
fetches it directly. The app verifies the Ed25519 signature, closed schema,
size limits, expiry, and monotonic sequence before any text crosses IPC.

The feed may contain plain-text notices, fixed action kinds, and player-facing
release summaries. It cannot contain HTML, Markdown, arbitrary URLs, update
assets, compatibility decisions, feature switches, or executable data. A
remote notice never delays or blocks Guild Wars. Local client verification
remains the only compatibility authority.

## Publishing

`content/feed-source.json` is the source of truth. Increase `sequence` whenever
its content changes. A matching release entry is required before staging a new
application version; the release workflow uses that entry in both the app and
the GitHub Release body.

After a content change reaches `main`, the update-feed workflow:

1. rebuilds both application update tracks;
2. refuses a content rollback or changed content at the same sequence;
3. signs the source with the protected `CONTENT_FEED_PRIVATE_KEY` environment
   secret;
4. deploys update tracks and content as one GitHub Pages artifact; and
5. downloads and verifies the public result.

The app pins the corresponding public key. Key rotation requires an app
release containing the next public key before the signing secret changes.

## Local development

Ordinary `pnpm dev` makes no project-content request. Use the signed loopback
harness when working on this feature:

```bash
pnpm dev:content
pnpm dev:content -- --scenario arenanet-update
pnpm dev:content -- --scenario invalid-signature
```

The command prints its request count and supports every scenario listed by
`pnpm dev:content -- --scenario nope`. Its generated private key is temporary
and test-only. Packaged applications ignore loopback endpoint and key
overrides.

The focused Electron proof is:

```bash
pnpm build
pnpm exec playwright test --config=tests/electron/playwright.config.ts \
  tests/electron/content-feed.spec.ts
```

## Privacy and failures

**Check online for news and service status** is independent from application
updates and ArenaNet connections. Turning it off makes zero requests to the
content endpoint. The verified cache remains local but is not presented as
current status while checking is off.

Failures use a closed diagnostic reason and never record downloaded text,
response bodies, signatures, or identifiers. No telemetry is sent by the app.
GitHub receives the ordinary request metadata involved in serving GitHub
Pages.
