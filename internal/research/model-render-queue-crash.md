# Guild Wars model render queue crash investigation

Investigated on 5 October 2026 against gwonmac main at `ca8be664`.
This note covers FOO's intermittent crash when opening a third account.

The initial investigation found unguarded native HUD release paths. Offline
probes reached the reported assertion through the official close code. This
branch now guards HUD, Maps, and Compass resource retirement and mutation,
restores Core/Tools launch isolation, and contains Maps disposal failures.
The sections below retain the original evidence and describe the completed
fixes. They establish unsafe code paths, not FOO's exact live sequence.

Public searches for the exact assertion and source line did not find a useful
indexed matching report. Broad crash reports do not establish this cause.
The strongest evidence here comes from local source and the official client bytes.

## Reported facts and missing evidence

The screenshot contains:

```text
WASM heap at crash: 531 MiB of 4096 MiB
ASSERTION FAILED: Model closed while in render queue
  ../../../../Engine/Gr/GrModel.cpp:1375
```

Matthias reports that FOO has a newer Mac and many Tools enabled.
The application version, client hash, macOS, RAM, exact enabled features, and
crashing window are unknown. The third launch is an association, not a proven cause.

The heap value measures this client's linear memory allocation, not total Mac RAM
or GPU memory. It does not show exhaustion of the 4096 MiB WASM limit.
System or GPU pressure remains possible as an indirect trigger.

The loading screen does not establish the crash stage.
[`failCrash`](../../src/renderer/loading.ts) always says
"Guild Wars stopped before it was ready", including after gameplay has started.
FOO could be seeing a new account fail or an existing account abort during launch.

## Exact official assertion

The locally retained official client has SHA-256
`266b5a8aa88fe6440b10737d3eda27f4ceae2401d51d263debc0bca5c2075d87`.
The offline decoder successfully decoded all 17637 defined functions.
The assertion text has one referencing function: `1525`, table slot `316`.

Function `1525` performs model destruction. Its first checks read:

| Field | Nonzero outcome |
| --- | --- |
| model + 152 | `Model closed while in render queue`, line 1375 |
| model + 24 | `Model closed while cached`, line 1379 |

The official generic handle-close function `748` decrements the ordinary resource
reference count. On its last reference, it invokes a virtual destructor.
The model's destructor wrapper `1527`, table slot `317`, calls `1525`.
The render queue reference count at `+152` is a separate lifetime constraint.
Closing the last ordinary handle while that field is nonzero reaches FOO's assertion.

These indices describe only the examined client. FOO's build must be identified
before interpreting numeric frames from his machine.

## Relationship to the earlier texture crash

[PR 453](https://github.com/Mat4m0/gwonmac/pull/453), merged on 26 September,
documented a live texture replacement failure at `GrModel.cpp:1991`.
The exact failure was `m_renderRefCount == 0`, reached through the Compass publisher.
Its repair added queue-phase and model-reference guards to texture publishers.
The current source also contains the October client compatibility changes.

The official replacement function `1532` checks the same field, model `+152`.
FOO's line 1375 concerns destruction instead of replacement.
The earlier repair therefore provides relevant evidence but does not prove this
separate failure is fixed.

The guard owner is
[`native-render-reference.ts`](../../src/main/certification/native-render-reference.ts).
The gap is visible in
[`native-hud-transform.ts`](../../src/main/certification/native-hud-transform.ts):

- Lines 170–175 emit release and reset without a render-reference guard.
- Lines 296–299 guard the atlas upload with queue and model checks.
- Line 334 releases a record when its parent or child identity changes.
- Line 337 releases a record when a publication contains zero quads.
- Line 289 also invokes release from the native frame destruction hook.

Release first calls native `6593`, then closes the model and mesh handles.
Inspection of official `6593` and its callee `1552` shows cache invalidation,
including decrementing the field at model `+24`. It does not drain or clear
the render references at model `+152`.

The renderer can withdraw a label when a timer finishes, observations become
unavailable, or its native icon changes. These operations reach
`gwonmac_hud_label` from the host, outside the client's own frame.
[`native-hud-layer.ts`](../../src/renderer/native-hud-layer.ts) also invokes
the native reset directly on graphics context loss/restoration and disposal.

## Offline proof and its limits

The realistic wrong behavior under test was closing a HUD model while the
render queue still references it. Existing artifact tests only assert that
texture replacement avoids that state; their release peer does not enforce it.

The investigation reused the existing native HUD artifact harness in an ignored
scratch file. It extracted the unchanged official bodies of `748`, `1527`,
and `1525` into a small WASM capsule. Calls and table entries were remapped for
isolation. The capsule shared memory with the emitted HUD fixture.

For each scenario, the fixture first created and collected a native HUD label.
The probe then supplied one remaining ordinary resource reference and a nonzero
render reference at `+152`. Closing that draw handle executed the real official
handle-close and destructor chain. The assertion import reported its official
message, source path, and line. Other native peers remained controlled.

| Operation while the model is held | Cooldowns | Shortcut badges | Effect timers |
| --- | --- | --- | --- |
| Withdraw with zero quads | Exact line 1375 | Exact line 1375 | Exact line 1375 |
| Replace parent identity | Exact line 1375 | Exact line 1375 | Exact line 1375 |
| Reset the HUD | Exact line 1375 | Exact line 1375 | Exact line 1375 |

All nine probes passed by observing the expected assertion. The unchanged
native HUD tests and official graphics queue test also passed: four tests.
Thus passing existing tests does not exclude this destruction failure.

This proves a conditional code path, not the live scheduling sequence.
There was no real GPU, third-account launch, system pressure, or FOO session.
The probe supplies the held state and last-handle condition explicitly.
It cannot establish that those conditions occurred on his machine.

Local scratch evidence is under `build/research/model-queue/`.
The generated capsule contains ArenaNet code and must not be committed or shared.
From the repository root, the retained probes can be rerun with:

```sh
PROBE_SCENARIO=withdraw GW_CLIENT_WASM="$HOME/Library/Application Support/Guild Wars/game/artifacts/Gw.jspi.wasm" node --max-old-space-size=8192 --import ./scripts/ts-hook.mjs --test --test-concurrency=1 build/research/model-queue/hud-withdrawal-probe.ts
```

Use `reset` or `rebind` for the other scenarios. The capsule is bound to the
examined official client and is local investigation evidence, not runtime authority.

## Reproduction with the official render queue

A follow-up on 5 October replaced the manually supplied render reference with
ArenaNet's unchanged enqueue function `1546` and queue storage function `1548`.
The probe also executes the unchanged official drain function `1537`.

The reproduction now follows this sequence:

1. Create and collect a label through gwonmac's emitted native HUD fixture.
2. Submit its isolated model through the official queue function.
3. Verify that the queue contains the model and took one render reference.
4. Withdraw, replace, or reset the label through the emitted HUD code.
5. Observe the exact line 1375 assertion through the official handle-close chain.

The control follows the same sequence but drains the official queue before
step 4. All nine queued cases assert; all nine drained controls release successfully.
The probe does not write a nonzero value to model `+152`: the official enqueue
does that. The official drain returns that field to zero.

Run the complete local reproduction with:

```sh
python3 build/research/model-queue/run-reproduction.py
```

The runner regenerates its capsule from the cached official client and refuses
a different source hash. It then runs withdrawal, replacement, and reset for
cooldowns, shortcut badges, and effect timers, with and without queue drain.
It prints each outcome and exits unsuccessfully if an expected result changes.

This strengthens the conditional lifetime proof. The harness still supplies
the isolated model, preallocated queue storage, and ordering. Graphic payload
compilation, cache invalidation, and other external peers remain controlled.
It does not run the full renderer, GPU, JSPI suspension, or account launcher.
Thus it cannot establish which real event interrupted FOO's queue lifecycle.

The reproduction source and generated capsule remain in ignored `build/`.
A normal app build deletes that directory. Preserve this local investigation
before building a development app; never commit or share the generated capsule.

## Ranked hypotheses

| Rank | Hypothesis | Evidence and decisive check |
| --- | --- | --- |
| 1 | A HUD label is released while the client's render work is suspended or still queued | Unguarded release paths and nine conditional reproductions. Confirm with numeric abort frames or an exact assertion breakpoint. |
| 2 | Opening another window triggers context loss or restoration, which directly resets an existing HUD | The reset callback exists and reproduces line 1375 when held. Look for context events around the abort; context loss itself is unproved. |
| 3 | A native Compass or map model is closed while queued | Native map and Compass destruction paths also close retained handles. These are candidates from inspection; their destruction timing was not reproduced. |
| 4 | ArenaNet's own UI or world model destruction violates the invariant | The official destructor accepts any model of that type. This rises in priority if the affected window has no installed native drawing capability. |
| 5 | A transform defect or unrelated memory corruption produces an invalid lifetime | Cannot be ruled out from a screenshot. Exact module identity and caller frames are needed. No specific corrupting write was found. |

JSPI suspends WASM execution on a Promise and resumes it through the browser event
loop. Host callbacks can run during the suspension. This supplies a plausible
interleaving mechanism, not proof of the suspension point in this crash.
See [V8's JSPI explanation](https://v8.dev/blog/jspi).

Game windows use `backgroundThrottling: false` in
[`window.ts`](../../src/main/window.ts), so opening a third window adds background
work instead of automatically pausing older games. Profiles use isolated sessions
and per-window client instances. Electron documents a separate renderer for each
BrowserWindow in its [process model](https://www.electronjs.org/docs/latest/tutorial/process-model).
The third account can change timing or shared GPU pressure; it is not evidence
that one account freed another account's WASM model.

Do not infer a three-account limit, a bad account, or a specific WebGL context
limit. The current evidence establishes none of them.

## Evidence to capture next

First identify the affected window and its application/client versions.
Export its local diagnostics promptly, before repeating launches overwrite history.
Inspect `report.json`, `wasm.abort`, build identity, installed capabilities,
first-frame milestones, focus/visibility, and context loss/restoration events.
See the [diagnostics owner](../../docs/diagnostics.md) for export boundaries.

The current abort event stores only reason kind, text fingerprint, and heap size.
It does not store caller frames. A screenshot and matching fingerprint therefore
cannot distinguish our label release from an ArenaNet-owned model release.

The context handler dispatches HUD reset before recording the context event.
Do not require `graphics.contextLost` to precede `wasm.abort` when interpreting a
capture. Also do not conclude a reset exception necessarily suppresses the event:
DOM reports listener exceptions without propagating them to the dispatch caller.
See the [DOM event invocation rules](https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke).

For a focused diagnostic change, reuse bounded numeric WASM frame parsing from
[`wasm-memory-attribution.ts`](../../src/renderer/wasm-memory-attribution.ts).
Capture numeric frames at abort entry even when the abort reason is a string.
Bind them to the served module identity, including derived transforms.
Update the closed schema and privacy tests; do not export stack prose, pointers,
account identifiers, or a memory dump.

For a local development run, a breakpoint at the native assertion import can
identify the exact caller and whether the failing model belongs to our HUD.
Forced context loss should be tested only in a disposable development session.
These tests need no ArenaNet service stress.

## Comparison plan when FOO returns

Keep the account order, map, graphics settings, and launch pacing comparable.
Record which window fails. Change one feature group at a time:

1. Try the same launch with optional Tools disabled after a clean renderer launch.
2. Enable Tools with native HUD labels and native map drawings disabled.
3. Enable cooldowns, effect timers, and shortcut badges while maps remain disabled.
4. Enable native Maps and Compass drawing while HUD labels remain disabled.

Verify effective installed capabilities, rather than relying only on saved toggles.
A short run without a crash is weak evidence for an intermittent failure.
Recurrence with the same fingerprint is more informative than one quiet run.
Level 1 can record an owner's timing with multiple accounts. Current diagnostics
refuses Level 2 while more than one game window is open.

If the third window fails before any native label or map model exists, the HUD
candidate weakens for that window. If an older running window fails instead,
HUD withdrawal and context reset remain strong candidates.

## Recommended repair boundary

Investigate native resource retirement first, before imposing account limits,
increasing the heap, or retrying launches automatically.

The native HUD owner should stop drawing a withdrawn label immediately but retain
its model handle until the renderer no longer holds it. Identity replacement,
reset, and native destruction must obey the same lifetime rule. Native-frame
destruction may need a deferred resource lifetime after its UI frame disappears;
simply returning busy must not lose the retained handle or leak the model.

Review Maps and Compass against the same destruction rule. Guarding atlas
replacement alone does not cover resource retirement. Do not disable the official
assertion or force its reference count to zero.

Promote the conditional proof into a regression test when implementing a repair.
Extend the existing artifact harness so releases enforce the official invariant.
Then verify retry/retirement, eventual cleanup, and client certification hashes.
Live acceptance must cover zoning, finishing timers, icon changes, graphics
resets, and concurrent accounts. Offline success cannot certify gameplay.

## Investigation verification before repair

- Conditional crash probes: nine of nine reached the expected official assertion.
- Official enqueue reproduction: nine exact assertions and nine successful
  controls after official queue drain.
- Unmodified HUD and graphics queue artifact tests: four passed.
- `pnpm run check`: passed, including type checks, lint, Markdown links,
  1877 unit tests, 188 policy tests, 280 Tools tests, and 82 launcher tests.
- At that point, production code, official cached client, and existing sessions were not changed.
- No live-game or multi-account reproduction was performed.


## Repair on `fix/native-hud-resource-lifetime`

The HUD transform now marks retired records before releasing resources. Retired
records restore stock keys and stop contributing draws. The record retains its
mesh and model handles while the certified render-reference or graphics-phase
guard reports busy. Native collection reaps retirement after the host layer has
been disposed; later label and atlas publications use the same cleanup owner.
Reset keeps shared storage and material until all retired draws can close.
Geometry updates and identity replacement retry before changing a queued model.
A cleanup flag avoids scanning records on every icon when nothing is pending.

The existing HUD artifact test now checks all three channels through withdrawal,
identity replacement, native destruction, and repeated reset. Controlled native
peers reject any close while the model is queued or the graphics queue flushes.
The test verifies immediate draw withdrawal, restored stock keys, eventual
cleanup, replacement retry, and no duplicate close or lost storage.

The local official-queue probe now tests the repair instead of expecting a
crash. It uses official enqueue, drain, and destructor bodies. It verifies that
the ordinary reference survives retirement, then closes after native drain.
These binaries remain ignored scratch artifacts. Do not distribute them.

Enhancement ABI 72 invalidates older derivatives. All twelve current October
retained output hashes were recomputed from the cached official artifact.
The older historical generation is unavailable locally; its historical output
facts were left intact. Runtime certification derives output hashes from the
current exact input rather than accepting those historical facts as authority.

FOO's trigger remains unconfirmed. Live acceptance still needs zoning, timer
expiry, icon replacement, graphics resets, and concurrent accounts. No live
session was started or modified during this repair.

Repair verification passed:

- Existing HUD artifact tests, including 24 retirement cases across three channels.
- The same regression against the original transform fails in all three channels
  at the queued-model close boundary.
- Nine repaired official enqueue/retire/drain/close cases and nine drained controls.
- Complete shipped client-chain qualification and independent HUD refusal proof.
- `pnpm run check`: type checks, lint, links, 1877 unit tests, 188 policy tests,
  280 Tools tests, and 82 launcher tests.
- Diff whitespace check; unrelated `.claude/` work remains untouched.

## Wider native drawing audit

The additional audit found the same unconditional close in native map surfaces
and in both Compass consumers. The initial regression reached the controlled
native close with a nonzero render reference in each owner. These paths now keep
one bounded pair per surface until the reference drains and the device is idle.
Replacement cannot overwrite that pair. Native rendering, withdrawal, and upload
callbacks retry cleanup. A closed map can retain its pair until its next callback
or until the entire client runtime ends.

Compass destruction now invalidates the certified native UI cache before close.
Its host hide operation previously rewrote mesh indices without the upload guard;
hide and native camera updates now defer geometry writes while the model is held.
Deferred creation handles a Canvas that disappears before its resources exist.
A changed native invalidation function withdraws Compass drawing while leaving
independently certified map surfaces available.

Native view capture also has a render-reference assertion. In the October
artifact, `1563` and the batch operation `1564` both check model +152 and assert
`m_renderRefCount == 0` at `GrModel.cpp:1862`. Map render callbacks now defer capture
and submission while held. HUD collection reuses the already captured draw while
held, without changing matrices, geometry, or alpha. Its host publisher continues
to retry geometry after drain. These conditional tests do not establish that the
official frame loop invoked either callback at that point in FOO's session.

Cartography ABI 47 invalidates the older map/Compass derivatives. The HUD output
hashes were recomputed after the additional collection guard. No other native
drawing transform exists outside these three owners in this checkout. The audit
also checked host texture-buffer cleanup, reset listeners, publication retries,
module-instance isolation, and graphics phase checks. It found no additional
specific failure mechanism there. This is a scoped code audit, not proof that
native drawing has no remaining bugs.

### Historical diagnostic comparison caveat (corrected below)

Before the Core/Tools boundary fix, turning Tools off was not a clean removal of every native drawing owner.
`main.ts` requested Cartography on every standard launch, independently of the
Tools launch profile. Only an untouched-official diagnostic policy omits it.
Compass constructors can allocate their retained models even before a host
uploads artwork. This does not establish another crash, but means a Tools-off
comparison still exercises Compass lifetime code.

Use the existing **Untouched official client** diagnostic profile as a broad
control when appropriate. It also removes other transforms and uses the official
2 GB memory limit; it does not isolate native drawing as the only changed factor.
See [diagnostic reproduction profiles](../../docs/diagnostics.md).

Wider audit verification passed:

- Eight native artifact tests across HUD, map surfaces, Compass consumers,
  native cache refusal, native draw order, and map pointer bounds.
- Old map and Compass close paths fail when their renderer reference is held.
- View-capture peers reject a queued model; fixed map rendering retries after
  drain, and fixed HUD collection preserves the existing captured draw.
- Compass tests cover queued hide/resize, replacement, repeated destruction,
  cleanup after drain, empty deferred creation, and idle hidden geometry.
- The complete shipped client chain passed with identical assertions and a
  360-second local timeout, taking 330 seconds on the loaded host. Its standard
  120-second run timed out; the repository test timeout remains unchanged.
- Independent HUD refusal and the official native graphics-phase proof passed.
- Final `pnpm run check` passed: type checks, lint, links, 1877 unit tests,
  188 policy tests, 280 Tools tests, and 82 launcher tests.
- No production app session, publication, or live gameplay check was performed.

## Core/Tools boundary follow-up

The previous Tools-off comparison caveat was a confirmed launch-boundary bug.
Main requested the complete Cartography transform on every non-official
diagnostic launch, including Core. The renderer correctly refused live Maps
installation, but still imported its lifecycle, and Core statically imported
the map-knowledge store and Maps evidence exporter. All three Maps IPC channels
were declared Core and lacked the Maps feature gate.

The launch request now uses the canonical `enhancementSelection.tools` latch.
The Maps lifecycle imports only in a Tools-capable launch. The store, evidence
exporter, bridge namespace and three channels now belong to ToolsRuntime and
Tools IPC. Requests pass through its existing Maps gate and disposal barrier.
Core still retains its required platform/input repairs and saved settings.
Disabling Tools live stops activity; a restart loads Core without optional
native hooks. This removes the comparison confound; it does not by itself prove
which path caused FOO's crash.

Regression coverage checks Core's import closure, generated preload namespace
and channel absence, and the final real-client Maps export in each launch mode.

Follow-up verification passed: `pnpm check`, final-source type checking,
15 generated-preload behavior checks, and both shipped real-client chains.
The chain assertions completed in 69 seconds with a larger local watchdog;
the committed timeout remains unchanged. No application sessions, gameplay QA,
publication, or external communication were performed.

## Final lifecycle review

A throwing Maps cleanup callback previously remained owned and could run again.
It also escaped the lifecycle into disablement or renderer unload. Cleanup now
clears ownership before invocation and reports failure through the existing
optional-feature error path. A regression executes both disable and unload,
rejects the old behavior, and proves one disposal attempt. Optional Maps module
loading is also isolated from game startup, and a late module load cannot create
a lifecycle after renderer unload.

Final verification for PR preparation passed on 5 October 2026:

- Repository check, build, and both compiled kernel integrity checks.
- Nine real-client artifact checks, including both shipped launch chains.
- Nine official queue retirement cases and nine already-drained controls.
- Fifteen generated-preload behavior checks.
- Two real Electron offline launch checks: Core omits Maps transports; Tools
  rejects Maps reads and writes after child or master disablement and allows
  reads after child re-enablement. Temporary profiles and processes are closed.
- The disposal regression fails on the old lifecycle and passes on this branch.

Electron process launch required the unsandboxed test path. No gameplay or
three-account QA is claimed. Native callback retirement can retain one bounded
pair for a closed surface until its next callback or the WASM instance ends.
The temporary proprietary queue capsules were removed by the clean build.
