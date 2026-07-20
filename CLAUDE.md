# CLAUDE.md

Context for anyone — human or agent — working on this repo. `README.md` is the
user-facing guide; `docs/internals.md` is the technical write-up. This file
covers how the project is laid out, the conventions it follows, and the
constraints that are not obvious from reading the code.

## What this is

Guild Wars Reforged shipped on Android and iOS in June 2026. The mobile client
is not a native port: it is a Capacitor WebView wrapping an Emscripten build of
the game, with an Astro launcher around it. Every platform service is injected
onto a plain JavaScript `Module` object, so the same WebAssembly module runs in
an ordinary browser given a host that supplies those services.

`harness/` is that host. `gw.py` downloads the client, serves it, bridges its
network access, and opens a browser.

## Status

The client downloads, boots, and reaches ArenaNet's servers. It resolves all
twelve `File*.ArenaNetworks.com` content servers and exchanges 21 bytes out /
32 back with each, and it reaches `Auth1.ArenaNetworks.com` with an 82-out /
22-back handshake.

**Authentication is not implemented.** `login`, `secureStorage` and
`nativeAccount` are logging stubs, so nothing can present credentials. That is
the blocker on actually playing.

**Rendering is unverified.** Headless Chromium aborts at `GL ES 3.0 default
vertex shader compilation failed` (`Engine/Gr/Gles3/GlShaderCache.cpp:959`)
under SwiftShader, immediately after logging "first frame presented" — so the
presentation path is wired, but what a real GPU does is untested. Reports from
real hardware are the single most useful contribution right now.

## Layout

| | |
|---|---|
| `gw.py` | everything at runtime: update, serve, relay, prefetch, browser |
| `harness/` | `index.html` + `harness.{css,js}` + `loading.{css,js}` |
| `images/`, `fonts/` | loading-screen art and typeface |
| `gwkey.py` | extracts the client access key from an APK |
| `gwpatch.py` | the patch protocol, standalone |
| `getsnapshot.py`, `tools/` | analysis: wasm patching, scanning, symbol recovery |
| `tests/` | four suites, all offline against fixtures |

## Style

Applies to `gw.py` and the JS in `harness/`.

- **Single-line comments.** No block comments. A point that needs a paragraph
  belongs in `docs/internals.md`, not above the code.
- **Comment the surprise, not the mechanism.** Why something is done the odd
  way, not what the next line does. Most lines need no comment.
- **Inline one- and two-line functions.** A name is earned by being called
  from more than one place, or by holding real logic.
- **Fewer lines, same clarity** — right up to the point where a reader has to
  reconstruct intent.

## Things that will bite you

These are non-obvious properties of the client or the environment. Each one is
load-bearing; changing the code around them without knowing they exist tends to
produce a failure that looks like something else.

### Constants use non-canonical, zero-padded LEB128

`i32.const 0x102820` encodes as `41 a0 d0 c0 80 00` — five bytes, not the
canonical four — because LLVM emits fixed-width relocatable encodings. Anything
searching for constants must **decode**, not byte-match an encoded needle:
searching for the canonical form finds nothing, silently, and looks exactly
like "this value is never referenced".

### Nine host functions are awaited

`image.cacheAsync`, `dns.resolve`, all three of
`secureStorage.{get,store,clear}Credentials`, `adProvider.showInterstitial`,
`ageSignals.check`, `shop.initialize`, `shop.inAppPurchase`. Returning
`undefined` from one throws `Cannot read properties of undefined (reading
'then')` and kills the frame mid-connect, so a stub must be a promise, not
merely callable. Re-derive the list if the client updates: find every
`Module.x.y(...)` that is `await`ed or `.then()`d.

### `Module` must be `var`

The glue opens with `var Module = typeof Module != 'undefined' ? Module : {}`.
A `const`/`let` in the harness collides at parse time, or is invisible and the
glue silently builds its own empty object. `tests/test_harness.js` covers both
failure modes.

### `image.fileSize` is synchronous

So the snapshot size must be known before the glue loads, which is why the
harness reads `snapshot-chunks.json` first.

### Both builds share an output basename

`Gw.jspi.js` asks for `Gw.wasm` exactly as `Gw.js` does. `locateFile` has to
redirect, or the JSPI glue silently pairs with the Asyncify binary whenever
both files are present.

### Concurrent chunk reads must be deduplicated

The module drives `cacheAsync` over overlapping regions with ~160 requests in
flight. Without one shared promise per chunk it fetches the same chunk several
times over — measured at 4x amplification, enough that a boot never finished.
See `chunkBytes()` in `harness/harness.js`.

### Snapshot reads are latency-bound, not bandwidth-bound

Each 256 KB chunk costs ~650 ms from the CDN, so throughput scales almost
linearly with concurrency. `PREFETCH_JOBS` is capped at 8 on purpose; see
**Conduct** below before raising it.

### Browsers throttle hidden tabs

Chrome drops background tabs to roughly one timer tick a minute. Anything that
treats a missing heartbeat as "gone" needs a tolerance well above that, or it
fires while the user is merely alt-tabbed. `Watchdog.IDLE` is 150 s for this
reason.

### `geodc.arenanetworks.com` resolves to `0.0.1.2`

An A record carrying a datacenter id, not an address. Windows `getaddrinfo`
rejects `0.0.0.0/8`, so `gw.py` falls back to raw DNS queries — hand-rolled,
since Python has no stdlib resolver beyond `getaddrinfo` and `getaddrinfo` is
the thing being bypassed.

### Game hosts and web hosts are different domains

Game and patch infrastructure is on `arenanetworks.com`; web services are not —
they live on `ncplatform.net`, `arena.net` and `guildwars.com`. Outside a
Capacitor WebView the client rewrites API calls through its own origin, keeping
only the first hostname label, so `PROXY_ROUTES` has to map that label back to
a real host. An unknown route 502s naming itself rather than guessing.

### `python3 -m http.server` cannot host this

It ignores `Range` and does not know `application/wasm`. Both are fatal.

## Zero dependencies is a feature

`gw.py` is stdlib-only: no `pip install`, no Node. This is not minimalism for
its own sake. On Debian, Ubuntu and Fedora system Pythons, PEP 668 makes `pip
install` fail outright with `externally-managed-environment` — which would hit
exactly the non-technical user who downloaded a zip and double-clicked it. The
release workflow asserts this by importing `gw` on a clean interpreter.

Node is required only to run two of the four test suites.

## What is committed that arguably should not be

No game binaries are in this repo; they are fetched from ArenaNet's CDN at
runtime. Three deliberate exceptions:

- **The access key**, hardcoded in `gw.py`. It ships in the public app bundle
  and identifies the client rather than a user. Hardcoding it is what lets
  `gw.py` run with nothing to configure. `gwkey.py` extracts a fresh one from
  an APK if it rotates. `tests/test_no_leaks.py` exempts this one key **by
  value**, so any other credential still fails that check — do not widen the
  exemption to a pattern.
- **`images/` and `harness/favicon.ico`** — the Guild Wars logo, four
  screenshots and the site icon. ArenaNet's artwork, committed so the loading
  screen works offline. Screenshots are by
  [Snapshot Henchman](https://bloogum.net/guildwars/) and are credited on
  screen; keep that credit.
- **`fonts/Fremont.woff`** — the loading typeface. Note this one is *not*
  ArenaNet's: Fremont is © SoftMaker Software GmbH and the name is their
  trademark, so the "interoperating with a game you own" reasoning does not
  cover it.

None of these is a precedent for committing anything else.

## Testing

```bash
python3 tests/test_gw.py         # framing, allowlists, DNS, ranges, snapshot, proxy
python3 tests/test_no_leaks.py   # nothing publishable-by-accident is tracked
node    tests/test_harness.js    # Module adoption and the host surface
node    tests/e2e.js             # the real harness in headless Chromium
```

All four run offline against local fixtures — a synthetic snapshot, a stand-in
TCP server, and a mock glue that drives `Module.*` the way the real one does.
`e2e.js` is the one that matters: every harness bug so far has lived in that
wiring rather than in the parts a unit test reaches. It needs a Chromium, found
via `~/.cache/ms-playwright` or `CHROME_PATH`.

The whole thing can be driven end to end locally — start `gw.py`, drive it with
`playwright-core`. There is no need to ask a human to run it.

What tests cannot cover is whether the real wasm is satisfied, which needs
artifacts and network.

## Conduct

This talks to ArenaNet's production infrastructure, and `ACCESS_KEY` is shared
by every install. That makes download concurrency a decision about *their*
service rather than about one user's patience:

- **Keep `PREFETCH_JOBS` at 8.** Throughput does scale — 16 gives ~7.5 MB/s and
  32 gives ~12 — but a per-user burst is really every install at once, and a
  rate-limited key breaks patching for people who are paying to play the game.
- **Identify honestly and back off.** The `User-Agent` says what this is;
  retries are exponential.
- **Pointing the relay at live game servers is a separate decision** from
  offline analysis, and involves account-bound traffic.

## The relay is an open proxy, deliberately narrowed

A WebSocket-to-TCP bridge on localhost is reachable by every page in the
browser, not just ours. It is bounded by: loopback binding, public-unicast-only
destinations, an allowlisted port set, an `Origin` check, and `/dns` resolving
only under allowlisted domains.

**The address rule is not the domain allowlist.** An earlier design allowed only
IPs the relay had itself resolved; that is tighter but wrong, because the client
takes its game server address from the authenticated login response rather than
from DNS, so no lookup passes through `/dns` and nothing legitimate could
connect. What the rule really guards is reaching hosts a page could not reach
directly — a property of the address, so the address is what gets tested.

`GW_RELAY_ALLOW_PRIVATE=1` disables that check and exists solely for `e2e.js`,
which dials a loopback fixture. It announces itself loudly at startup.

## Next steps

1. **Authentication.** The blocker on playing. It means handling real account
   credentials against live auth servers, which is a different kind of step
   from everything so far.
2. **Confirm rendering on real hardware**, and fix it if it is broken.
3. **The browser's persistent chunk tier does almost nothing** —
   `chunksFromCacheStore` is single digits against ~1400 network fetches, so a
   reload re-downloads the working set. Suspicion is a storage quota rejection
   at ~360 MB; unverified.
