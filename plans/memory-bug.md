# Guild Wars WASM memory exhaustion: investigation, ArenaNet handoff, and interim mitigation

Last updated: 2026-08-08  
ArenaNet client target: build `38797`  

## Executive summary

Guild Wars build 38797 ships as a wasm32 client whose linear memory starts at
256 MiB and has a declared maximum of exactly 2 GiB. The matching generated
JavaScript returns the same 2 GiB maximum from `getHeapMax()`. Once the
monotonically growing WASM heap reaches that boundary, the next allocation that
requires growth is refused and the client aborts. A captured failure reached
exactly `2,147,483,648` bytes and reported an ArenaNet assertion in
`Engine/Gr/Gles3/GlTex.cpp:397`.

The 2 GiB ceiling is conclusively part of ArenaNet's shipped JS/WASM artifact,
not a smaller limit imposed by gwonmac. The allocation and assertion also occur
inside the shipped client. That does **not** prove that every byte below the
ceiling is an ArenaNet leak: the unresolved cause can still be legitimate live
working set, cache retention, allocator fragmentation, or a lifecycle problem.
The assertion site is the allocation that finally lost, not necessarily the
owner of all previously retained memory.

We have not found a safe client-side cache purge. Static analysis proves that
the model cache already has a reference-safe one-second expiry and a normal
sweep approximately every ten seconds. The available live lifecycle capture
is incomplete and does not justify invoking any destructor or eviction path.
Raw `free`, direct `glDeleteTexture`, and guessed cache calls remain prohibited.

As an interim measure, we built an opt-in, research-only 4 GB profile. It
changes the exact WASM memory maximum to 65,535 pages (4 GiB minus one 64 KiB
page) and applies the corresponding unsigned-pointer transformation to the
exact generated JavaScript. Raising only the WASM limit is unsafe. The paired
profile has passed offline qualification with ArenaNet's real allocator at
3,025,928,192 bytes and a live browser test at 2,625 MiB with a real pointer
above 2 GiB. It is suitable for a narrowly gated experimental release after
the remaining release checklist is completed; it is not a root fix and should
not be enabled by default.

## What users experience

Observed reports include:

- two client deaths within a 97-minute session, with the second heap reaching
  exactly 2 GiB;
- content-dense instanced play reaching the limit in roughly 20–70 minutes in
  reported cases;
- a Resplendent Makuun vanquish ending after about 25 minutes;
- Dunes of Despair Hard Mode with consumables ending after about 20 minutes;
- an Emscripten `Out of memory!` abort with an ArenaNet `GlTex.cpp:397`
  assertion;
- sessions that do not reproduce the growth and instead plateau around
  700–900 MiB.

The variability matters. The failure is not simply “time in the game.” It is
affected by content, route, cache warmth, and allocation reuse. A short session
can exercise several gigabytes of image traffic while the WASM capacity stays
flat.

## Facts established with high confidence

### The compiled ceiling

- `Gw.jspi.wasm` declares one memory with:
  - initial: 4,096 pages = 256 MiB;
  - maximum: 32,768 pages = 2 GiB.
- `Gw.jspi.js` contains `getHeapMax = () => 2147483648`.
- The comment immediately above that value is Emscripten's stock explanation
  for staying one page below 4 GiB, while the value itself is 2 GiB.
- The host does not impose a smaller limit. Growth succeeds until the module's
  declared maximum is reached.
- wasm32 cannot provide memory above the 4 GiB address space. Raising the
  maximum buys headroom; it cannot make an unbounded retention problem safe.

### Heap behavior

- WASM linear memory capacity only grows during a process. Freeing allocations
  makes blocks reusable but does not shrink `memory.buffer.byteLength`.
- Repeated growth therefore does not by itself prove a leak. The relevant
  comparison is settled live ownership versus heap capacity after unloads.
- A 500-round, 8 MiB allocate/free test against the real allocator kept heap
  capacity flat, showing that ordinary `malloc`/`free` reuse works.
- Revisiting previously loaded content can avoid growth. That is consistent
  with a cache, and also with freed blocks being reused.
- In the latest natural travel test the heap reached 733 MiB and stayed there
  while image cache counters rose from roughly 2,500 to 3,700 native chunks.
  This was a genuine plateau, not a failed measurement.

### Growth and texture correlation

One valid short archive (`guild-wars-diagnostics_ceck.zip`) recorded:

- build 38797;
- 397 seconds;
- heap growth from 819 MiB to 916 MiB on the last step;
- 868 live textures;
- an estimated 423 MiB of known texture storage;
- complete texture tracking;
- no refused growth request during that short run.

Other valid or historically useful captures showed retained large allocations
associated with these ArenaNet functions:

| Exact function | Reverse-engineered owner | Example retained large bytes |
| --- | --- | ---: |
| `2797` | `GlTex` allocation | 117–148 MiB |
| `1586` | `ImgMem` allocation | 46–96 MiB |
| `4491` | model loading | 29–129 MiB |
| `3421` | unresolved secondary owner | 24–49 MiB |

These figures are attribution evidence, not proof of a leak. Texture estimates
also include GPU-correlated state and must not be presented as WASM ownership
without the allocator evidence.

### What the assertion means

`GlTex.cpp:397` identifies the allocation path that crossed the remaining
capacity. It does not establish that `GlTex` retained the preceding 2 GiB. A
texture allocation can be the final request after models, images, fragmented
free blocks, and other caches consumed the available address space.

## What remains unknown

We do not yet have complete evidence to distinguish among:

1. **Cache retention:** referenced or reusable image/model/texture content is
   retained without a sufficiently low budget.
2. **Lifecycle defect:** objects that should reach zero references do not.
3. **Fragmentation:** live bytes return near baseline but large free blocks
   cannot satisfy later requests.
4. **Large legitimate working set:** the route really needs close to 2 GiB of
   simultaneous live state.
5. **A mixture:** caching plus fragmentation is entirely plausible.

It would be inaccurate to state that the root cause is “100% an ArenaNet
leak.” What is safe to state is:

> ArenaNet's build 38797 contains the 2 GiB limit and performs the allocation
> that is refused at that limit. gwonmac has reproduced and instrumented the
> boundary. The ownership policy that makes some sessions approach the limit
> has not yet been classified as leak, cache, fragmentation, or legitimate
> working set.

Enhancements have not been proven to cause the problem. Controlled comparisons
should keep the same ArenaNet build, route, account, and cache state while
changing only the Enhancement profile.

## Reverse-engineering results

### `ImgMem`

- creation/allocation: function `1586`;
- resize/reallocation: function `1592`;
- destruction: function `1589`.

`ImgMem` storage belongs to higher `GrTex2d` objects. Function `1592` is a
resize path, not an eviction operation. We have not certified a standalone
reference-safe cache trim for this owner.

### `GlTex`

- allocation: function `2797`;
- complete normal teardown: function `2798`;
- observed callers: `2805`, `2810`, `2811`, and `2812`;
- single-object callable path considered during research: `2814`.

Normal teardown removes the object from the context array, deletes the GL
texture, frees its CPU upload buffer, releases dependencies, and unlinks it.
That proves how normal destruction works. It does not prove that calling the
path externally is safe: `2814` does not provide a certified unused/reference
check. It must not be used as a pressure purge.

### Model cache

- parse/load: `4491`;
- cache insertion: `4507`;
- reference acquisition: `4628`;
- release: `4629`;
- destructor: `4632`;
- unused sweep: `4649`;
- normal update caller: `4263`.

The exact build already implements a coherent lifecycle:

1. `4629` decrements refcount `+0x0c`.
2. At zero, the deferred path links the model into global `s_unused` through
   link `+0x1c` and writes `Time() + 1000` at `+0x18`.
3. `4628` unlinks a reused model before incrementing its reference count.
4. `4649` walks expired unused entries and calls their normal virtual
   destructor.
5. `4263` invokes the sweep about every ten seconds.
6. `4632` cleans the payload, removes hash/list membership, and uses the normal
   sized-delete path.

Calling `4649` more often would be redundant unless complete live telemetry
proved expired zero-reference objects were accumulating. Current data does not
meet that gate.

### Lifecycle telemetry limitation

The first universal allocator probe was rejected because it added about 47%
steady-state overhead. It has been removed.

The replacement probe wraps only eleven exact lifecycle functions and exports
aggregate counters. It does not export pointers or per-allocation events. An
early run reported implausibly high model zero-reference totals; the tracker
explicitly marked itself `INCOMPLETE`. The corrected short capture reported:

| Owner | Owned | Zero-reference | Normal evictions | Completeness |
| --- | ---: | ---: | ---: | --- |
| `ImgMem` | 45.7 MiB | 0 MiB | 0 | incomplete |
| model | 0 MiB | 1.9 MiB | 6,092 | incomplete |
| `GlTex` | 123.2 MiB | 0 MiB | 0 | incomplete |

Because completeness failed, these values cannot authorize a production trim.
They do show the normal model sweep actively evicting thousands of objects.

## How ArenaNet can reproduce and classify it quickly

ArenaNet does not need to wait for a public crash. With source symbols and an
internal allocator profiler, the ownership question should take minutes rather
than hours.

### Recommended internal reproduction

1. Use the exact source and Emscripten configuration for build 38797.
2. Record the emitted JS and WASM maximum-memory settings.
3. Enable ArenaNet's normal allocation profiler or a low-overhead sampled heap
   profiler with allocating and freeing C++ stacks.
4. Start after login in a town/outpost and record a settled baseline.
5. Visit ten distinct content-heavy zones, pausing after transitions 3, 6,
   and 9 so asynchronous unload work and the model sweep can complete.
6. Revisit three earlier zones.
7. Remain idle for 30 seconds.
8. At every settled point record:
   - linear-memory capacity;
   - total live allocator bytes;
   - largest free block and free-bin distribution;
   - live bytes and object counts by allocation stack;
   - zero-reference cache bytes for image, model, and texture owners;
   - normal destruction/eviction counts.
9. Repeat the same route once with the same cache warmed.

### Decision table for ArenaNet

| Result | Classification | Correct direction |
| --- | --- | --- |
| Capacity rises by at least 128 MiB while settled live bytes return within 10% or 32 MiB of baseline | fragmentation | reshape/isolate the large allocation pattern or allocator arenas; verify freed blocks are reused |
| Settled live bytes rise by at least 64 MiB across two unloads and one or more owners explain at least half the retained large bytes | retention/lifecycle | inspect that owner's reference transitions and normal eviction policy |
| Zero-reference cached ownership stays high across two unloads | cache budget or sweep issue | use the existing lookup removal and destructor path; add budget/hysteresis |
| Referenced ownership remains high | live working set or missing release | find the retaining reference chain; do not forcibly destroy it |
| Heap and live bytes plateau across ten transitions | normal warm-up | do not ship a speculative purge |

### Fast boundary reproduction

To test the compiled ceiling independently of the natural route, ArenaNet can:

- temporarily compile a diagnostic build with a lower maximum and run the same
  content route; or
- retain a large debug allocation, then perform ordinary game loads so later
  allocations cross the signed 2 GiB address boundary; or
- compile with 4 GiB minus one page and run the client above 2 GiB with the
  generated unsigned-pointer support enabled.

The diagnostic allocation must be research-only and released through the
normal allocator. It is not a proposed product workaround.

### Source areas worth inspecting first

- `ImgMem` ownership from `1586` through `1592` and `1589`;
- model owners corresponding to `4491`, `4505`, and `4506`;
- `GlTex` ownership from `2797` through `2805`, `2810`, `2811`, and `2812`;
- cache budgets and eviction hysteresis around these owners;
- fragmentation around the recurring large allocation shapes;
- mobile builds, if they share the same artifact or memory policy.

## What to send ArenaNet

### Attachments

Prefer complete, validator-clean archives and the exact client artifacts:

1. The original archive containing the exact 2 GiB abort and
   `GlTex.cpp:397` assertion.
2. `guild-wars-diagnostics_ceck.zip` for the clean growth staircase and
   texture correlation.
3. `guild-wars-diagnostics_research.zip` for historical allocator ownership,
   clearly labelled as coming from the retired high-overhead probe.
4. `guild-wars-diagnostics_investige.zip` for the corrected targeted lifecycle
   schema, clearly labelled incomplete.
5. The SHA-256 hashes of `Gw.jspi.js` and `Gw.jspi.wasm` from the affected
   installation.
6. This document, which includes the lifecycle findings and decision gates.

Do not lead with archives marked `SUSPECT` by the current validator. They can
be retained as historical evidence, but schema mismatch must not be mistaken
for a clean capture.

### Developer-facing message

> We are seeing build 38797 abort when its wasm32 linear memory reaches the
> exact compiled maximum of 2,147,483,648 bytes. The value is present both in
> the WASM memory declaration (256 MiB initial, 2 GiB maximum) and in
> `Gw.jspi.js`'s `getHeapMax()`. One captured abort reports
> `Engine/Gr/Gles3/GlTex.cpp:397` at the boundary.
>
> Short instrumented runs identify retained large allocations under the exact
> functions corresponding to `GlTex` (`2797`), `ImgMem` (`1586`), and model
> loading (`4491`), but we cannot distinguish cache retention from
> fragmentation or legitimate referenced ownership from outside the client.
> The growth-trigger stack is the allocation that crossed capacity, not proof
> that it owns the prior growth.
>
> Could you run build 38797 with your heap profiler across ten distinct zone
> transitions, three revisits, and a 30-second settle, recording live bytes,
> largest free block, and ownership/refcount state for those three paths? The
> existing model unused sweep appears to run normally about every ten seconds.
>
> Raising `MAXIMUM_MEMORY` to 4 GiB minus one page works in our research build
> only when paired with Emscripten's unsigned JS pointer handling. We have
> validated the real allocator and generated string glue above 2 GiB. This
> delays the failure but does not replace an ownership or cache-budget fix.
> We can provide the clean diagnostic archives, exact hashes, growth stacks,
> and reproduction route.

### Short management-level message

> The web client shipped with a fixed 2 GiB memory ceiling. Some content-heavy
> sessions reach it and terminate. We have confirmed the ceiling and built a
> temporary 4 GiB experimental mode, but only ArenaNet can determine whether
> the underlying growth is cache policy, fragmentation, or a missing release.
> A short internal heap-profiled zone route should identify the owner. We can
> provide exact build hashes and diagnostic captures.

### Information to include with every report

- ArenaNet build number;
- SHA-256 of both JS and WASM artifacts;
- gwonmac version;
- whether Enhancements were enabled and which profile;
- whether experimental 4 GB mode was enabled;
- route/mission and approximate transition sequence;
- heap capacity at failure;
- exact abort text and first numeric WASM frames;
- whether the diagnostic validator marked the archive valid;
- machine RAM and macOS version.

## Interim gwonmac mitigation

### Existing safe recovery

Keep the heap watermark and user-controlled reload path. A reload resets linear
memory and is much safer from a town/outpost than an allocation abort during a
mission. Automatic mid-mission reload is not a corrective memory fix and must
not be introduced silently.

### Research-only 4 GB transform

The implemented chain is:

```text
official WASM
  -> template compatibility
  -> optional Enhancement
  -> native double-click
  -> targeted lifecycle telemetry
  -> paired 4 GB JS/WASM transform
```

The final stage runs only with:

```text
GWONMAC_MEMORY_ATTRIBUTION_RESEARCH=1
GWONMAC_EXTENDED_MEMORY_RESEARCH=1
```

Launch command:

```bash
cd /path/to/gwonmac-memory-investigation
pnpm dev:memory:4gb
```

The normal `pnpm dev` path remains unchanged.

### Why the JS and WASM must change together

wasm32 function results arrive in JavaScript as signed i32 values. A pointer
above `0x7fffffff` therefore appears negative. Merely changing the WASM maximum
would make generated heap indexing and host byte offsets use negative values.
That can corrupt data or trap.

The exact generated-glue transform:

- changes `getHeapMax()` to `4,294,901,760`;
- converts the audited signed pointer shifts to unsigned shifts;
- normalizes byte-heap indices;
- normalizes typed-array byte offsets;
- normalizes UTF-8 input/output pointers;
- normalizes image-read and heap-copy destinations;
- publishes the active cap to the host watermark.

The transform is exact-input hash-gated. It is not a general JavaScript
rewriter.

### Current certified research pair

| Artifact | SHA-256 |
| --- | --- |
| Official JS input | `58ecc6377397f01919d8def58e802e19fbfd6ce13f421dbf14123a667e34f7d0` |
| Transformed JS output | `1dd5d798b1491f46a7c128c641053c8488211bbc193fe40bdf1d7a886517993d` |
| ABI-11 WASM input, widest Enhancement profile | `3f7ec5ab3a957103bd3ac3068e6e2cb6d5203b4ccb0afc08dfd4329ff150a9c6` |
| 4 GB WASM output | `20f36cf63dd0082fc3e888d66d63cfafd73b99aa4e5e937dc446f2aea52f0ec5` |

WASM maximum: 65,535 pages = 4 GiB minus 64 KiB.

### Qualification already completed

Offline, using build 38797's real `malloc` and `free`:

- heap reached `3,025,928,192` bytes;
- a returned pointer had unsigned address `2,522,561,664`;
- high-address read/write passed;
- freed capacity was reused without another heap-growth request.

Live in Electron:

- the transformed cap reported `4,294,901,760`;
- heap grew to 2,625 MiB;
- `malloc` returned raw pointer `-2,078,907,408`;
- the same pointer normalized to unsigned address `2,216,059,888`;
- generated `stringToUTF8` wrote through the signed high pointer;
- generated `UTF8ToString` read back `GW4G`;
- cleanup completed without a trap.

This proves the live engine, memory growth, allocator, and core generated string
glue can cross the former boundary. It does not prove every rare WebGL or host
callback path under all gameplay conditions.

### Offline qualification command

```bash
pnpm memory:qualify:4gb \
  "/path/to/Gw.jspi.js" \
  "/path/to/certified/ABI11/Gw.jspi.wasm"
```

### Proposed experimental product shape

If released before ArenaNet ships a correction:

- setting name: **Experimental 4 GB memory mode**;
- default: off;
- scope: exact certified ArenaNet build only;
- unknown build behavior: refuse the transform and run the untouched client;
- recommended hardware: at least 16 GB system RAM;
- warning: this adds headroom and may delay an abort; it does not repair
  unbounded retention;
- rollback: disable the setting and restart;
- diagnostics: record a closed boolean/mode value and the effective heap cap;
- keep the reload warning near the effective cap;
- never silently enable it during an update or after a crash.

### Work remaining before an experimental release

The current implementation is a research profile, not yet a user-facing
setting. Before release:

1. Certify every supported post-double-click/Enhancement variant intended for
   the option, including Enhancements disabled. The current 4 GB output is
   pinned only for the widest ABI-11 research predecessor.
2. Add the explicit persisted opt-in and clear explanatory copy.
3. Record the effective mode and cap in the closed diagnostics schema.
4. Test one content-heavy zone transition while allocations above 2 GiB remain
   live, covering image upload, WebGL, sockets, filesystem, and UI strings.
5. Test representative 8 GB, 16 GB, and 32 GB Macs. The option should be
   discouraged or refused where system pressure makes it counterproductive.
6. Verify warning thresholds and the reload path against the effective 4 GB
   cap.
7. Verify transform refusal and cache deletion after a one-byte JS or WASM
   change.
8. Package and smoke-test, rather than relying only on the development host.
9. Keep the offline >2 GiB qualification in the release checklist.

Default activation should require substantially more live coverage and a clear
understanding of system-memory behavior. ArenaNet's source-level fix remains
preferable.

## Approaches explicitly rejected

- **Raise only the WASM maximum:** unsafe because JavaScript sees high wasm32
  pointers as negative.
- **Raise beyond 4 GiB:** impossible with this wasm32 client.
- **Raw `free`:** bypasses owner invariants and creates use-after-free risk.
- **Direct `glDeleteTexture`:** leaves ArenaNet's objects and lookup structures
  inconsistent.
- **Call a destructor directly:** skips reference checks, list removal, and
  dependent cleanup.
- **Call `GlTex` path `2814` as a purge:** no certified unused check.
- **Replace the allocator:** far broader than the evidence and likely ABI
  incompatible.
- **Keep the universal allocator interceptor:** measured roughly 47% overhead.
- **Assume the growth-trigger caller owns the growth:** it is only the request
  that crossed capacity.
- **Automatically reload during missions:** avoids one abort by introducing
  predictable session loss.
- **Ship an unbounded generic transform:** every accepted input and output must
  be pinned to an exact ArenaNet build.

## Interpreting common console messages

These observed messages are not evidence of the memory failure:

- `image.open ChatFilter.ini -> 0 (not in the image)`: optional file not present
  in the snapshot;
- `socket error reset` followed by `socket.connect ...:6112`: game connection
  reset/reconnect;
- pointer-lock refusal: focus or user-gesture requirement;
- a native Electron abort in macOS `HIServices::_RegisterApplication`: app
  registration/launch failure before the renderer or WASM starts.

## Current decision

1. Continue asking ArenaNet for a source-level heap profile and correction.
2. Do not ship a guessed cache/destructor patch.
3. Keep safe reload recovery.
4. Complete the remaining release gates for an off-by-default, exact-build 4 GB
   experimental mode if users need an interim option.
5. Remove or disable the research lifecycle probe once it no longer answers an
   active question.
6. Re-certify from zero after every ArenaNet artifact update.

The simplest correct long-term outcome is an ArenaNet build with an intentional
memory maximum and a bounded, reference-safe content cache. The 4 GB profile is
useful breathing room while that work is pending; it is not a substitute for
it.
