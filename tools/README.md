# WASM analysis tools

The tools in this directory analyze `Gw.wasm` and `Gw.jspi.wasm` offline. They
do not authorize a client build or a runtime transform.

Write derived output to `build/`. Git ignores that directory. Do not commit or
redistribute derived ArenaNet binaries.

## Important WASM rules

### Decode constants

LLVM can emit fixed-width, non-canonical LEB128 values. Decode each value. Do
not search for the canonical byte sequence.

For example, `i32.const 0x102820` can use this encoding:

```text
41 a0 d0 c0 80 00
```

A canonical byte search can return no result for a constant that is present.

### Scan module bytes

WebAssembly code is not in linear memory. A running module cannot read its own
code section. Scan the module file bytes.

## Tools

| Tool | Purpose |
| --- | --- |
| `wasmscan.py` | Decode instructions and find string, assertion, and byte-pattern references. |
| `packet_builders.py` | Find client-to-server message builders by opcode. |
| `gensyms.py` | Add recovered names and create string-reference data for analysis tools. |
| `gwca_anchor_probe.py` | Check which source assertion anchors still identify one WASM function. |

Example commands:

```bash
python3 tools/wasmscan.py dist/Gw.jspi.wasm "!s_context"
python3 tools/packet_builders.py dist/Gw.jspi.wasm 30 31 21
python3 tools/gensyms.py dist/Gw.jspi.wasm build/
python3 tools/gwca_anchor_probe.py path/to/GWCA/Source dist/Gw.jspi.wasm
```

Use the message opcode as the stable search key. Do not use a function index as
an identity. Function indices can change between ArenaNet builds. A recovered
builder also gives the arity and payload size that the analysis must verify.

## Certification command

`pnpm certification` is the maintainer interface to the production
certification code:

```text
doctor         inspect the local cached workspace
template       derive or check the template-save record
recertify      report Enhancement candidates and evidence
transform      transform one certified post-template module
double-click   derive and check the native double-click records
```

The production Enhancement transform validates the certified hooks and their
active table entries. It then adds one new terminal table slot for its fixed
dispatcher. It does not reuse an assumed empty slot. Exact functions, table
slots, hashes, and output profiles belong to the compiled certification tables.

The application owns the complete transform chain in
`src/main/certification/client-module.ts`. Analysis output and
`certificates/certified-client.json` do not grant runtime authority. See the
[Enhancement runbook](../docs/enhancement-development.md) before a live run.
