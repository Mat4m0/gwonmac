# Investigation log — long-session WASM aborts (memory exhaustion)

Two players, same evening (2026-08-03), both on app 2026.8.3 / client build
38797, both M1 Pro 16 GB: `wasm.abort` hours into play. Open — the
instrumentation that decides the remaining question shipped in this round, and
the answer arrives with the next crash bundle. Kept in the
[investigation-template.md](investigation-template.md) shape; read
[investigation-log.md](investigation-log.md) first for the conventions.

## Round 0 — the reported crashes

| Session | Machine | Length at abort | reasonKind | Fingerprint | Peak heap backing |
| --- | --- | --- | --- | --- | --- |
| `5eb4a64e` | matthias | 3 h 18 m | `assertion` | `99d845da` | 2,147,483,648 |
| `9ae56272` | romi | 2 h 23 m | `assertion` | `a860e578` | 2,147,483,648 |

Both crashed within six minutes of each other (20:00:45 and 20:06:39 UTC)
while playing together. Both bundles also show `socket.error {code: reset}` at
identical wall-clock seconds (19:41:21, 19:54:58) on both machines — the
resets are server-side and exonerate the host socket layer.

## Round 1 — wrong: "the previous session did not crash"

**Hypothesis.** The exported bundle's `previousSession` block
(`abnormalReason: "webContents.destroyed"`, 0 errors) meant the player's
history held one mid-session abort and nothing else; the earlier session was a
clean user quit mislabelled by the clean-shutdown check.

**Built.** A triage conclusion delivered to the player ("the previous session
did not crash"), and a background task scoped to the cosmetic mislabel in
`report.ts`.

**Wrong because** the diagnostics directory on disk held **five** sessions,
not the bundle's two. Read directly:

```
session-8dba412a  2026.8.2  1.7 min  wasm.abort  other  a6311932
session-90067a67  2026.8.2  1.1 min  wasm.abort  other  a6311932
session-5eb4a64e  2026.8.3  207 min  wasm.abort  assertion  99d845da
```

Two crashed sessions with an identical repeating fingerprint were invisible to
the export: `report.ts` keeps only the single newest previous session
(`groups → sort by newestMtime → [0]`). The player's "I was crashing, I was
not quitting" was correct and the bundle was structurally unable to show it.

**Kept anyway.** The clean-shutdown mislabel is real (`quit.cleanupCompleted`
must be the *final* record, but a normal quit logs `webContents.destroyed`
after it) — it is folded into the re-scoped export task rather than standing
alone.

**Lesson.** State what the instrument cannot see before concluding from its
silence. A bundle that carries one previous session proves nothing about the
sessions it dropped; the on-disk `session-*.jsonl` files are the record, and
they cost one directory listing to check.

## Round 2 — right: the heap is pegged at its own cap

**Hypothesis.** `socket.rendererPeakSourceBackingBytes` = 2,147,483,648 —
exactly 2^31 — is the WASM heap's `ArrayBuffer` at its build-time maximum, and
the aborts are allocation failure downstream of memory exhaustion.

**Measured.** The client's own glue, cached at
`~/Library/Application Support/Guild Wars/game/artifacts/Gw.jspi.js`:

```js
var getHeapMax = () =>
    // Stay one Wasm page short of 4GB: ...
    2147483648;
```

The cap is compiled in. Both crashed machines recorded peak backing at that
exact number. The build is assertions-enabled
(`assert()` → `abort('Assertion failed: …')`), so `reasonKind: "assertion"` is
trustworthy, and `Module.onAbort` receives the raw reason before Emscripten's
`Aborted(...)` wrapping — the renderer's classifier sees clean text.

Differing fingerprints across the two machines are consistent with
exhaustion, not against it: at the cap, whichever allocation fails first trips
its own assertion. Fingerprinting all 96 abort/assert string literals in the
glue matched neither fingerprint, so the failing assertions carry
variable/wasm-side text — the prose itself is still needed (round 3's overlay
disclosure captures it at the next crash).

**Lesson.** The cheapest decisive instrument was the client's own artifact on
disk. Before designing renderer probes, read what the machine already has.

## Round 3 — the instrumentation (shipped, 2026-08-03)

What remains unknown is the growth *shape* — steady leak vs. per-zone
accumulation vs. load-spike ratchet. Deliberately **not** built: dlmalloc heap
walkers and a malloc/free wasm transform, because leak-vs-fragmentation has
the same treatment either way (the fix is ArenaNet's; ours is evidence plus a
survivable failure). Shipped instead:

- `wasm.heapGrew {fromBytes, toBytes}` — heap growth is discrete and rare, so
  every rise observed at the ~2 s metrics flush is an event (steps inside one
  flush window coalesce; a run's first event rises from 0); read against the
  `socket.open` map transitions already in the log, the staircase answers the
  shape question per bundle.
- `heapBytes` on `wasm.abort` / `wasm.exit`, plus
  `renderer.wasmHeapBytes` / `renderer.peakWasmHeapBytes` gauges and a
  summarize line against the 2048 MiB cap.
- The crash overlay's "Technical details" disclosure: the abort prose plus
  heap-at-death, renderer-local (the export still carries only reason kind and
  fingerprint).
- The heap watermark notice at 1.75 GiB / 1.875 GiB with a safe-place reload
  (best-effort `FS.syncfs`, then the View → Reload Game reload), so the death
  happens at a moment the player picks.

## Open — what decides it

1. Next crash bundle: the `wasm.heapGrew` staircase against `socket.open`
   markers, `heapBytes` at the abort, and the player-read assertion text.
2. Then the upstream report: heap-at-cap evidence from N machines, growth
   shape, assertion text, and the one-flag ask — the glue's own comment says
   the 2 GiB cap only exists to stay clear of 4 GB wraparound, and Emscripten
   supports 4 GB wasm32 heaps (`-sMAXIMUM_MEMORY=4GB`).
3. Separate defects surfaced along the way, not part of this issue:
   the export hiding crashed sessions (task filed: crash history + fingerprint
   rollup in the bundle), quit-time `filesystem.sync` failing on every
   observed quit (no error code recorded yet), and quit-teardown aborts
   (`a6311932`, 10 ms after `sockets.closeAll()`) being counted as crashes.
