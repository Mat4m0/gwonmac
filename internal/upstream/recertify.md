# Re-certifying a new client build

Every function index, local index and byte offset in these documents belongs to
build `b0319704…`. A new ArenaNet client invalidates all of them.

Nothing breaks when that happens: `findTemplateSaveBuild` returns null for an
unknown hash and the untouched official module is used, so the client keeps
working and templates go back to being broken. Startup logs
`wasm.templateSaveUnsupported`, and the `wasm.templateSaveCompatible` gauge is
`false` in any `.gwdiag` a user sends — **check that first when someone reports
that templates stopped working.**

## The short version

```bash
# 0. Prove the tool still reproduces today's certified entry. Exits 0.
pnpm template:recertify -- --expect-certified

# 1. Point it at the new client and read the JSON.
pnpm template:recertify -- "<path>/Gw.jspi.wasm"

# 2. Get a paste-ready entry for TEMPLATE_SAVE_BUILDS (goes to stderr).
pnpm template:recertify -- "<path>/Gw.jspi.wasm" --emit-ts
```

The tool re-derives every index and call-site offset by shape — body bytes,
resolved signatures, and caller-set intersection — then runs the derived entry
through the production transform to fill in `outputSha256`. It never guesses:
each stage asserts an exact count and reports every candidate it rejected.

Read the `status` field first:

| `status` | Meaning |
| --- | --- |
| `certified` / `derived` with `matchesCertifiedEntry: true` | nothing to do |
| `derived` | paste the entry, bump the ABI if the derived bytes changed |
| `not-applicable` | no create-directory stub — **ArenaNet may have fixed it**, see step 1 below before doing anything else |
| `failed` | read `diagnostics`; a locator found the wrong number of candidates and named them |

**What this does not do.** It recovers indices, not semantics. Step 5 below —
re-measuring what the path helpers actually do — still has to be done by hand,
and skipping it is how you ship a bridge that resolves cleanly and behaves
wrongly. Every one of the six upstream defects in
[upstream-defects.md](upstream-defects.md) was a semantic finding, not an index.

## Manual procedure

Kept because the tool can only fail one way — by refusing — and when it does,
this is what you fall back to.

### 1. Check whether it is still needed

Install the new client and try to save a build. If ArenaNet has fixed the
defects, delete the whole bridge rather than re-certifying it — the point was
never to own this code. `git log` for `template-save-compat` gives the full
removal surface.

### 2. Regenerate symbols

```bash
python3 tools/gensyms.py "<path>/Gw.jspi.wasm" build/
```

Produces `build/Gw.named.wasm` (loadable in Ghidra, Chrome DevTools, Binaryen),
`build/symbols.csv` (function → source file and assertion strings) and
`build/string_xrefs.csv`.

Function index = local index + the function import count. Get the count from
`tools/wasmscan.py`; do not assume 219.

### 3. Find the four stubs, then `File::Open`

Each has a recipe that does not depend on the old indices:

**Create directory.** Body is a single `i32.const 2`. Cross-check the callers:
one in `AcctCliTemplate.cpp`, one in `UiScreen.cpp`, one in `CtChatLog.cpp`, one
in `ActDlgLogin.cpp`.

**Find files.** Body is empty, signature `(i32,i32,i32) -> ()`. Its callers are
the same set plus the two `AcctCliTemplate.cpp` scans.

**Entry name.** Body is a single `i32.const 0`, signature `(i32 × 6) -> i32`,
called from both scans.

Both scans are easiest to reach from the data side — find the UTF-16
`Templates/Skills` literal and the functions referencing it:

```python
import sys; sys.path.insert(0, 'tools')
from wasmscan import WasmModule
m = WasmModule('<path>/Gw.jspi.wasm')
for base, blob in m.segs:
    i = blob.find('Templates/Skills'.encode('utf-16-le'))
    while i >= 0:
        print(hex(base + i), m.refs_to(base + i))
        i = blob.find('Templates/Skills'.encode('utf-16-le'), i + 1)
```

**Delete file.** Sweep for `assert("not implemented")` bodies and keep the ones
with a live caller:

```python
def text(v):
    for base, blob in m.segs:
        if base <= v < base + len(blob):
            o = v - base
            return blob[o:blob.find(b'\0', o)].decode('ascii', 'replace')
for s, e, f in m.funcs:
    if e - s > 40: continue
    ops = list(m.decode_body(s, e))
    kinds = [op for _o, op, _v in ops]
    if kinds[:3] == [0x41, 0x41, 0x41] and 0x10 in kinds and 0x00 in kinds:
        consts = [v for _o, op, v in ops if op == 0x41]
        print(f, text(consts[0]), text(consts[1]), consts[2])
```

**File::Open.** The only bridged target that is not a stub, so it has no
distinguishing body — it is identified by how the template-write function uses
it. In the write function (a caller of create-directory that is neither of the
two scans nor a directory sink), find the `(i32,i32,i32) -> i32` callee that is
called exactly twice, where the first call is preceded by `i32.const 1;
i32.const 0` and the second by `i32.const 2; i32.const 0`.

The mode is the *second*-to-last constant: both calls end with the literal `err`
argument. Decode two instructions rather than matching raw bytes, or the recipe
breaks silently the day that argument stops being a literal zero.

Only the first of the two — the mode-1 existence probe — is repointed. The
mode-2 write call and the load path keep the real function.

### 4. Record the call sites

For each stub, the callers to repoint and the byte offset of the `call` inside
each caller's body:

```python
bodies = {f: (s, e) for s, e, f in m.funcs}
for caller in CALLERS:
    s, e = bodies[caller]
    for off, op, val in m.decode_body(s, e):
        if op == 0x10 and val == STUB_INDEX:
            print(caller - IMPORTS, off - s)
```

Confirm each is a 6-byte padded encoding (`10` followed by five bytes). If a
future toolchain emits canonical LEB there instead, the same-width repoint no
longer applies and the transform needs to splice bodies rather than overwrite in
place.

### 5. Re-measure the conventions

Do not assume the semantics carried over. Re-run the probes in the next section
for at least:

- `Path::GetDirectory` on a full template path — does it still keep the trailing
  separator?
- `_wmakepath` — still `/`?
- `Path::RemoveExtension` on `"\Test.txt"` — is defect 5 still present? If it is
  fixed, our extension stripping stays correct but the comment explaining it
  should say so.
- the enumeration patterns and their `flags` values

### 6. Update, pin, verify

`pnpm template:recertify -- <wasm> --emit-ts` does steps 1 and 2 for you.

1. Add the new entry to `TEMPLATE_SAVE_BUILDS` with `outputSha256: ""`.
2. Run the transform; the thrown error reports the actual derived hash. Pin it.
3. Bump `TEMPLATE_SAVE_TRANSFORM_ABI` if the derived bytes or the contract
   changed — it is part of the derived cache key.
4. Update the hashes in `tests/policy/source-wasm-host.test.mjs`.
5. `pnpm check && pnpm build && pnpm test:release`
6. Run the live checklist below.

## Probing the client's own functions

The technique that ended every round of guessing. Append export entries for the
functions you care about, instantiate in Node with stub imports, and call them.
Pure path helpers need no game state, network or login.

Appending exports is safe: it changes only the export section's own length.

```python
import sys; sys.path.insert(0, 'tools')
from wasmscan import WasmModule, uleb as rd

def enc(v):
    out = bytearray()
    while True:
        b = v & 0x7f; v >>= 7
        if v: out.append(b | 0x80)
        else:
            out.append(b); return bytes(out)

def name(s):
    b = s.encode(); return enc(len(b)) + b

WANT = [404, 411, 412, 455, 456, 457, 459, 895]     # whatever you need
m = WasmModule('<path>/Gw.jspi.wasm'); d = m.d
p, sec = 8, None
while p < len(d):
    sid = d[p]; hp = p; p += 1
    ln, q = rd(d, p); body = q; p = q + ln
    if sid == 7: sec = (hp, body, ln)
hp, body, ln = sec
n, q = rd(d, body)
add = b''.join(name(f'probe_{f}') + bytes([0]) + enc(f) for f in WANT)
new = enc(n + len(WANT)) + d[q:body + ln] + add
open('build/Gw.probe.wasm', 'wb').write(
    d[:hp] + bytes([7]) + enc(len(new)) + new + d[body + ln:])
```

```js
import { readFile } from 'node:fs/promises';

const mod = new WebAssembly.Module(await readFile('build/Gw.probe.wasm'));
const imports = {};
for (const { module, name } of WebAssembly.Module.imports(mod)) {
  imports[module] ??= {};
  imports[module][name] = () => 0;
}
const E = new WebAssembly.Instance(mod, imports).exports;

const u16 = () => new Uint16Array(E.memory.buffer);
const w = (a, s) => { const h = u16(), i = a >>> 1;
  for (let k = 0; k < s.length; k += 1) h[i + k] = s.charCodeAt(k);
  h[i + s.length] = 0; };
const r = (a) => { const h = u16(); let i = a >>> 1, o = '';
  while (h[i]) { o += String.fromCharCode(h[i]); i += 1; } return o; };

// Scratch space well past the data segments; nothing else is running.
const A = 0x400000, B = 0x410000;
w(A, '\\Test.txt');
E.probe_457(B, A, 260);
console.log(JSON.stringify(r(B)));      // "\Test" if defect 5 is fixed
```

Notes:

- Stub every import with `() => 0`. Nothing we probe uses them.
- The stack pointer global is initialised, so functions with locals work without
  running `__wasm_call_ctors`.
- `malloc` and `memory` are already exported by the official module, so the
  client's own allocator is available — that is how we proved the listing block
  is allocated and freed correctly.
- Use it on the **derived** module too, to prove the forwarders route to the
  carrier with the right markers and arguments.

## Integration check without the game

Instantiate the derived module with the **real** bridge source over a fake
filesystem, then drive the forwarders directly. This catches contract mistakes
that unit tests with hand-made fixtures miss:

```js
// P6.5: the bridge is an ESM module. It reads the markers off the page as it
// is imported, so the fake page has to exist before the import.
Object.assign(globalThis, {
  window: { gwNative: { init: {}, wasmBridgeMarkers: WASM_BRIDGE_MARKERS } },
  FS: fakeFs,
});
const { installTemplateSaveCompatibility } =
  await import('../src/renderer/template-save-compatibility.js');
installTemplateSaveCompatibility({
  imports, module: Module, exports: () => instance?.exports ?? null,
});
```

Feed it the path shapes the client actually produces — with the doubled
separator, `Templates/Skills/\Test.txt`. A cleaner path passes when the real one
would not; that exact mistake hid the delete bug through one full round.

## Live checklist

Requires a login. Run the whole cycle in order rather than each action alone.

- [ ] Save a build → confirmation names it `"\<name>"`
- [ ] Open "Load from Skills Template" → the build is listed, name complete
- [ ] Load it → skills apply, no "Template Code" error
- [ ] Rename it → the list shows the new name only, no duplicate left behind
- [ ] Delete it → disappears, no crash
- [ ] Restart the app → surviving templates are still listed
- [ ] Create a subdirectory case if possible → nested templates list one level
      down and not at the root
- [ ] Take a screenshot → `Screens/` is written
- [ ] Equipment templates → same cycle, type 1

With `GW_TEMPLATE_FS_TRACE=1`, `[template-fs-bridge]` should show
`ensureDirectory result 0`, `findFiles … published:true`, one `fileBaseName` per
entry, `fileExists exists:false` before a rename that is allowed to proceed, and
`deleteFile deleted:true`.

If the bridge logs nothing at all for an action, the failure is upstream of the
bridge and no bridge-side change will fix it — read the client's own log instead.
That is what round 10 cost.
