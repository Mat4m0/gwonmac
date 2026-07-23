# Electron performance record

This is the evidence log for performance changes to the packaged macOS
application. `port-plan.md` defines the budgets and acceptance rules; this file
records measurements and conclusions. Level 2 traces locate causes but are
profiler-contaminated. Only clean Level 1 captures establish improvements.

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

Five clean Level 1 candidate runs are still required for final release
acceptance. Record every run here, including failures and profiler
contamination; never replace the baseline with a single favorable run.
