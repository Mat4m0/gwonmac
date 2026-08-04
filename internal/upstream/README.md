# Upstream client defects and the host workaround

Everything we learned reverse-engineering ArenaNet's WebAssembly Guild Wars
client while fixing [issue #5](https://github.com/Mat4m0/gwonmac/issues/5),
"Can't save builds".

The short version: the client's entire template file-management layer ships
unimplemented. Saving, listing, naming and deleting a build are four separate
stubs in `Base/Os/Emscripten`. Two further defects finish the job: an off-by-one
in `Path::RemoveExtension` corrupts every name that survives the first four, and
`File::Open` mode 1 creates the file it is asked to test for, so no rename can
ever succeed.

None of it is a macOS, Electron or IDBFS problem, and none of it can be repaired
from JavaScript alone, because the module imports no `mkdir`, `getdents` or
`unlink`: the client never reaches a syscall we could answer.

We work around it with one derived module, accepted only for an exact official
hash, that routes the broken routines back into the host.

## The documents

| File | Audience | Contents |
| --- | --- | --- |
| [upstream-defects.md](upstream-defects.md) | **ArenaNet** | Six defects, each with the function, signature, observed behaviour, reproduction, and expected behaviour. Self-contained; needs nothing from this repo. |
| [client-internals.md](client-internals.md) | us | The reference we had to build: function indices, data layouts, path conventions, the list filter. Everything a future change to this area needs. |
| [host-bridge.md](host-bridge.md) | us | What we actually ship: the transform, the five markers, the bridge contract, and the invariants that must hold. |
| [recertify.md](recertify.md) | us | The procedure when ArenaNet publishes a new client. Every index and offset below is build-specific. |
| [mouse-double-click.md](mouse-double-click.md) | **ArenaNet** and us | A second, unrelated finding: the client's mouse path carries a double-click flag all the way to `FrMouse`, and the Emscripten glue never writes it. Why the host synthesises touch taps, what that costs, and the one byte that would end it. |
| [investigation-log.md](investigation-log.md) | us | The chronology, including every wrong turn and what corrected it. Read this before re-deriving anything. |
| [memory-exhaustion-log.md](memory-exhaustion-log.md) | us | Open: long-session `wasm.abort`s with the heap pegged at the client's compiled-in 2 GiB cap. The heap-staircase instrumentation and what the next crash bundle must answer. |
| [upstream-keyboard-labels.md](upstream-keyboard-labels.md) | **ArenaNet** | Every printable key is labelled one position too high, while input is correct. Self-contained; states plainly which parts are observed and which are inferred. |
| [keyboard-label-offset.md](keyboard-label-offset.md) | us | Open: every printable key is labelled one position too high in the Controls panel and the menus, while input is correct. The key descriptor table, the measurement that isolates the render path, and the two readings a probe still has to choose between. |
| [investigation-template.md](investigation-template.md) | us | The shape a round takes — hypothesis, what was built, the measurement that killed it, the lesson. Copy it to start the next log. |

## The build this describes

| | |
| --- | --- |
| Artifact | `Gw.jspi.wasm` |
| SHA-256 | `b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483` |
| Size | 8,194,484 bytes |
| Function imports | 219 |
| Defined functions | 17,600 |
| Derived module SHA-256 | `68c6e09cec0f6992058a44a5617ca9eac7fab4697be1421943bbf664e6d444f6` |
| Derived size | 8,194,585 bytes |

Every function index, local index and byte offset in these documents belongs to
that exact build. A new client invalidates all of them — see
[recertify.md](recertify.md). The transform refuses unknown hashes and falls
back to the untouched official module, so a new build degrades to "templates
broken again" rather than to a corrupted client.

## The one technique worth remembering

Static disassembly produced one confident, plausible, wrong answer after
another. What ended the guessing every time was **running ArenaNet's own
functions**:
append export entries to the module, instantiate it in Node with stub imports,
and call the function directly. Pure path helpers need no game state, no
network and no login.

That turned "I think `_wsplitpath` keeps the trailing separator" into a
measurement, and it is how we found the `Path::RemoveExtension` off-by-one that
no amount of reading had revealed. The recipe is in
[recertify.md](recertify.md#probing-the-clients-own-functions).

## Reporting this upstream

[upstream-defects.md](upstream-defects.md) is written to be sent as-is. It
names functions by index and signature rather than by symbol, because the
shipped module is stripped — an ArenaNet engineer with the source tree will
recognise each one immediately from its call sites and behaviour.

We would much rather these were fixed at source than carry a growing derived
module indefinitely.
