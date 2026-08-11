# Surviving ArenaNet Client Updates — Research

> **Status: historical research evidence.** The remote certificate-feed
> recommendation and placeholder-pin statements below are superseded. The
> repository already had a real pin, but no operational feed, and an old
> application could not gain newly measured Enhancement facts from it. That
> remote authority has been removed. Runtime authority now stays in compiled
> facts and isolated local proof; scheduled recertification proposes changes,
> and new Enhancement facts ship in a signed application release. Preserve the
> body below as the investigation that led to the decision; do not use it as an
> implementation roadmap.

**Date:** 2026-08-04
**Question:** We now have native mouse cursor, native double click, template saving,
a map/target readout, and soon hero build management. All of them reach into
ArenaNet's client. How do we make this survive client updates (when there are no
crazy changes)? And should we build our own GWCA-as-WebAssembly shared library?

---

## TL;DR

1. Our features fall into **three classes**, and only one of them is fragile:
   - **Pure host-side** features (cursor-refresh retry, pointer-lock gating,
     input, filesystem) survive every update automatically.
   - **Structurally proved** features (template saving) are re-derived by a
     machine on a new build. This already works, fully automated, CI included.
   - **Address-fact** features (native cursor, target readout, double click,
     the party/hero observation) depend on memory addresses and function
     indices that move on every build and that no machine can prove. Today a
     human re-measures them. **This is the only real problem.**
2. Nobody in the Guild Wars ecosystem has solved class 3 with full automation.
   GWCA/GWToolbox (20 years of practice) solved it with **anchors + tooling +
   a fast human loop**: on a patch day, most anchors survive, tools list what
   broke, and a maintainer fixes the rest in hours. That is the realistic goal
   for us too: shrink patch day from "days of reverse engineering" to
   **"under an hour of machine-proposed, human-confirmed updates"**.
3. The highest-leverage tools to get there already half-exist across the three
   sibling repos. The single biggest win is porting the **cross-build symbol
   mapper** from GWCAjs (it automatically carried 17,302 of 17,739 function
   names from one build to the next) and adding **per-fact derivation recipes**
   so every certified address gets a machine-proposed candidate on a new build.
4. **Do not build a full GWCA-WASM shared library.** GWCA maintains ~150
   scanned symbols and still breaks (and gets fixed) roughly weekly on Windows.
   A broad "best-effort API" contradicts our fail-closed model and would be a
   second source of truth. Instead: harvest GWCAjs for its mapper and its
   already-verified evidence (its hero-management calls are live-tested), and
   grow a narrow, certified surface inside this repo, feature by feature.
5. ArenaNet asks: the seven filed defects would let us **delete** transforms
   (the best kind of survival). Beyond bug fixes, the cheap high-value asks are:
   keep shipping the `build_id` section and assert strings, publish the
   function **name map** per build (they already build one — the client
   references `external_debug_info`), and consider a tiny official host API for
   the things we currently reach in for (cursor art, double-click flag,
   template file I/O).

---

## 1. Background: how the whole thing works (plain English)

### 1.1 What the client is

Guild Wars on the web/macOS is ArenaNet's own C++ client compiled with
Emscripten to **WebAssembly** (WASM). Two facts about WASM matter for
everything below:

- **All memory is one big array.** The client's variables, structs, and arrays
  live in a single "linear memory" (a giant byte buffer). A "memory address"
  like `0x5a0ee0` is just an offset into that buffer. The host (our Electron
  app) can read and write this buffer freely.
- **All code is a numbered list of functions.** There are ~17,600 functions,
  identified only by index (function #2469, #6842, …). Names were stripped.
  A function's index changes whenever ArenaNet recompiles, because adding or
  removing any function shifts the numbers of everything after it.

gwonmac is the _host_: it downloads the official client, provides it with
platform services (files, DNS, sockets, keychain, …) through the Emscripten
`Module` object, and runs it in a sandboxed Electron window.

### 1.2 How we add features the client doesn't have

Because the client is missing things (working template file I/O, a native OS
cursor, a double-click flag), we do three kinds of interventions:

1. **Host-side only.** We change our own code (the Electron/renderer side) and
   never touch client bytes. Example: the cursor-refresh retry that nudges the
   client with a synthetic mouse-move when the cursor state looks stale
   (`src/renderer/cursor-refresh.ts`).
2. **Byte transforms on the client module.** Before instantiating the WASM, we
   rewrite a few bytes: reroute five broken file functions to the host
   (template saving), splice a cursor/tick dispatcher in (Enhancements), or
   splice three instructions that store a double-click flag. Every transform
   is fail-closed: input hash must match a certified entry, output hash must
   match too, otherwise we serve the **untouched official module**. Worst case
   is always "feature missing", never "corrupted client".
3. **The companion kernel.** A tiny, dependency-free Rust WASM module
   (`src/companion-kernel/`) that the Enhancement transform lets the client
   call once per tick and per cursor event. It _reads_ client memory
   (bounds-checked, every pointer chase can fail safely) and publishes small
   snapshots (cursor bitmap, target info, party/hero state) into a region the
   host allocated. It writes nothing the game owns.

### 1.3 The certification chain (our existing safety net)

`src/main/certification/` owns one idea: **no transform runs unless we have
proof it is correct for this exact build.** Three compiled-in tables:

| Table                        | Facts stored                                                       | Who can re-derive them on a new build          |
| ---------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| `TEMPLATE_SAVE_BUILDS`       | 5 stub functions + their call sites (code shape)                   | **A machine** — structural proof               |
| `ENHANCEMENT_BUILDS`         | 36 memory-layout words + 13 message IDs + 4 function/table indices | **Only a human** — exact-hash lookup otherwise |
| `NATIVE_DOUBLE_CLICK_BUILDS` | 1 function index + its body hash + 2 byte offsets                  | Human (but failure degrades gracefully)        |

The chain is: official module → template-save transform → optional Enhancement
transform → double-click transform (`src/main/certification/client-module.ts`).
`certifyClientBuild` answers `certified`, `template-only`, or `uncertified`.

Around the tables sit three pieces of automation that already exist:

- **CI watches for new builds every 15 minutes**
  (`.github/workflows/client-recertification.yml`): it fetches ArenaNet's
  patch manifest, and on a change downloads the new code, re-derives the
  template-save entry structurally, and opens a PR with the new table entry —
  no human involved until review. Enhancement facts are deliberately left
  untouched, because no machine can prove them.
- **An isolated local verifier** in the shipped app does the same structural
  template proof on the user's machine, so template saving keeps working on a
  fresh build even before we ship anything.
- **A signed certificate feed** (`certificate-feed.ts` + its publication
  workflow) can deliver new certifications to users **without an app update**
  — two small signed files attached to the current GitHub release. It is
  fully built but **dormant**: the pinned public key is still the placeholder,
  so no clone trusts any remote feed yet.

---

## 2. The challenge, precisely

When ArenaNet recompiles the client, three different things can move:

| What moves                        | Example                                                                                      | How often it breaks things                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Function indices & code bytes** | cursor-event function was #2469                                                              | Practically every build (indices shift when any function is added/removed)                                                                       |
| **Static data addresses**         | context root at `0x5a0ee0`, agent array at `0x5a4e58`, cursor color buffer at `0x298e50`     | Every build, and **not by one common delta** — build 38797 empirically disproved uniform relocation                                              |
| **Struct layouts & message IDs**  | "map ID is at offset `0x198` inside CharacterContext", message `0x1000011e` = party-add-hero | Rarely — only when ArenaNet actually edits a struct or enum. GWToolbox's history confirms layouts are the stable part and IDs churn occasionally |

Template saving survives because its facts are **about code shape** ("the
function whose whole body is `i32.const 2; end` and that is called from
exactly these three kinds of places") — shape can be found again on a new
build and _proved_ to mean the same thing (the verifier hashes the complete
bodies of all affected callers; any semantic change refuses).

Enhancement facts don't survive because they are **naked numbers**. Nothing in
the module says "this global is the context root". Worse, a machine that
"re-derives" an address it chose itself proves nothing — it would happily
certify its own guess. That's why `ENHANCEMENT_BUILDS` accepts exact hashes
only, and why a compromised or buggy pipeline can at most deny features, never
inject wrong addresses (`docs/wasm-host.md` owns this argument).

So the honest formulation of the problem is:

> For each address fact, either find a _structural anchor_ that lets a machine
> re-derive it with an actual proof, or build tooling that produces a
> _high-confidence candidate_ a human can confirm in minutes instead of
> re-measuring from scratch.

---

## 3. Feature-by-feature status

| Feature                                         | How it works                                                                                                                                                                 | Build-specific facts                             | On a new build today                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Template saving**                             | 5 broken client file routines rerouted to the host via marker syscalls                                                                                                       | 5 function indices + call sites — _structural_   | **Auto-recertifies** (CI + on-device verifier). Only a semantic change in the callers needs a human |
| **Native mouse cursor**                         | Enhancement transform hooks the cursor-event function; kernel chases `cursorActiveArt → texture → 32×32 BGRA buffer`, publishes bitmap; renderer sets CSS `image-set` cursor | fn #2469, table slot 922, 12 cursor layout words | **Breaks.** Human re-measures, new `ENHANCEMENT_BUILDS` entry, app release (or feed, once live)     |
| **Target/map readout**                          | Kernel reads context root → character context → map/instance/player words; agent array scan; range bands                                                                     | 17 core layout words                             | **Breaks** (same certificate)                                                                       |
| **Party/hero observation** (Toolbox foundation) | Kernel walks party context → heroes array; UI dispatcher hook observes 13 message IDs                                                                                        | 7 party words + 13 message IDs + fn #6842        | **Breaks** (same certificate)                                                                       |
| **Native double click**                         | 3 spliced instructions store a host-written flag global into the input record; host writes flag on every trusted `mousedown`                                                 | fn #2448 + body hash + offsets 101/24            | **Breaks, but degrades silently** — chain serves the previous stage, you just lose double click     |
| **Cursor-refresh retry, pointer-lock gating**   | Pure renderer logic reading published cursor state                                                                                                                           | none                                             | Survives (useless without the cursor cert, but never harmful)                                       |
| **"Map cursor"**                                | Not a separate feature — it is the cursor bitmap pipeline plus the map-state words above                                                                                     | —                                                | covered above                                                                                       |
| **Keyboard label offset**                       | Investigation only; nothing ships (`internal/upstream/keyboard-label-offset.md`)                                                                                             | —                                                | n/a — filed upstream                                                                                |
| **Hero build management**                       | Host-side codec, storage, and UI; certified reads/actions degrade independently                                                                                              | hero, skill, and action facts                    | Host data persists; running-game availability remains certification-dependent                        |

Key numbers for intuition: the fragile surface is currently **4 function/table
indices + 36 layout words + 13 message IDs + 1 body hash** — about 54 facts.
For comparison, GWCA on Windows maintains ~93 scan anchors resolving ~150
symbols, plus big hardcoded enum files. Our surface is deliberately ~3× smaller.

---

## 4. How the rest of the ecosystem survives updates

### 4.1 GWCA (Windows, C++) — anchors instead of addresses

GWCA never stores addresses. At startup it _scans_ the running client:

- **Byte-pattern scan:** find a distinctive instruction sequence, then read the
  address out of an instruction operand (e.g. the operand of `mov [imm32], edx`).
  Fragile: any compiler change around the anchor breaks it. GWToolbox's own
  docs call raw signatures "the most common breakage".
- **Assert-string anchor (the good trick):** ArenaNet ships assert messages
  and original source paths (`p:\code\gw\ui\...\ptsearch.cpp`,
  `"targetPrimaryProf == templateData.profPrimary"`) in the binary. GWCA finds
  the _string_, then finds the code that references it, then follows nearby
  `call` instructions. Strings come from source code, not from the compiler,
  so these anchors "survive almost every update" (GWToolbox doc, verbatim
  sentiment). One anchor often yields several functions — the template-load
  anchor alone gives `ChangeSecondary`, `LoadAttributes`, `LoadSkills`.
- **Graceful degradation:** a failed scan stores a null pointer; every public
  API null-checks and returns `false`. One broken pattern kills one feature,
  not the library. Everything is logged as `[SCAN] name = 0x0`, which is what
  the maintainer greps on patch day.

Even so, GWCA's commit history shows clusters like "SkillbarMgr signatures
updated / MapMgr signatures updated / PartyMgr signatures updated" after a
single ArenaNet build — the human loop never went away, it just got fast.

### 4.2 GWToolbox++ — the patch-day harness

GWToolbox recently formalized its process in `docs/gw-auto-update/` plus
`tools/gw-update/` (Python). The pieces worth copying conceptually:

- **`anchor-index.json`:** a machine-readable inventory of all 345 scan sites,
  classified by kind (raw / string / assertion / wrapper). You cannot manage
  what you haven't enumerated.
- **`detect_build.py`:** reads the client's build ID by scanning for a known
  assert string — build detection itself uses the resilient anchor class.
- **`scan_survey.py`:** run the game once, parse the log for `[SCAN] x = 0`,
  get the complete list of what broke. Their docs explicitly note the survey
  needs an assert-free build so it reports _all_ failures, not just the first.
- **A ranked "check these first" list** and a functional smoke matrix
  ("party: self + heroes present, correct ids"; "skillbar: 8 slots, ids match").
- Their measured experience: raw signatures break most; assert anchors rarely;
  enum/ID tables (`UIMessages.h`) have the largest churn; struct offsets break
  rarely but silently (no scan failure — just wrong data).

### 4.3 GWCAjs-web-app — the WASM-specific answers

This workbench already solved two problems specific to _our_ client:

- **Fail-closed build gating** (same philosophy as ours): every patched
  function index is keyed to an exact `build_id` (a custom section in the
  WASM!) and validated against its expected type signature; unknown builds are
  left untouched with a reported reason.
- **Cross-build symbol carry-forward — the crown jewel.** An old client build
  (38549) shipped _with names_. Their correlator maps functions from a named
  build to a new stripped build using nine ranked heuristics (identical
  imports, normalized instruction bodies, call-graph shape, size/order deltas
  between trusted anchors, opcode-shingle similarity). Result on 38615:
  **17,302 of 17,739 functions auto-mapped** (8,637 exact, 8,665 high
  confidence), 433 flagged for review, 4 unmapped. A 12-step per-build
  procedure then promotes the newly named binary as the next baseline.
  Their hard rule, three times in the docs: _"Never infer a universal
  function-index delta between builds"_ — map per-function, verify per-fact.

It also already contains **live-verified hero-management evidence**: the
internal packet-send functions for add/kick hero and henchman, hero data
arrays (`WorldContext + 0x594`, stride `0x9c`), pet data, attributes, and
`SetHeroBehavior` — exactly the raw material hero build management needs.

### 4.4 Our own repo — what we already do better

- The structural template proof is _stronger_ than anything GWCA does: it
  doesn't just find the functions again, it proves the surrounding semantics
  didn't change (complete-caller-body fingerprint), and it runs in CI **and**
  on the user's machine.
- The 15-minute build watcher + auto-PR is ahead of both Windows projects.
- The certificate feed (dormant) is a distribution mechanism neither Windows
  project has: certifications without app releases.
- `tools/wasmscan.py` already decodes 100% of the client's functions and
  resolves assert-string anchors; `tools/gensyms.py` already recovers symbols
  from the 850 `.cpp` source paths ArenaNet ships in the data section; and
  `src/tools/enhancement-structural-evidence.ts` already finds candidate hook
  boundaries (tick export, cursor target, UI dispatcher) — with honest
  `candidate / ambiguous / unavailable` statuses instead of guesses.

The gap is narrow and specific: **nothing today turns the 36 layout words and
13 message IDs into machine-proposed candidates on a new build.**

---

## 5. Mitigation strategy

Think of it as four layers, cheapest first.

### Layer 0 — keep pushing features into the survivable classes

Before any feature touches client memory, ask: can it be host-side (class 1)?
Can its facts be structural (class 2)? The double-click design is the model
citizen: the risky part is 3 spliced instructions with a body-hash guard, and
its failure mode is "no double click", isolated from the rest of the chain.

### Layer 1 — give every address fact a _derivation recipe_

This is the core proposal. Today an `ENHANCEMENT_BUILDS` entry is a bag of
numbers plus prose in `internal/upstream/toolbox-foundation.md` describing how
each was measured. Turn that prose into data: for every fact, a
machine-checkable recipe saying _how to find its candidate on a new build_,
in one of these forms (in descending order of strength):

1. **Assert-string anchor** (GWCA's trick, ported to WASM): "the address is
   the `i32.const` operand at position N inside the function that references
   assert string `s_propContext` in `.data`". Assert strings and source paths
   are compiler-independent; `wasmscan.py` already resolves them.
2. **Carry-forward anchor:** "this fact lives in function F of build X; find
   F's image in build Y via the symbol mapper, then re-extract the operand."
3. **Structural-shape anchor:** what `enhancement-structural-evidence.ts`
   already does for the three hook boundaries (e.g. "the function installed in
   an active table slot that both producer functions call indirectly").
4. **Invariant check only** (weakest): no anchor, but a live assertion that
   can validate a candidate ("dereferencing candidate contextRoot must yield a
   context whose slot 6 points at a struct whose `+0x44` child has
   `mapId ∈ 1..2000` and `baseMap == mapId`" — the kernel's existing sanity
   rules, run as a test instead of at runtime).

Struct _offsets_ (the `0x198`-style words) mostly need only class 4: they
rarely move, so the recipe is "carry the old value, prove it with the live
invariant". Static _addresses_ and _function indices_ need classes 1–3.

Crucially, this does **not** weaken the trust model. Recipes produce
_candidates with evidence_; a human still confirms; the certified table still
stores exact facts and exact output hashes; the feed still only restates the
table. What changes is patch-day effort: from "re-measure 54 facts" to
"review 54 pre-filled diffs, most marked exact-match".

### Layer 2 — the patch-day pipeline (mostly assembling existing parts)

On the 15-minute watcher detecting a new build:

1. CI already downloads the code and auto-derives the template entry. ✅ exists
2. **New:** run the symbol mapper (ported from GWCAjs) old-named → new build.
   Archive the named artifact per build — that baseline is the one thing you
   must never lose.
3. **New:** run every derivation recipe; emit one report:
   🟢 fact re-derived with proof-grade anchor · 🟡 candidate found, needs
   confirmation · 🔴 no candidate, needs reverse engineering.
4. **New:** a semi-automated live checklist: the existing `enhancements-live`
   scenarios (`cursor-capture`, `target-readout`, `toolbox-foundation`)
   extended to assert each certified fact against the running client, so
   "human confirms" means "human logs in and watches 10 checks go green".
5. Human pastes the confirmed entry (the `certification` CLI already formats
   entries), PR merges, and — once the feed goes live — users get the
   certification **without waiting for an app release**.

### Layer 3 — activate the certificate feed

Everything is built; the go-live checklist in `certificates/README.md` (key
ceremony, publishing environment, replace the placeholder pin, ship one
release carrying the real key) is the last mile. Without it, every
recertification costs a full app release; with it, patch-day recovery for
users is "we merged the entry, the feed updated, restart the app".

---

## 6. Hero build management specifically

Good news from the research: most of it is _not_ new fragile surface.

- **Template codes are pure data.** The skill-template format is a small
  base64 codec over a 140-byte struct (professions, 12 attributes, 8 skills).
  GWToolbox ships an independent pure-C++ codec, and even documents the
  party-wide "teambuild" string format (magic byte `0x1F`). Encode/decode/
  store/share can be implemented entirely host-side — survives every update.
- **Applying a build to the player** may need _zero_ new client facts when
  template publication is certified: the
  game's own `Templates/Skills` folder is already load-bearing in this repo —
  the game reads templates from disk, and our template-save bridge already
  owns that directory. Without certification, publication into the running
  game remains unavailable.
- **Listing heroes** is reads only, and the party layout words for it are
  partially certified already (heroes array walk in the kernel). The hero
  roster (`hero_info` array: id, level, professions, name) is one more
  read-model in the same class as what the kernel does today.
- **The genuinely new, risky part** is _actions_: add/kick hero, load a
  template into a hero's bar, set behavior. GWToolbox's flow (via GWCA) is:
  `AddHero(id)` → wait until the hero appears in the party (async, ~1 s
  timeout) → `LoadSkillTemplate(hero_agent_id, code)` → set disabled skills →
  `SetHeroBehavior`. GWCAjs has already located and partly live-verified the
  WASM equivalents (the `CharMsgSend…` packet functions with their opcodes).
  Calling client functions is a separate capability class. Add one bounded,
  user-initiated action at a time only after its exact-build facts and refusal
  behavior are independently proved.
- **Skill names/icons** are ArenaNet content we won't redistribute — so it's a
  certified read of the client's own skill table, or no names. The plans flag
  this as the most under-estimated primitive.

Design consequence: build hero management so that the pure-data layer
(codecs, storage, UI) and the read layer ship first and keep working across
updates, while each _action_ is its own small certified fact with its own
graceful degradation — exactly the double-click pattern.

---

## 7. What we could ask ArenaNet

Ordered from "trivial for them, huge for us" upward. The framing that works:
every item lets an interoperability host **delete** a workaround, and several
are plain bugs affecting their own client.

**Bug fixes already written up, ready to send** (`internal/upstream/upstream-defects.md`,
`upstream-keyboard-labels.md`, `mouse-double-click.md`):

1. Implement the four `Base/Os/Emscripten` file routines (create dir,
   enumerate, entry name, delete) — deletes our entire template-save transform.
2. Fix `Path::RemoveExtension` dropping the last character.
3. Drop `O_CREAT` from `File::Open` mode 1 (the rename probe creates the file
   it tests for).
4. Marshal `MouseEvent.detail` into the input record — one line for them,
   deletes our double-click transform.
5. Re-run cursor hit-testing after a server-acknowledged mode change —
   deletes our cursor-refresh retry.
6. Fix the printable-key label off-by-one.

**Stability asks (don't-break-us, effectively free for them):**

7. Keep shipping the `build_id` custom section, the assert strings, and the
   source-path strings — these are the anchors everything resilient hangs on.
8. Publish the per-build **function name map**. They demonstrably have one
   (the client references `external_debug_info`, and an older build shipped
   named). Even a hash-of-names-only map would make carry-forward exact
   instead of heuristic. This is the single cheapest ask with the largest
   effect: it turns our hardest problem (function indices) into a lookup.
9. Announce build pushes (a manifest field or feed) — we currently poll every
   15 minutes.

**Structural asks (bigger, worth raising once trust exists):**

10. Export a handful of functions and globals by name (cursor-art pointer,
    context root, the template helpers). Named exports are stable across
    builds by definition; each one deletes an address fact from our table.
11. Longer term: a tiny official host-services API for platform hosts —
    "give the host the cursor image", "accept a double-click flag", "let the
    host read the hero roster". We are, after all, implementing the platform
    half of their Emscripten port; routing these through `Module` imports is
    architecturally where they belong.

---

## 8. Should we build our own GWCA WASM shared library?

**Recommendation: no — not as a general-purpose shared library. Harvest
GWCAjs instead, and grow a narrow certified surface inside gwonmac.**

Reasoning:

- **Maintenance surface is the whole problem.** GWCA exposes ~480 API methods
  backed by ~150 scanned symbols, and its history shows weekly fix commits
  with an active maintainer community. GWCAjs reached 95 of 480 methods
  implemented with heroic tooling and still keys everything to exact builds.
  A broad API multiplies exactly the fact class (addresses/indices) that we
  established no machine can prove. Our entire strategy is keeping that class
  at ~54 facts; a GWCA-shaped library makes it hundreds.
- **Philosophy mismatch.** GWCA is best-effort: a failed scan silently nulls
  one feature at runtime. gwonmac is fail-closed with signed, exact
  certificates, because we transform and redistribute the module people play
  on. A shared "best-effort" layer under a fail-closed product is a
  contradiction — either it weakens our guarantees or its API lies.
- **Second source of truth.** The companion kernel already owns "read client
  state safely" with its own certified layout words. A parallel library would
  duplicate those facts and drift from them.
- **What GWCAjs is actually worth to us** — a lot, as an input, not a
  dependency:
  1. Port `Tools/map-jspi-symbols.mjs` (+ the per-build promotion procedure)
     into `tools/` here. That's the carry-forward workhorse.
  2. Treat its evidence ledger (`Evidence/InternalCalls.js`, 40 verified
     callables with indices, signatures, opcodes and verification states) as
     the head start for hero-build actions.
  3. Keep the repo as what it already is: a reverse-engineering workbench
     with a hot-patched live client — ideal for _measuring_ facts that then
     get certified here.
- **If/when many features need client calls,** the right shape is not a
  shared lib but a module inside this repo (the "GWCA-lite" the plans already
  sketch): one manager per capability, each backed by certified facts, each
  degrading independently — the same discipline as today, just more entries.

---

## 9. Concrete next steps

In order of leverage:

1. **Port the cross-build symbol mapper** from GWCAjs into `tools/`, and start
   archiving a named `Gw.jspi.named.wasm` per certified build as the mapping
   baseline. (Acceptance: on the next real ArenaNet build, the mapper reports
   the new indices of functions #446, #2448, #2469, #6842 with confidence
   scores.)
2. **Write derivation recipes for the existing 54 facts** — start by
   mechanizing the measurements already described in
   `internal/upstream/toolbox-foundation.md`, using `wasmscan.py` anchors
   where possible and live invariants where not. Extend
   `enhancement-structural-evidence.ts` to emit a per-fact candidate report
   (🟢/🟡/🔴) instead of only the three hook boundaries.
3. **Extend the live scenarios into a fact-verification checklist** so a human
   confirmation is a supervised 10-minute run, not an investigation.
4. **Do the certificate-feed go-live** (key ceremony + real pin + one release)
   so recertifications stop costing app releases.
5. **Send the upstream defect reports** — they are written and self-contained;
   every accepted fix permanently deletes fragile surface. Add the name-map
   ask (item 8 above) to the conversation.
6. **Build hero build management data-first:** codec + storage + UI (pure
   host), then the certified read model (hero roster), then one bounded,
   certified action at a time.

---

## Appendix: the three evidence classes, one-line versions

- **Host-side fact:** lives in our code. _Survives everything._
- **Structural fact:** "the function shaped like X, called from places shaped
  like Y" — a machine can find it again _and prove it still means the same_.
  _Survives all compiles that don't change the semantics._
- **Address fact:** a naked number (memory address, function index, message
  ID). No proof possible from the bytes alone; a machine may _propose_, only
  a measurement can _confirm_. _Breaks every build; the whole game is making
  confirmation fast._
