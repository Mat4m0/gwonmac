# Recover certification after an ArenaNet client update

> **Status: maintainer recovery guide.** Use this file only when the bounded
> certification tools refuse. Current commands and runtime rules are owned by
> [Enhancement development](../../docs/enhancement-development.md) and the code
> under `src/main/certification/`.

## Safe result

An unknown client must remain playable as the untouched official module.
Template repair and Enhancement features can continue only when the isolated
verifier proves their complete feature-local semantics. A CI report, exact
hash row, shared address, or function-index delta is not proof.

Main publishes the effective status of each feature to both diagnostics and
player-facing code. Do not reconstruct a second whole-build state:

| Feature status | Meaning |
| --- | --- |
| `available` | The served module contains the proven feature. |
| `off` | The player did not select the optional feature. |
| `unavailable: game-update` | This exact Guild Wars build does not prove it. |
| `unavailable: preparation-failed` | Proof exists, but the feature did not start. |

Check this value first when a player reports a regression after an ArenaNet
update.

## Step 1: try to delete the workaround

Install the official candidate and test the affected official behavior. If
ArenaNet fixed the defect, delete the local transform instead of certifying it
again. The purpose of each transform is to disappear when the official client
no longer needs it.

## Step 2: use the bounded tools

First reproduce the current certified template entry:

```bash
pnpm certification template --expect-certified
```

Then inspect the new official module:

```bash
pnpm certification template "/absolute/path/Gw.jspi.wasm"
pnpm certification template "/absolute/path/Gw.jspi.wasm" --emit-ts
pnpm certification recertify "/absolute/path/Gw.jspi.wasm"
pnpm certification double-click "/absolute/path/Gw.jspi.wasm"
```

Read the template report status first:

| Status | Action |
| --- | --- |
| `certified` or matching `derived` | The runtime predicate accepted this input. No table change is needed. |
| `derived` | Review the evidence. Do not treat formatting or a generated row as proof. |
| `not-applicable` | Test whether ArenaNet fixed the defect. Prefer deletion. |
| `failed` | Use the manual procedure below. Do not weaken the locator to force a result. |

The template command uses the same production locator as the launcher. It
derives candidates from body shape, signatures, and caller intersections. The
runtime verifier also compares complete affected caller bodies while
normalizing only the selected call-index operands. Matching offsets alone are
not enough.

The Enhancement report is review evidence only. `candidate`, `ambiguous`, and
`unavailable` cannot create runtime authority. CI never writes its findings
into launch-authority tables.

## Manual template recovery

Use this procedure only after an automated refusal.

### 1. Record the artifact

Record the official SHA-256, byte size, build ID, function import count, and
WASM validity. Do not assume the old import count of 219.

### 2. Generate investigation symbols

```bash
python3 tools/gensyms.py "/absolute/path/Gw.jspi.wasm" build/
```

This produces a named investigation module plus function and string-reference
reports. Generated client artifacts stay untracked.

### 3. Locate the template routines by meaning

Do not search for old indices. Use these measured shapes and call contexts:

| Routine | Locator evidence |
| --- | --- |
| Create directory | Body is one `i32.const 2`; callers include account templates, screenshots, chat logs, and login. |
| Find files | Empty body; signature `(i32, i32, i32) -> ()`; called by both template scans. |
| Derive entry name | Body is one `i32.const 0`; six `i32` inputs and one `i32` result; called by both scans. |
| Delete file | Short `assert("not implemented")` body with a live file-delete caller. |
| `File::Open` | In the template writer, one `(i32, i32, i32) -> i32` callee is called first with mode 1 and later with mode 2. |

The mode value is the second-to-last argument. Decode instructions instead of
matching raw bytes. Only the mode-1 existence probe is repointed. Keep the
mode-2 writer and the template loader on the original function.

### 4. Record exact call sites

For each approved caller, record the local function index and the decoded byte
offset of the call. Confirm that the call instruction uses the expected padded
encoding. If the new toolchain changes the width, the in-place repoint is no
longer valid. Change the transform design; do not overwrite a different number
of bytes.

### 5. Measure the client contract

Append temporary export entries to an untracked copy of the official module.
Instantiate it with zero-returning stub functions and call only pure helpers.
Appending exports changes only the export section.

Re-measure at least these facts:

- whether `Path::GetDirectory` keeps the trailing separator;
- which separator `_wmakepath` inserts;
- whether `Path::RemoveExtension("\\Test.txt")` still drops the last name
  character;
- the file and directory enumeration patterns;
- the meaning of the enumeration flags; and
- the mode-1 `File::Open` behavior.

`memory` and `malloc` are exported by the examined official module. Use the
client allocator when a client caller will free the result. Run the same pure
probes on the derived module to confirm marker arguments and return polarity.

Do not call stateful UI or text functions in a cold instance. Use one bounded
live instrument for those functions.

### 6. Update and verify

Add a template table entry only after the evidence matches. Start with an empty
derived output hash, run the production transform, and pin the resulting hash.
Increase `TEMPLATE_SAVE_TRANSFORM_ABI` if the derived bytes or bridge contract
changed.

Certify transforms in this order:

1. official module;
2. template-save output;
3. optional Enhancement output; and
4. native double-click output.

Later stages certify the bytes produced by earlier stages. They are not
alternative transforms.

Run the repository verification defined in `AGENTS.md`. Then use one live
check for the behavior that offline proof cannot establish.

## Offline bridge check

Instantiate the derived module with the real renderer bridge and an offline fake
filesystem. Drive the forwarders with the path shapes that the client really
produces, including:

```text
Templates/Skills/\Test.txt
```

A clean fixture such as `Templates/Skills/Test.txt` previously hid a delete and
rename failure.

## Minimum live template check

Use one account and complete this sequence in one run:

1. Save a skill template and confirm the complete name.
2. List and load it.
3. Rename it and confirm that no old or empty duplicate remains.
4. Delete it and confirm that the client does not abort.
5. Restart and confirm that the remaining templates persist.
6. Repeat the save, list, load, rename, and delete sequence for equipment.
7. Confirm screenshot creation because it uses the same directory and listing
   routines.

The official client does not recursively scan template subdirectories. Do not
use a nested template as a success criterion for the bridge.

## Do not repeat these mistakes

- Do not bypass a failing create-directory guard. The later null-handle path can
  abort.
- Do not use a cleaner path in a fixture than the client supplies.
- Do not ignore an argument because its meaning is unknown.
- Do not read a filtered trace as proof that no call occurred.
- Do not certify a static address without a live invariant.
- Do not weaken a locator until it returns one result.
- Do not make optional Tools a requirement for the official client.
