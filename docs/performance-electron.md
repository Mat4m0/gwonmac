# Electron performance record

This is the evidence log for performance changes to the packaged macOS
application. It records measurements and the conclusions drawn from them.
Level 2 traces locate causes but are profiler-contaminated. Only clean Level 1
captures establish improvements.

Every number below is something that was measured, not something that must
hold. The thresholds a run passes or fails on belong to the code that enforces
them — `scripts/toolbox-live/scenarios.ts` for the paired live benchmark and
`scripts/toolbox-live/acceptance.ts` for the common gates — so read a figure
here as history, and change a budget there.

## Baseline environment

Recorded July 23, 2026:

```text
application                 Guild Wars 0.0.1-alpha.1
official client build       38771
machine                     MacBook Pro, Apple M1 Pro
memory                      16 GB
display                     60 Hz
render scale                1
cache mode                  on demand
```

All three original baseline exports came from one session.
`guild-wars-diagnostics_2.gwdiag` and
`guild-wars-diagnostics_4.gwdiag` contain identical capture windows,
`frames.bin`, `capture-summary.json`, and Chromium traces. They are two exports
of one recording, not independent samples.

## Clean Level 1 baseline

Source: `guild-wars-diagnostics_1.gwdiag`

```text
capture window              76.130614–110.702170 s
duration                    34.572 s
visibility                  visible
visible intervals           1127
visible FPS                 32.6
visible p50/p95/p99         16.6 / 20.8 / 506.1 ms
stalls >33/50/100 ms        47 / 46 / 45
longest stall               998.6 ms
input-to-submit maximum     721.1 ms
snapshot reads              720
snapshot bytes              12,831,800
snapshot maximum            742.7 ms
renderer memory hits        452
native/coalesced hits       454 / 248
CDN fetches/bytes           55 / 14,417,920
demand queue p95            <=0.1 ms
disk read p95               <=8 ms
network wire p95            <=500 ms
swap maximum                0.1 ms
bitmap/present p95          0.25 / 0.25 ms
main CPU                    30.5% of one core
renderer RSS peak           2010 MiB
```

The scheduler and disk are not the dominant steady-play problem. There is real
cold content latency, but severe frame stalls also occur in windows with no
snapshot reads.

## Level 2 root-cause trace

Sources: duplicate exports `guild-wars-diagnostics_2.gwdiag` and
`guild-wars-diagnostics_4.gwdiag`

```text
capture window              120.492856–134.705860 s
duration                    14.213 s
visibility                  visible
visible intervals           505
visible FPS                 41.0
visible p50/p95/p99         16.6 / 18.1 / 231.0 ms
stalls >33/50/100 ms        17 / 16 / 16
longest stall               694.1 ms
snapshot reads/bytes        6 / 154,608
snapshot source             100% renderer memory
snapshot maximum            0.1 ms
socket sends/bytes          16 / 336
```

Every long frame contains one outbound `gw:socket:send` call. The sixteen
messages are 21 bytes each. Their context-bridge proxy calls take 156–684 ms.
The V8 profile attributes 4.18 seconds, about 70% of sampled non-idle renderer
time, to:

```text
Guild Wars WASM
-> _emscripten_asm_const_int
-> renderer socket.send
-> preload contextBridge
-> ipcRenderer.invoke
```

Main external memory alternates between approximately 4.3 MB and 391 MB while
these messages are sent. The 368.8 MiB difference is consistent with a tiny
view retaining the WebAssembly memory backing buffer across Electron
serialization.

## Accepted diagnosis

The first performance repair is to create a compact outbound byte array before
crossing `contextBridge`. Payload cost must scale with payload length, not the
source `ArrayBuffer` length. The request/response IPC shape remains unchanged
until compact payloads are measured. GPU presentation, GC, cache size, workers,
Rust, WebGPU, and higher CDN concurrency are not current targets.

## Offline candidate results

The compact-payload candidate passes the offline Electron boundary fixture:

```text
source                         20 views, 64 MiB backing each
logical payload               20 × 21 bytes
TCP bytes received            420 exact bytes
IPC backing bytes             420 bytes
main external-memory delta    <16 MiB
animation maximum             <50 ms
synchronous bridge p95        <=1 ms
promise settlement p95        <=8 ms
promise settlement maximum    <10 ms
```

This proves the retained backing buffer no longer crosses Electron. It is not
the live gameplay acceptance.

## Live compact-payload candidate

Sources: `guild-wars-diagnostics_x.gwdiag` and
`guild-wars-diagnostics_y.gwdiag`. These are non-overlapping windows from one
warm session. The first is clean Level 1 evidence; the second is a Level 2
attribution trace and is profiler-contaminated.

Clean Level 1 (`x`):

```text
duration                    53.9 s
visible intervals           3197
visible FPS                 59.3
visible p50/p95/p99         16.7 / 18.2 / 20.6 ms
stalls >33/50/100 ms        6 / 4 / 3
longest stall               440.5 ms
snapshot reads/bytes        842 / 16.0 MiB
snapshot maximum            47.9 ms
renderer memory hits        84.6%
demand queue p95            <=0.1 ms
disk read p95               <=4 ms
socket bridge p95/max       <=0.25 / 0.3 ms
socket IPC amplification    1.0x
main RSS peak               229 MiB
renderer RSS peak           546 MiB
first frame                 3163 ms
startup complete            2079 ms
```

Level 2 (`y`):

```text
duration                    53.6 s
visible FPS                 60.0
visible p50/p95/p99         16.7 / 18.1 / 20.4 ms
stalls >33/50/100 ms        1 / 1 / 0
longest stall               76.2 ms
snapshot reads/bytes        133 / 1.99 MiB
snapshot maximum            6.1 ms
socket IPC amplification    1.0x
```

The only long Level 2 renderer frame coincides with CPU-profiler startup:
`BeginMainFrame` reached 63.1 ms and `CpuProfiler::StartProfiling` reached
54.2 ms. Steady traced gameplay contains no long GPU, context-bridge, socket,
or garbage-collection work.

Compared with the original clean baseline, the candidate improves frame p99 by
about 96%, snapshot p95 by about 99.6%, first frame by 19%, startup completion
by 39%, and main CPU by about 74%. The socket defect is absent in both timing
and memory behavior.

The remaining host-side observation is one 46–48 ms resident disk-read outlier
that aligns with a 75 ms frame. The initial 440/112 ms cluster occurs during a
588-read content burst and is not explained by socket, queue, network, GPU, or
presentation cost. Do not add a cache, worker, or rendering rewrite unless the
required repeated captures reproduce and attribute one of these costs.

Five clean Level 1 candidate runs are required for final release acceptance.
Record every run here, including failures and profiler contamination; never
replace the baseline with a single favorable run.

## 0.0.2 Toolbox release captures

Recorded July 25, 2026 on the default Retina 2× setting. Each candidate is a
60-second disabled baseline followed by a 60-second enabled capture. All five
had zero rejected snapshots, traps, unhandled rejections, unknown sockets, or
renderer errors. Snapshot observation was `0.10 ms` p95 in every run.

| Candidate | Frames off / on | p95 off → on | p99 off → on | Hook ticks | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 2,988 / 3,002 | 33.6 → 34.5 ms | 50.0 → 50.0 ms | 3,007 | Capture clean; old long-frame-count gate rejected it |
| 2 | 3,597 / 3,600 | 18.4 → 18.0 ms | 18.7 → 18.6 ms | 3,601 | Pass |
| 3 | 3,600 / 3,588 | 18.6 → 18.4 ms | 18.6 → 18.6 ms | 3,590 | Pass |
| 4 | 3,600 / 3,599 | 18.6 → 18.6 ms | 18.7 → 18.7 ms | 3,601 | Pass |
| 5 | 3,600 / 3,600 | 18.6 → 18.5 ms | 18.6 → 18.6 ms | 3,602 | Pass |

Candidate 1 is retained because release evidence includes failures. Its p95
change was `+2.68%`, while p99 was unchanged; it failed an additional
one-long-frame rule that was more sensitive to populated-outpost scheduling
noise than the stated corroborated p95/p99 budget. Candidates 2–5 reproduce no
regression: median p95 change is `-1.08%`, and median p99 change is `0%`.

Live functional acceptance also passed cached boot, target acquisition,
bounded movement, renderer reload, and the certified map `146 → 148`
transition. The transition published a field-cleared waiting state before the
new outpost snapshot; no stale map, player, or target value crossed it.

## Host-pipeline audit and render-scale correction

Recorded July 24, 2026 on the baseline environment above.

A live context inspection found that the saved 1× render scale was initially
applied by the host, then overwritten by the official client's Emscripten
device-pixel-ratio path. On the Retina display, the CSS viewport was
2242×1234 while the visible canvas, OffscreenCanvas, and WebGL drawing buffer
were all 4484×2468. The host now supplies the selected render scale through
`emscripten_get_device_pixel_ratio`; redundant backing-buffer assignments are
also suppressed and window resize work is coalesced to one animation frame.
The same live inspection now reports 2242×1234 for all three backing sizes at
1×. That reduces the rasterized pixel count from 11.07 million to 2.77
million, while 1.5× and 2× remain explicit quality choices.

The actual context is hardware WebGL2 through ANGLE Metal on Apple M1 Pro.
Antialiasing and `preserveDrawingBuffer` are disabled; alpha is disabled;
depth and stencil remain enabled for client compatibility. Over 4,292 swaps,
EGL swap, bitmap extraction, and bitmap presentation were each at or below
0.1 ms p95; extraction and presentation were at or below 0.25 ms p99. The
OffscreenCanvas/ImageBitmap handoff is therefore not an evidenced bottleneck.
Apple Silicon uses unified memory, so Chromium exposes no independent VRAM
counter; GPU-process RSS was approximately 122–140 MiB during these runs.

The corrected 1× build passed the paired live performance gate:

```text
phase duration               60 s baseline + 60 s Toolbox
frame samples                3598 / 3600
baseline p50/p95/p99         16.7 / 18.4 / 18.6 ms
Toolbox p50/p95/p99          16.7 / 18.3 / 18.6 ms
Toolbox p95 regression       -0.54%
frames >20/33/50 ms          0 / 0 / 0 with Toolbox
hook callbacks               3602
rejected snapshots           0
snapshot render p95          <=0.1 ms
```

The socket audit also found no remaining payload amplification. During the
live run, 59 sends carried 2.1 KiB total; compact payload size, IPC backing
size, and native bytes written were equal. Synchronous bridge work was at or
below 0.25 ms p95 and native writes were at or below 0.25 ms p95. Startup
settlement percentiles include connection and persistent-data restoration and
must not be interpreted as steady packet-processing cost.

No direct-canvas rewrite, packet batching, transferable transport, WebGPU
port, forced GPU preference, higher download concurrency, or merged animation
loop is justified by these measurements. Revisit those choices only if a
clean Level 1 capture identifies a repeatable budget violation.

## Audio investigation and cold-content follow-up

Two clean Level 1 captures recorded July 25, 2026 used a 48 kHz Web Audio
context with 5.33 ms base latency and 16 ms output latency. Neither contained a
positive-duration scheduling gap. The normal-quality capture still contained a
499.7 ms visible-frame stall and 120.7 ms scheduler delay during a burst of 669
snapshot reads, so renderer lateness did not establish an audio discontinuity.
The later high-quality capture was warm, shorter, and nearly stall-free; it
does not attribute that difference to the in-game audio setting.

The capture-scoped Web Audio prototype observer was therefore removed rather
than retained as dormant diagnostics. `audio.resumeFailed` remains as the
operational signal for a genuine browser audio-resume failure.

The cold burst showed resident 256 KB protocol reads completing quickly while
hundreds of completions repeatedly resumed renderer/WASM work. An 8 ms
cooperative snapshot-completion pacer was tested and rejected. A clean
candidate capture exercised 15 forced yields with no errors or dropped records,
but a paced interval containing 234 snapshot completions and nine yields still
produced a 477.1 ms visible submit gap. That exceeds the 100 ms acceptance gate,
so the pacer, its counter, and its tests were removed. Snapshot pacing is not a
supported optimization without stronger attribution of the work performed
after each completed read.

The next investigation uses Level 2 fixed-name frame-submit and
snapshot-resolution marks plus V8 CPU-profile samples. This distinguishes WASM
execution, JavaScript, garbage collection, compilation/runtime work, and idle
time inside the exact long-frame interval. It is attribution evidence only:
profiler-contaminated captures still cannot prove a performance improvement.
