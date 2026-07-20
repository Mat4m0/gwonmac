# Internals

How the client is put together and how this repo drives it. For running the
game, see the [README](../README.md).

## How the client is built

Guild Wars Reforged shipped on Android and iOS in June 2026. The mobile client
turned out not to be a native port: it is a **Capacitor WebView wrapping an
Emscripten-compiled build of the game**, with an Astro-built launcher around it.
The wasm core is platform-agnostic — every platform service is injected as a
plain JavaScript object — which means the same module that runs inside the app's
WebView runs in an ordinary browser, given a host that supplies those services.

That is what `harness/` is.

## Status

**The client boots and talks to ArenaNet.** The runtime initialises, the
snapshot opens, reads are served on demand, the twelve `File*.ArenaNetworks.com`
content servers resolve, and the client completes a short exchange with each —
21 bytes out, 32 back — which is it sampling them before choosing one.

Blocked on **authentication**: `login`, `secureStorage` and `nativeAccount` are
logging stubs, so there are no credentials to present.

Rendering is unverified. Headless Chromium aborts at
`GL ES 3.0 default vertex shader compilation failed`
(`Engine/Gr/Gles3/GlShaderCache.cpp:959`) under SwiftShader, immediately after
logging "first frame presented", so the presentation path is wired but what a
real GPU does is unknown.

## Layout

| | |
|---|---|
| `gw.py` | the whole runtime: downloads, serves, relays, opens a browser |
| `harness/` | the page it serves; supplies the `Module.*` services |
| `images/`, `fonts/` | loading-screen art and typeface |
| `gwkey.py` | extracts the client's access key from an APK |
| `gwpatch.py` | the patch protocol, standalone |
| `tools/` | wasm patching, scanning and symbol recovery |

## What is committed that arguably should not be

No game binaries are in this repo; they are fetched from ArenaNet's CDN at
runtime. Three deliberate exceptions:

- **The access key**, hardcoded in `gw.py`. It ships in the public app bundle
  and identifies the client rather than a user. Hardcoding it is what lets
  `gw.py` run with nothing to configure. `gwkey.py` extracts a fresh one from
  an APK if it rotates.
- **`images/`** — the Guild Wars logo and four screenshots. ArenaNet's artwork,
  committed so the loading screen works offline and does not hotlink a fan site
  on every run. Screenshots from
  [Snapshot Henchman](https://bloogum.net/guildwars/), credited on screen.
- **`harness/favicon.ico`** — guildwars.com's icon, so the browser tab looks
  like the game rather than a blank page. ArenaNet's mark, same category as
  `images/`.
- **`fonts/Fremont.woff`** — the loading typeface. Note this one is *not*
  ArenaNet's: Fremont is © SoftMaker Software GmbH and the name is their
  trademark, so the "interoperating with a game you own" reasoning does not
  cover it. Of the three this is the one most likely to be a real problem if
  the repo is ever opened up.

None of these is a precedent for committing anything else.

## Builds and downloads

### Which build

`--build` selects the pair to fetch, defaulting to `jspi`:

```bash
python3 gw.py --build jspi      # 8.2 MB, what Chrome picks
python3 gw.py --build asyncify  # 27.8 MB, for Safari/iOS
python3 gw.py --build both
```

The harness feature-detects at runtime exactly as the shipped launcher does —
`ios ? Asyncify : 'Suspending' in WebAssembly` — and falls back if the preferred
glue is absent.

**If you switch builds, clear `dist/` first.** `gw.py` skips files that are
already present at the right size, so a stale `Gw.wasm` lingers. Both builds were compiled
with the same output basename, so `Gw.jspi.js` also asks for `Gw.wasm`; the
harness redirects that via `locateFile`, but a leftover file is still confusing
to reason about. The log line names the pair actually in use:

```
loading Gw.jspi.js (wasm: Gw.jspi.wasm) ...
```

### The pieces individually

```bash
python3 gwkey.py base.apk        # -> access.key (mode 0600)
python3 gwpatch.py               # list the manifest
python3 gwpatch.py Gw.wasm -j 8  # fetch and reassemble one file
```

`gwpatch.py` caches chunks by content hash under `gwpatch-cache/`, so a later run
against a newer manifest only fetches hashes that actually changed. That is what
makes it an updater rather than a downloader.

### Why not `python3 -m http.server`

Two reasons, both fatal:

- It ignores `Range` and answers `200` with the whole file. Snapshot reads are
  small and random, so every read would drag the entire image.
- It does not know `application/wasm`, which `instantiateStreaming` requires.

`gw.py` handles both, and additionally serves `Gw.snapshot` **virtually from
`gwpatch-cache/`** — mapping each range onto the 256 KB chunks covering it. Since
reads are on demand, you can boot without ever assembling the 4.2 GB file.

## What the manifest contains

| File | Size | Notes |
|---|---|---|
| `Gw.js` | 493 KB | Emscripten glue; hosts the `EM_ASM` bodies |
| `Gw.wasm` | 27.8 MB | Asyncify build |
| `Gw.jspi.js` | 470 KB | glue for the JSPI build |
| `Gw.jspi.wasm` | 8.2 MB | JSPI build — same game, ~4× smaller code section |
| `Gw.snapshot` | 4.20 GB | game data image, read on demand |
| `version.json` | 127 B | build metadata |

`chunkSize` is 256 KB and `compressionMode` is `none`.

## Notes on the module

Both builds are stripped: no `name` section, 17.6k functions, no symbols. The
`external_debug_info` custom section names `Gw.wasm.debug`, but that file is not
in the manifest — the sidecar is built and not shipped.

The JSPI build is the better analysis target. It has essentially the same
function count as the Asyncify build (17,596 vs 17,648) in 6.5 MB of code rather
than 26.2 MB; the difference is Asyncify's instrumentation of every suspendable
call site.

`target_features` lists no `atomics` and no SIMD, so the module is
single-threaded. There is no `SharedArrayBuffer`, and therefore **no COOP/COEP
headers are needed** to host it — usually the most painful part of self-hosting
an Emscripten build.

Imports are 212 `env` plus 7 `wasi_snapshot_preview1`. EGL appears in the import
list, so GLES is translated to WebGL by Emscripten's shim.

### Host interfaces

The glue reads platform services off `Module`. Implementing these is the whole
job:

| Object | Purpose |
|---|---|
| `image` | random-access reads over `Gw.snapshot` |
| `socket` | TCP; `connect(destAddr)` returns a socket object |
| `dns` | `resolve(name)` → address |
| `shop`, `login`, `nativeAccount`, `adProvider`, `secureStorage`, `browser`, `events` | commerce, accounts, telemetry |

`image` is the interesting one:

```
open(path)                                   -> handle (0 = failure)
fileSize(handle)                             -> size, SYNCHRONOUSLY
readAsync(imageId, offset, null, buf, bytes) -> Promise, writes into HEAPU8 at buf
isCached(handle, offset, size)               -> truthy
cacheAsync(handle, offset, size, progressCb) -> Promise
close(handle)
```

Random access with an explicit caching layer means the snapshot is streamed on
demand. Booting touches ~30 chunks, not all 4.2 GB.

`fileSize` is synchronous, so the size must be known before the module asks —
the harness reads it from `snapshot-chunks.json` before loading the glue.

**Nine of these are awaited or `.then()`d by the glue.** Returning `undefined`
from one throws `Cannot read properties of undefined (reading 'then')` and kills
the frame mid-connect, so a stub for any of them must be a promise, not merely
callable:

```
image.cacheAsync            adProvider.showInterstitial
dns.resolve                 ageSignals.check
secureStorage.getCredentials / storeCredentials / clearCredentials
shop.initialize / inAppPurchase
```

`socket.connect(destAddr)` returns an object on which the glue assigns
`onopen`, `onclose` and `onmessage` — and it calls `onmessage` with the payload
directly, not with an event.

## The relay is deliberately narrow

Browsers cannot open raw TCP — which is exactly why the shipped Capacitor build
carries a native socket plugin. `gw.py` stands in for it, on the same port it
serves the page from, so the bridge is same-origin with the harness.

A WebSocket-to-TCP bridge on localhost is an open proxy, and every page in your
browser can reach it, not just this one. Without limits, any site you visit
could use it to reach hosts on your LAN it could never reach directly. So:

- it binds `127.0.0.1` only
- `/dns` resolves names under `arenanetworks.com` / `guildwars.com` and nothing else
- it dials **public unicast addresses only** — loopback, RFC1918, CGNAT and
  link-local (including cloud metadata endpoints) are all refused, so the bridge
  cannot reach anything a page could not reach directly
- destination ports are allowlisted (`6112,80,443` by default)
- the `Origin` header must be this server

The address rule replaced an earlier one that allowed only IPs the relay had
itself resolved. That was tighter but wrong: the client takes its game server
address from the authenticated login response, not from DNS, so no lookup ever
passes through `/dns` and nothing legitimate could connect.

`GW_RELAY_DOMAINS` and `GW_RELAY_PORTS` widen the allowlists; do that only if
you have thought about the above. `GW_RELAY_ALLOW_PRIVATE=1` disables the
address rule outright and exists for `e2e.js`, which dials a loopback fixture —
it announces itself loudly at startup and is not for ordinary use.

## Loading-screen footer links

Discord, GitHub and Donate, in the middle of the footer, mirroring
gwtoolbox.com. The destinations were taken from that site rather than invented:
`discord.gg/pGS5pFn` and `opencollective.com/gwdevhub_collective`, both
confirmed live.

Every link carries `rel="noopener noreferrer"`: these are external sites, and
there is no reason to hand them a window handle or the address of a server on
someone's machine. `e2e.js` asserts it.

## CI

`.github/workflows/release.yml` runs the suite on every push to `main` and, if
it passes, publishes a release: a zip of `gw.py`, `harness/`, `images/`,
`fonts/`, the README and the licence -- what someone needs to run it, without
`tests/`, `tools/` or `docs/`.

Three things it is doing deliberately:

- **`test_no_leaks.py` gates the release.** Publishing is exactly the moment
  that guard matters, since a release turns a mistake into a download.
- **No `pip install` anywhere**, and a bare `import gw` on a clean interpreter.
  If the zero-dependency property is ever lost, that step is where it breaks.
- **Python 3.8 and 3.13**, because the README promises 3.8 and an untested
  floor is a guess.

The release job re-tests the *unpacked zip* rather than the checkout, so a file
that only resolves because it happens to sit in the repo is caught before it
ships.

## Tests

```bash
python3 tests/test_gw.py         # framing, allowlists, DNS, ranges, snapshot, proxy
python3 tests/test_no_leaks.py   # nothing publishable-by-accident is tracked
node    tests/test_harness.js    # Module adoption and the host surface
node    tests/e2e.js             # the real harness in headless Chromium
```

Everything runs offline against local fixtures — a synthetic snapshot, a
stand-in TCP server, and a mock glue that drives `Module.*` the way the real
glue does. `e2e.js` is the one that matters: every harness bug so far has lived
in that wiring rather than in the parts a unit test reaches.

It needs a Chromium. It looks in `~/.cache/ms-playwright`, or set `CHROME_PATH`;
`npx playwright install chromium` if you have neither.

What it cannot check is whether the real wasm is satisfied — that still needs
artifacts and network.
