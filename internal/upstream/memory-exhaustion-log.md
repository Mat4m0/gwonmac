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

## Round 4 — wrong: bytes remaining was the unit (2026-08-04)

**Hypothesis.** Warning at a fixed distance from the cap — 256 MiB, then
128 MiB — gives the player enough room to reach somewhere safe.

**Built.** The watermark notice shipped in 2026.8.4 with exactly those two
thresholds, and copy that told the player to travel to a town or outpost.

**Wrong because** the same headroom is not the same amount of time. Measured
on the same client build:

| Session | Rate | What 256 MiB bought |
| --- | --- | --- |
| Open world, 2 h 16 m | 555 MiB/h | ~28 min |
| Eye of the North mission | fast enough to hit the cap in ~30 min | ~2–3 min |

The second player reported "multiple warnings" and crashed anyway. Both saw
the same sentence, and neither could tell which of those two it meant. The
copy compounded it: an instruction to travel to an outpost is one a player
inside a dungeon reads as "abandon the run", so it was rational to ignore.

**Kept anyway.** The byte thresholds survive as the fallback for when a rate
cannot be measured — the first two minutes of a session, and any stretch where
growth has stalled. They are conditional now: left unconditional, 128 MiB is
nearly fourteen minutes at the open-world rate and would pre-empt the time rule
every session, rebuilding the defect.

**Lesson.** A threshold is a claim about the player's situation, and the unit
has to be the one the player is in. Bytes were what we could measure most
easily; time was what the sentence was actually promising.

**A number the test corrected.** The replacement kept a hard byte floor as a
never-silent backstop, first set at 64 MiB. Driven over the measured
open-world session it raised `critical` at seven minutes — ahead of the
five-minute time rule, i.e. the same defect in miniature. It is 32 MiB, which
sits below where the time rule fires at every rate observed so far. That
threshold had no session behind it until the test supplied one.

## Round 5 — wrong: the heap is a staircase, and we measured it with a ruler shorter than the stair (2026-08-05)

**Hypothesis.** With the unit fixed, a trailing window over recent samples
gives the rate: five minutes to catch a session that has started spending, and
fifteen so a lull inside that spending cannot erase it.

**Wrong because** `Module.HEAPU8.buffer` is *reserved* memory, and WebAssembly
reserves it in jumps. Emscripten's glue grows by a fifth of the current size
capped at 96 MiB, so at the measured 555 MiB/h the heap steps about once every
ten minutes and is perfectly flat in between — which the instrumentation
already said in Round 3 (`wasm.heapGrew`: "growth is discrete and rare") and
the debug panel repeated on the way in ("a short window reads as either zero or
enormous depending on where the sample landed").

A five-minute window over a ten-minute tread holds either no step or one.
Simulated against the measured open-world session, the estimator read:

| | measured | true |
| --- | --- | --- |
| Rate | alternating 384 and 1,152 MiB/h | 555 MiB/h |
| Shown to the player | 15 → 45 → 10 → 30 minutes | a smooth count down |
| `low` fired | claiming 15 minutes | 41 minutes remained |

The level still landed in roughly the right place, because the steep arm of the
sawtooth dominates. The *number* — the entire point of Round 4 — swung by three
times its own value every five minutes, on the chip, which is the one surface
that updates live.

**Why it survived review and a test suite.** Every test drove smooth linear
growth. The sessions we measured were staircases; the sessions we tested were
ramps, so the tests agreed with the code about a shape no client produces.

**Built.** Both ends of a measurement now sit on a growth step, at least ten
minutes apart, and the module keeps steps rather than samples. Step-to-step is
what makes the figure stand still: anchoring the far end to *now* puts a whole
tread in the denominator and none of its rise in the numerator. Ten minutes is
what tells a burst from a trend, and it was bought rather than guessed — a
300 MiB zone load at minute 30 of an ordinary session says "about 20 minutes of
play left" over a four-minute span with 77 minutes truly left, and escalates to
critical over an eight-minute span with 30 minutes left. Over ten it says
nothing and the real warning arrives on time.

The cost is knowingly accepted: a mission spending 3,500 MiB/h dies around
minute 23 and cannot be spoken about until minute 18, where an eight-minute
span would have warned at 15. There is no shorter honest answer — ten minutes
into a mission, a ten-minute-old zone load and a sustained spend look alike in
every window, and a "is it still going?" test costs exactly the latency it
saves. The byte floors remain the backstop for the fast case.

**Two more the same simulation found.**

*The warm-up ran on the wrong clock.* It excluded the startup ramp for five
minutes after page load. The page stays open through the client download, so a
slow first run boots after the exclusion has expired and the ramp is measured
as ordinary play: 38% of the cap, "about 8 minutes of play left", two hours of
real headroom. It runs from the client's first allocation now.

*Headroom was read off the reserve.* The client dies when what it has *filled*
reaches the cap, and the reserve leads that by up to one step — ten minutes of
open-world play. Taking headroom off the reserve made every step look like ten
minutes vanishing at once and read a session as a third shorter than it was.
Growth fires when a request no longer fits, so at the instant of a step the
filled bytes are what the reserve was before it; between steps they climb at
the rate just measured. The residual error is one allocation request rather
than one step.

**Lesson.** Round 4's lesson was that a threshold is a claim about the player's
situation. This one is narrower and sharper: a test that drives a shape the
system never produces will confirm whatever the code believes. The measured
sessions were on disk the whole time — `wasm.heapGrew` events, fourteen of them
in 2 h 16 m — and no test read one.

## Round 6 — right: every reload path reconnects (2026-08-05)

**The question.** Guild Wars restores a player's instance after a dropped
connection; that was never in doubt. What was unknown is whether *our* reload
looks like a dropped connection to its server — and the copy could not say
"you come back where you were" until somebody had checked. A unit test held
the hedge in place so nobody could firm the wording by assertion.

**Run.** All five paths in `docs/diagnostics.md`, from inside an instance:
(d) drop sockets, (c1) orphan + reload, (c2) crash the renderer process,
(b) View → Reload Game, (a) sync + reload.

**Result.** Every one reconnected, with progress intact, in under thirty
seconds. Including (c1), which sends no FIN at all and forces the server to
time the connection out — the path most likely to fail, and the one whose
passing generalises to a real crash.

**What changed.** The notice now states the reconnect instead of hedging it,
and the outpost moved out of the notice into the explanation. It is still true
that an outpost risks nothing, but leading with it is what made the shipped
sentence easy to ignore from inside a dungeon, and repeating a caveat against
a measured fact argues with the measurement. The guard test turned around: it
used to fail if the hedge disappeared, and now fails if the measured claim
disappears or if the copy grows past the evidence into "guaranteed" or
"never lose".

**What it does not cover.** One tester, one account. Nothing about a full
party, a timed mission, or a loaded server. Enough to state the reconnect;
not enough to promise it cannot go wrong.

**Lesson.** The instrument was worth building. Five paths in one sitting
answered a question that hours of ordinary play would not have, because
ordinary play never produces (c1) on purpose — and (c1) is the one that
mattered.

## Round 7 — wrong: the figure was a diagnostic, printed as a promise (2026-08-05)

**The bundle.** A player's Eye of the North session, 2026-08-04, app 2026.8.4,
complete from start. Two client runs, two aborts, and 33 `wasm.heapGrew`
events — the first real staircase we have had rather than a modelled one.

**What it confirmed.**

- The final growth step is clamped to the cap: 1990 → 2048 MiB, 58 MiB rather
  than the usual 96. The client then died at exactly `2147483648` bytes,
  `reasonKind: assertion`, fingerprint `8f57c5d5`, **forty-two seconds** after
  that last step. The reserve does reach the cap exactly, which is what the
  headroom model assumes.
- The tread is 96 MiB and the gaps run from 0.9 to 14.3 minutes, which is the
  shape Round 5 was built for.

**What it broke.** Replayed against that run, the *levels* landed well:

| | this build | shipped 2026.8.4 |
| --- | --- | --- |
| `low` | 31.5 min of real play left | 10.9 min |
| `critical` | 7.0 min | 7.4 min |

The *figure* did not. It read 10 → 15 → 20 → **75** → 40 → 20 → 15 → 10 → 3,
and at minute 49 offered "about 75 minutes" to a player with 18 left. A
thirteen-minute lull had drifted into the measurement window just before the
player went back into heavy loading. Earlier, at minute 34, it said "10
minutes" with 31 left — wrong the other way, behind a rate that looked stable.

**Why the tests did not catch it.** They drove constant rates. Round 5's
lesson was that a test driving a shape the system never produces will confirm
whatever the code believes; the fix for that round replaced ramps with
staircases and then held the rate constant along them. Real play varies about
tenfold between lulls and mission loading. The same lesson, one level down.

**Built.** The thresholds still count in time — that is what tripled the
warning and it is not in question. The figure is gone from every player-facing
string. The estimate still exists, still sets the level, and is still shown in
the debug panel and the log, where being approximately right is useful and
being precisely wrong costs nothing. The client run that reached the cap is
now a test fixture, replayed step by step against the abort that ended it.

**Also observed, unexplained.** The session's *first* abort came at 1899 MiB —
149 MiB of headroom left — with `reasonKind: other` and fingerprint
`a6311932`, the same fingerprint as both crashes in the 2026-08-03 bundle. Our
model cannot predict a death below the cap. Two observed deaths, one at the
cap and one short of it, is not enough to say what that is.

**Lesson.** An estimate can be good enough to decide something and not good
enough to say out loud. The level is a decision the app makes and can defend;
the figure was a claim the player would check against their own clock.

## Round 8 — correcting our own reading of the cap, and widening the repro (2026-08-06)

**We misread ArenaNet's glue.** Round 3 and the "Open" list say the comment
above `getHeapMax` shows the 2 GiB cap "only exists to stay clear of 4 GB
wraparound". It does not. The full text in `Gw.jspi.js` is:

```js
var getHeapMax = () =>
    // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
    // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
    // for any code that deals with heap sizes, which would require special
    // casing all heap size related code to treat 0 specially.
    2147483648;
```

2147483648 is **not** one page short of 4 GB — that would be 4294901760. The
comment is Emscripten's stock text, emitted above whatever `MAXIMUM_MEMORY`
was configured, and 2147483648 is Emscripten's *default* (2 GB). So the
correct reading is narrower and, for the report, stronger: the ceiling looks
like a default nobody changed rather than a constraint anybody chose. We must
not tell ArenaNet their own comment says something it doesn't.

The ceiling is declared twice, and both agree — the glue constant above, and
the wasm binary's own memory section:

| artifact | initial | maximum |
| --- | --- | --- |
| `Gw.wasm` (27 MiB) | 256 MiB | **2048 MiB** |
| `Gw.jspi.wasm` (8 MiB) | 256 MiB | **2048 MiB** |

**The causal chain, end to end.** `wasmMemory.grow()` throws once the module's
declared maximum is reached; `growMemory` catches it, logs
`growMemory: Attempted to grow heap from … but got error: …` and returns
undefined, which the caller reads as 0; `_emscripten_resize_heap` fails; the
allocator returns null; and ArenaNet's own texture path asserts. The recorded
death is `ASSERTION FAILED: Out of memory!` at `Engine/Gr/Gles3/GlTex.cpp:397`
with `heapBytes` exactly 2147483648. Which assertion trips first is incidental
— at the cap, whichever allocation lands next fails.

**It is not an Eye of the North problem.** Two further player reports, neither
in EotN:

- Vanquishing **Resplendent Makuun** (Nightfall, Vabbi) — crashed ~25 minutes in.
- **Dunes of Despair** in Hard Mode with a consumable set — crashed ~20 minutes in.

Both are long runs through a lot of an area's content, which is what the
2026-08-04 staircase already implied: the heap tracks *novel* content, not map
changes. Five map connections in that bundle cost zero growth because the
player was revisiting. Vanquishing is the maximal case by definition — clearing
an explorable area means loading all of it — and it is reachable from every
campaign, on any account.

**The ask, stated precisely, and what it is not.** `-sMAXIMUM_MEMORY=4GB` is
one build flag, and wasm32 addresses up to 4 GB, so it is cheap. It is
mitigation and not a cure, and the report must say so or the first engineer to
read it will say it for us.

Boot costs a fixed ~700 MiB, so the usable budget goes from ~1,348 MiB to
~3,396 MiB: about **2.5x**. On the measured session that turns a death at 66
minutes into one at roughly two and a half hours, and a 25-minute vanquish
death into about 65 minutes. Useful, and still bounded.

The heap does not converge under continuous new content. It grew steadily to
the cap across 65 minutes with no plateau, and the only flat stretches were
the player standing still. So a bigger ceiling buys time proportional to the
ceiling and nothing else.

What we cannot say is *why* it grows without bound. Round 3 already framed this
as leak vs. fragmentation vs. per-zone accumulation, and nothing since has
separated them. We do know `malloc`/`free` work normally — 500 rounds of
8 MiB alloc/free against the real wasm kept the heap flat — so it is not a
stubbed allocator. Beyond that: revisiting a zone costs no growth, which is
equally consistent with content being cached deliberately and with it being
freed and the blocks reused. From outside the client those look the same.

So the report asks for the flag as breathing room, and reports the growth
itself as the defect. wasm32 has no ceiling above 4 GB, which is the argument
for treating the flag as time bought rather than the answer.
