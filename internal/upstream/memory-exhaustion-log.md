# Long-session WebAssembly memory exhaustion

> **Status: cause confirmed; upstream growth cause unresolved; 4 GB host
> mitigation withdrawn.** This is a
> historical investigation record. Current diagnostics behavior is defined by
> [Diagnostics](../../docs/diagnostics.md).

## Conclusion

The examined ArenaNet client declares a 2 GiB WebAssembly maximum. Long play
sessions can grow the heap to that maximum. The next allocation then fails and
an ArenaNet assertion aborts the client.

Increasing `MAXIMUM_MEMORY` to 4 GB would buy about 2.5 times the usable memory
on the measured client. It would not fix the continuing growth. The evidence
does not distinguish a leak, fragmentation, or retained content.

GWonMac briefly shipped an exact-build post-build 4 GB transform. It was
withdrawn after two users reported severe graphical corruption after 30–45
minutes with the option enabled. That is strong evidence that the transform is
not safe to ship, although it does not prove the exact corrupt pointer path. A
compiler-supported ArenaNet rebuild or a source-level cache-lifecycle fix is
still required.

gwonmac records heap growth and warns before likely exhaustion. It does not show
a minutes-remaining estimate to players because real workloads made that number
misleading.

## Confirmed evidence

The first two reports arrived on 2026-08-03. Both players used app 2026.8.3,
client build 38,797, and an M1 Pro with 16 GB of system memory.

| Session | Time to abort | Reason | Fingerprint | Peak heap backing |
| --- | ---: | --- | --- | ---: |
| `5eb4a64e` | 3 h 18 m | `assertion` | `99d845da` | 2,147,483,648 |
| `9ae56272` | 2 h 23 m | `assertion` | `a860e578` | 2,147,483,648 |

Both players saw socket resets at the same wall-clock seconds while playing
together. That evidence points to server-side resets and does not implicate the
host socket layer.

The client declares the same limit in two artifacts:

| Artifact | Initial memory | Maximum memory |
| --- | ---: | ---: |
| `Gw.wasm` | 256 MiB | 2,048 MiB |
| `Gw.jspi.wasm` | 256 MiB | 2,048 MiB |

One captured failure ended with:

```text
ASSERTION FAILED: Out of memory!
Engine/Gr/Gles3/GlTex.cpp:397
```

At that point, `heapBytes` was exactly 2,147,483,648. The causal chain was:

1. `wasmMemory.grow()` exceeded the module maximum and threw.
2. `growMemory` caught the error and returned failure.
3. `_emscripten_resize_heap` failed.
4. The allocator returned null.
5. ArenaNet's texture path asserted.

Which assertion fails first is incidental once allocation cannot continue.

## Scope

The defect was not specific to Eye of the North. Further reports included:

- Resplendent Makuun in Nightfall after about 25 minutes; and
- Dunes of Despair in Hard Mode after about 20 minutes.

The measured heap tracked newly encountered content more than map connections.
Five connections to revisited maps produced no growth in one recorded session.
The heap did not converge while new content continued to load.

A 4 GB maximum is mitigation only. Boot used about 700 MiB. The usable budget
would increase from about 1,348 MiB to about 3,396 MiB. A measured 66-minute
failure would move to roughly 2.5 hours if the growth rate stayed similar.
wasm32 has no larger address space, so the underlying growth still needs an
upstream fix.

## Wrong turn 1: the export showed the crash history

The diagnostics export included one `previousSession` and reported
`webContents.destroyed`. We first concluded that an earlier session had not
crashed.

The diagnostics directory held more sessions:

```text
session-8dba412a  2026.8.2  1.7 min  wasm.abort  other  a6311932
session-90067a67  2026.8.2  1.1 min  wasm.abort  other  a6311932
session-5eb4a64e  2026.8.3  207 min  wasm.abort  assertion  99d845da
```

The export selected only the newest previous session. Its silence could not
describe the sessions that it dropped. A separate quit-order defect also logged
`webContents.destroyed` after the clean-shutdown record.

**Lesson:** state an instrument's retention boundary before drawing a conclusion
from missing data.

## Wrong turn 2: fixed bytes meant useful time

The first warning used 256 MiB and 128 MiB of remaining reserve. The same byte
count gave very different time:

| Workload | Measured rate | Time from 256 MiB |
| --- | ---: | ---: |
| Open world, 2 h 16 m | 555 MiB/h | about 28 min |
| Eye of the North mission | reached the cap in about 30 min | about 2–3 min |

The message also told a player to travel to an outpost. A player in a dungeon
could reasonably read that as an instruction to abandon the run and ignore it.

The fixed byte thresholds remain only as a fallback when there is not enough
rate evidence. A tested 64 MiB hard floor still fired before the time rule at
the open-world rate. The floor became 32 MiB.

**Lesson:** use the unit in the player-facing claim. Bytes did not prove time.

## Wrong turn 3: a short sample window could measure the heap

WebAssembly memory reserve grows in steps. The examined Emscripten glue grew by
one fifth of the current size, capped at 96 MiB. At 555 MiB/h, one step arrived
about every ten minutes.

A five-minute window therefore saw no step or one whole step. It alternated
between 384 and 1,152 MiB/h for a true average near 555 MiB/h. The displayed
estimate moved through 15, 45, 10, and 30 minutes instead of counting down.

The original tests used smooth linear ramps. The client produced staircases.
The corrected estimator used growth steps at least ten minutes apart.

Two related corrections followed:

- Warm-up begins at the client's first allocation, not page load. A slow first
  download can keep the page open before the client starts.
- Filled bytes and reserved bytes are different. Immediately after a growth
  step, filled bytes are close to the previous reserve. Using the new reserve
  made one whole step appear to vanish immediately.

**Lesson:** a test that uses a shape the system never produces can confirm a
false model.

## Wrong turn 4: an estimate good enough for policy was safe to print

A complete 2026.8.4 Eye of the North run contained two aborts and 33
`wasm.heapGrew` events. The final reserve step was 1,990 MiB to 2,048 MiB. The
client died 42 seconds later at the exact cap with fingerprint `8f57c5d5`.

The warning levels improved:

| Level | Corrected build | App 2026.8.4 |
| --- | ---: | ---: |
| Low | 31.5 min of real play remained | 10.9 min remained |
| Critical | 7.0 min remained | 7.4 min remained |

The player-facing number was still poor. It moved through 10, 15, 20, 75, 40,
20, 15, 10, and 3 minutes. At one point it said 75 minutes when 18 minutes
remained. Real play varied about tenfold between lulls and heavy loading.

The estimate stayed useful for choosing a warning level and for diagnostics.
It was removed from player text. The real staircase became a replay fixture.

One earlier abort occurred at 1,899 MiB with fingerprint `a6311932`. That death
below the cap remains unexplained.

**Lesson:** an estimate can support an internal decision without being truthful
enough to present as a promise.

## Measured recovery behavior

Five reload paths were tested from inside an instance:

1. Drop sockets.
2. Orphan the renderer and reload.
3. Crash the renderer process.
4. Use View > Reload Game.
5. Sync the filesystem and reload.

All five reconnected with progress intact in less than 30 seconds. The orphaned
connection sent no FIN and still recovered after the server timeout. This was
one tester and one account. It supports a reconnect statement, not a guarantee
for every party, timed mission, or server condition.

## Current evidence boundary

The diagnostics record `wasm.heapGrew`, heap size on abort and exit, and peak
heap gauges. The local crash view can show the abort text. The exported record
keeps the bounded reason kind and fingerprint.

Do not add a heap walker or malloc/free transform only to choose between leak,
fragmentation, and retained content. That distinction would not change the
local response: preserve evidence, warn honestly, and provide a recoverable
reload. ArenaNet owns the allocator and content-lifetime fix.

Do not repeat the earlier claim that Emscripten's comment says the 2 GiB limit
exists to avoid 4 GB wraparound. The stock comment describes the 4 GB boundary,
but this build uses Emscripten's 2 GiB default. The number, not that comment, is
the evidence.
